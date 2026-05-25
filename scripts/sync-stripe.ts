/**
 * Pulls all charges directly from the Stripe API and ingests them into the
 * local DB using the same normalizer + idempotency logic the webhook worker
 * uses. Bypasses the need for `stripe listen` to be running.
 *
 * Usage:  pnpm sync
 */
import "dotenv/config";
import Stripe from "stripe";
import Redis from "ioredis";
import { PrismaClient, type TransactionStatus } from "@prisma/client";
import { normalizeStripeCharge } from "../lib/normalizer";
import { JURISDICTION_MAP, NEXUS_THRESHOLDS, WARNING_THRESHOLD } from "../lib/jurisdictions";
import { logger, withCorrelationId } from "../lib/logger";

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: 1,
});
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");

async function upsertNexus(stateCode: string, amountCents: number) {
  const j = JURISDICTION_MAP[stateCode];
  if (!j) return;
  await prisma.nexusExposure.upsert({
    where: { merchantId_stateCode: { merchantId: "demo-merchant", stateCode } },
    update: {
      totalRevenueCents: { increment: amountCents },
      transactionCount: { increment: 1 },
    },
    create: {
      stateCode,
      stateName: j.name,
      totalRevenueCents: amountCents,
      transactionCount: 1,
    },
  });
  const updated = await prisma.nexusExposure.findUnique({
    where: { merchantId_stateCode: { merchantId: "demo-merchant", stateCode } },
  });
  if (!updated) return;
  const ratio = Math.max(
    updated.totalRevenueCents / NEXUS_THRESHOLDS.revenueCents,
    updated.transactionCount / NEXUS_THRESHOLDS.transactions
  );
  const status = ratio >= 1 ? "EXCEEDED" : ratio >= WARNING_THRESHOLD ? "WARNING" : "SAFE";
  await prisma.nexusExposure.update({
    where: { id: updated.id },
    data: { thresholdStatus: status },
  });
}

async function main() {
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_")) {
    logger.error("STRIPE_SECRET_KEY missing or placeholder.");
    process.exit(1);
  }

  logger.info("Starting Stripe sync");

  const all: Stripe.Charge[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const batch: Stripe.ApiList<Stripe.Charge> = await stripe.charges.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    all.push(...batch.data);
    if (!batch.has_more) break;
    startingAfter = batch.data[batch.data.length - 1]?.id;
    if (!startingAfter) break;
  }

  logger.info({ totalCharges: all.length }, "Fetched charges from Stripe");

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  // Generate a correlation ID for this sync run
  const correlationId = `sync_${Date.now()}`;
  const log = withCorrelationId(correlationId);

  for (const charge of all) {
    if (charge.status !== "succeeded") continue;
    // Synthesize a stable event id so re-runs are idempotent.
    const eventId = `sync_${charge.id}`;

    const acquired = await redis.set(`idempotency:${eventId}`, "1", "EX", 86400, "NX");
    if (!acquired) {
      skipped++;
      continue;
    }

    try {
      const normalized = normalizeStripeCharge(eventId, charge, correlationId);
      const { metadata, ...rest } = normalized;

      await prisma.webhookEvent.upsert({
        where: { id: eventId },
        update: { status: "PROCESSED", processedAt: new Date() },
        create: {
          id: eventId,
          type: "charge.succeeded",
          status: "PROCESSED",
          rawPayload: charge as unknown as object,
          processedAt: new Date(),
        },
      });

      const result = await prisma.transaction.upsert({
        where: { stripeChargeId: normalized.stripeChargeId },
        update: {},
        create: { ...rest, metadata: metadata as object },
      });

      // Record initial state transition for fresh inserts
      const isFresh = result.processedAt.getTime() > Date.now() - 5000;
      if (isFresh) {
        await prisma.transactionStateTransition.create({
          data: {
            transactionId: result.id,
            fromStatus: null,
            toStatus: normalized.status as TransactionStatus,
            reason: "sync_ingestion",
            metadata: { correlationId, eventId },
          },
        });

        if (normalized.billingState) {
          await upsertNexus(normalized.billingState, normalized.amountCents);
        }
      }
      inserted++;
    } catch (err) {
      failed++;
      log.error({ stripeChargeId: charge.id, error: err instanceof Error ? err.message : err }, "Failed to process charge");
    }
  }

  logger.info({ inserted, skipped, failed, correlationId }, "Sync completed");
  await prisma.$disconnect();
  await redis.quit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
