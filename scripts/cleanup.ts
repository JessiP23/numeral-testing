/**
 * Wipes all local data so you can start a clean demo.
 *
 *   pnpm cleanup           # wipe DB tables
 *   pnpm cleanup --redis   # also flush BullMQ + idempotency keys from Redis
 *
 * Does NOT touch Stripe — the test charges in your Stripe account are
 * permanent (you can ignore them; test-mode data is sandboxed). If you want
 * to nuke Stripe test data: dashboard.stripe.com → developers → "delete
 * all test data" link at the bottom of the API keys page.
 */
import "dotenv/config";
import Redis from "ioredis";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const flushRedis = process.argv.includes("--redis");

  console.log("Wiping DB tables...");
  // Order matters because of FKs (ReconciliationGap → Transaction).
  const gaps = await prisma.reconciliationGap.deleteMany();
  const runs = await prisma.reconciliationRun.deleteMany();
  const txs = await prisma.transaction.deleteMany();
  const exposures = await prisma.nexusExposure.deleteMany();
  const events = await prisma.webhookEvent.deleteMany();
  const idem = await prisma.idempotencyKey.deleteMany();

  console.log(
    `  removed: gaps=${gaps.count} runs=${runs.count} transactions=${txs.count} ` +
      `exposures=${exposures.count} events=${events.count} idempotency=${idem.count}`
  );

  if (flushRedis) {
    console.log("Flushing Redis idempotency + queue keys...");
    const r = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
      maxRetriesPerRequest: 1,
    });
    const idemKeys = await r.keys("idempotency:*");
    const bullKeys = await r.keys("bull:transactions:*");
    const reconKeys = await r.keys("bull:reconciliation:*");
    const all = [...idemKeys, ...bullKeys, ...reconKeys];
    if (all.length) await r.del(...all);
    console.log(`  removed ${all.length} redis keys`);
    await r.quit();
  }

  await prisma.$disconnect();
  console.log("Cleanup complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
