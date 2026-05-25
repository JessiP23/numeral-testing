import { Worker, type Job } from "bullmq";
import Redis from "ioredis";
import type Stripe from "stripe";
import { PrismaClient, type TransactionStatus } from "@prisma/client";
import { normalizeStripeCharge } from "../lib/normalizer";
import { JURISDICTION_MAP, NEXUS_THRESHOLDS, WARNING_THRESHOLD } from "../lib/jurisdictions";
import { logger, withCorrelationId } from "../lib/logger";
import { transactionDLQ } from "../lib/queue";

// Worker process — own DB + Redis connections, separate from the Next.js app.
const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

// Sanity log — confirms which DB this worker is talking to. If this doesn't
// match the web app's DB, webhook-event rows will look "missing" to the worker.
{
  const dbUrl = process.env.DATABASE_URL ?? "(unset)";
  const masked = dbUrl.replace(/:[^:@/]+@/, ":****@");
  logger.info({ masked, redisUrl: process.env.REDIS_URL }, "Worker initialized");
}

// Valid state transitions for transaction lifecycle
const VALID_TRANSITIONS: Record<TransactionStatus, TransactionStatus[]> = {
  RECORDED: ["REFUNDED", "ADJUSTED", "FILED", "CLOSED"],
  REFUNDED: ["CLOSED"],
  ADJUSTED: ["FILED", "CLOSED"],
  FILED: ["REMITTED", "CLOSED"],
  REMITTED: ["CLOSED"],
  DISPUTED: ["RECORDED", "REFUNDED", "CLOSED"],
  CLOSED: [], // Terminal state
};

