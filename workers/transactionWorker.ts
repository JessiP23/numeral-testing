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
      await prisma.webhookEvent.update({
        where: { id: eventId },
        data: { status: "DUPLICATE", processedAt: new Date() },
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

        await prisma.webhookEvent.update({
          where: { id: eventId },
          data: { status: "PROCESSED", processedAt: new Date() },
        });

        return { transactionId: tx.id };
      }

      if (eventType === "charge.refunded") {
        const charge = payload;
        await prisma.transaction.updateMany({
          where: { stripeChargeId: charge.id },
          data: { status: "REFUNDED" },
        });

        await prisma.webhookEvent.update({
          where: { id: eventId },
          data: { status: "PROCESSED", processedAt: new Date() },
        });

        return { refunded: charge.id };
      }
    } catch (error) {
      await prisma.webhookEvent.update({
        where: { id: eventId },
        data: {
          status: "FAILED",
          errorMessage: error instanceof Error ? error.message : String(error),
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
