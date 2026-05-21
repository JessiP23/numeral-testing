import { Worker, type Job } from "bullmq";
import Redis from "ioredis";
import type Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import { normalizeStripeCharge } from "../lib/normalizer";
import { JURISDICTION_MAP, NEXUS_THRESHOLDS, WARNING_THRESHOLD } from "../lib/jurisdictions";

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
  console.log(`[worker] DATABASE_URL = ${masked}`);
  console.log(`[worker] REDIS_URL    = ${process.env.REDIS_URL ?? "(default localhost:6379)"}`);
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
    const { eventId, eventType, payload } = job.data as {
      eventId: string;
      eventType: string;
      payload: Stripe.Charge;
    };

    // Layer 1: Redis SETNX idempotency (24h TTL).
    const idempKey = `idempotency:${eventId}`;
    const acquired = await redis.set(idempKey, "1", "EX", 86400, "NX");

    if (!acquired) {
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
        const normalized = normalizeStripeCharge(eventId, charge);

        // Layer 2: DB unique constraint on stripeChargeId — backstop.
        const { metadata, ...rest } = normalized;
        const tx = await prisma.transaction.upsert({
          where: { stripeChargeId: normalized.stripeChargeId },
          update: {},
          create: { ...rest, metadata: metadata as object },
        });

        if (normalized.billingState) {
          await upsertNexusExposure(normalized.billingState, normalized.amountCents);
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
        await prisma.transaction.updateMany({
          where: { stripeChargeId: charge.id },
          data: { status: "REFUNDED" },
        });

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

    return { skipped: true, reason: "unsupported" };
  },
  { connection: redis, concurrency: 5 }
);

worker.on("failed", (job, err) => {
  console.error(`[worker] job ${job?.id} failed:`, err.message);
});

worker.on("completed", (job, result) => {
  console.log(`[worker] job ${job.id} completed:`, result);
});

console.log("Transaction worker running...");