function isValidTransition(from: TransactionStatus | null, to: TransactionStatus): boolean {
  if (!from) return true; // Initial state (no previous status)
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

async function recordStateTransition(
  transactionId: string,
  fromStatus: TransactionStatus | null,
  toStatus: TransactionStatus,
  reason: string,
  metadata?: Record<string, unknown>
) {
  await prisma.transactionStateTransition.create({
    data: {
      transactionId,
      fromStatus,
      toStatus,
      reason,
      metadata: metadata as object,
    },
  });
}

async function upsertNexusExposure(stateCode: string, amountCents: number) {
  const jurisdiction = JURISDICTION_MAP[stateCode];
  if (!jurisdiction) return;

  await prisma.nexusExposure.upsert({
    where: {
      merchantId_stateCode: { merchantId: "demo-merchant", stateCode },
    },
    update: {
      totalRevenueCents: { increment: amountCents },
      transactionCount: { increment: 1 },
    },
    create: {
      stateCode,
      stateName: jurisdiction.name,
      totalRevenueCents: amountCents,
      transactionCount: 1,
    },
  });

  const updated = await prisma.nexusExposure.findUnique({
    where: { merchantId_stateCode: { merchantId: "demo-merchant", stateCode } },
  });
  if (!updated) return;

  const revenueRatio = updated.totalRevenueCents / NEXUS_THRESHOLDS.revenueCents;
  const txRatio = updated.transactionCount / NEXUS_THRESHOLDS.transactions;
  const maxRatio = Math.max(revenueRatio, txRatio);

  const thresholdStatus =
    maxRatio >= 1 ? "EXCEEDED" : maxRatio >= WARNING_THRESHOLD ? "WARNING" : "SAFE";

  await prisma.nexusExposure.update({
    where: { id: updated.id },
    data: { thresholdStatus },
  });
}

const worker = new Worker(
  "transactions",
  async (job: Job) => {
    const { eventId, eventType, payload, correlationId } = job.data as {
      eventId: string;
      eventType: string;
      payload: Stripe.Charge;
      correlationId?: string;
    };

    const log = correlationId ? withCorrelationId(correlationId) : logger;

    log.info({ eventId, eventType }, "Processing job");

    // Layer 1: Redis SETNX idempotency (24h TTL).
    const idempKey = `idempotency:${eventId}`;
    const acquired = await redis.set(idempKey, "1", "EX", 86400, "NX");

    if (!acquired) {
      log.warn({ eventId }, "Duplicate detected via Redis SETNX");
      // Use upsert: row may not exist if webhook handler hit a different DB
      // (e.g. during a config change). Don't let that wedge the queue.
      await prisma.webhookEvent.upsert({
        where: { id: eventId },
        update: { status: "DUPLICATE", processedAt: new Date() },
        create: {
          id: eventId,
          type: eventType,
          status: "DUPLICATE",
          rawPayload: payload as unknown as object,
          processedAt: new Date(),
        },
      });
      return { skipped: true, reason: "duplicate" };
    }

    try {
      if (eventType === "charge.succeeded") {
        const charge = payload;
        const normalized = normalizeStripeCharge(eventId, charge, correlationId);

        log.info({ stripeChargeId: charge.id, amount: charge.amount }, "Processing charge succeeded");

        // Layer 2: DB unique constraint on stripeChargeId — backstop.
        const { metadata, ...rest } = normalized;
        const tx = await prisma.transaction.upsert({
          where: { stripeChargeId: normalized.stripeChargeId },
          update: {},
          create: { ...rest, metadata: metadata as object },
        });

        // Record initial state transition
        await recordStateTransition(
          tx.id,
          null,
          normalized.status,
          eventId.startsWith("retry_") ? "gap_retry" : "webhook_received",
          { stripeEventId: eventId, correlationId }
        );

        log.info({ transactionId: tx.id, status: normalized.status }, "Transaction created with state transition");

        // If this was a retry job, resolve the corresponding gap
        if (eventId.startsWith("retry_")) {
          const stripeChargeId = eventId.replace("retry_", "");
          await prisma.reconciliationGap.updateMany({
            where: {
              stripeChargeId,
              gapType: "MISSING_IN_LOCAL",
              resolvedAt: null,
            },
            data: { resolvedAt: new Date() },
          });
          log.info({ stripeChargeId }, "Resolved reconciliation gap from retry");
        }

        if (normalized.billingState) {
          await upsertNexusExposure(normalized.billingState, normalized.amountCents);
          log.info({ stateCode: normalized.billingState, amountCents: normalized.amountCents }, "Nexus exposure updated");
        }

        await prisma.webhookEvent.upsert({
          where: { id: eventId },
          update: { status: "PROCESSED", processedAt: new Date() },
          create: {
            id: eventId,
            type: eventType,
            status: "PROCESSED",
            rawPayload: charge as unknown as object,
            processedAt: new Date(),
          },
        });

        return { transactionId: tx.id };
      }

      if (eventType === "charge.refunded") {
        const charge = payload;
        log.info({ stripeChargeId: charge.id }, "Processing charge refunded");

        const existing = await prisma.transaction.findUnique({
          where: { stripeChargeId: charge.id },
        });

        if (existing) {
          const newStatus: TransactionStatus = "REFUNDED";
          
          // Validate state transition
          if (!isValidTransition(existing.status as TransactionStatus, newStatus)) {
            log.error({ from: existing.status, to: newStatus, stripeChargeId: charge.id }, "Invalid state transition");
            throw new Error(`Invalid state transition: ${existing.status} -> ${newStatus}`);
          }

          await prisma.transaction.update({
            where: { id: existing.id },
            data: { status: newStatus },
          });

          // Record state transition
          await recordStateTransition(
            existing.id,
            existing.status as TransactionStatus,
            newStatus,
            "refund_processed",
            { stripeEventId: eventId, correlationId }
          );

          log.info({ transactionId: existing.id, from: existing.status, to: newStatus }, "State transition recorded");
        }

        await prisma.webhookEvent.upsert({
          where: { id: eventId },
          update: { status: "PROCESSED", processedAt: new Date() },
          create: {
            id: eventId,
            type: eventType,
            status: "PROCESSED",
            rawPayload: charge as unknown as object,
            processedAt: new Date(),
          },
        });

        return { refunded: charge.id };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error({ eventId, error: msg }, "Job failed");
      await prisma.webhookEvent.upsert({
        where: { id: eventId },
        update: { status: "FAILED", errorMessage: msg },
        create: {
          id: eventId,
          type: eventType,
          status: "FAILED",
          errorMessage: msg,
          rawPayload: payload as unknown as object,
        },
      });
      throw error; // BullMQ retry with exponential backoff
    }

    log.info({ eventType }, "Unsupported event type");
    return { skipped: true, reason: "unsupported" };
  },
  { connection: redis, concurrency: 5 }
);

worker.on("failed", async (job, err) => {
  const jobId = job?.id;
  const attemptsMade = job?.attemptsMade ?? 0;
  const error = err.message;

  logger.error({ jobId, attemptsMade, error }, "Worker job failed");

  // If job has exhausted all retries (3 attempts), move to DLQ
  if (attemptsMade >= 3 && job) {
    logger.warn({ jobId, error }, "Job exhausted retries, moving to DLQ");
    await transactionDLQ.add(
      `dlq-${jobId}`,
      {
        originalJobId: jobId,
        originalData: job.data,
        failedAt: new Date().toISOString(),
        error,
        attemptsMade,
      },
      {
        jobId: `dlq-${jobId}`,
      }
    );
  }
});

worker.on("completed", (job, result) => {
  logger.info({ jobId: job.id, result }, "Worker job completed");
});

logger.info("Transaction worker running...");
