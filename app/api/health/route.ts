import { NextResponse } from "next/server";
import Redis from "ioredis";
import { Queue } from "bullmq";
import { prisma } from "@/lib/prisma";
import { isChaosMode } from "@/lib/chaos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Build a one-shot Redis connection for the health check so we don't hold
// a long-lived connection across hot reloads.
async function checkRedis(url: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const r = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1500,
    lazyConnect: true,
    retryStrategy: () => null,
  });
  const start = Date.now();
  try {
    await r.connect();
    const pong = await r.ping();
    if (pong !== "PONG") throw new Error(`unexpected reply: ${pong}`);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    r.disconnect();
  }
}

async function checkDb(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkQueue(redisUrl: string): Promise<{
  ok: boolean;
  waiting: number;
  active: number;
  failed: number;
  hasWorker: boolean;
  error?: string;
}> {
  const r = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1500,
    lazyConnect: true,
    retryStrategy: () => null,
  });
  try {
    await r.connect();
    const q = new Queue("transactions", { connection: r });
    const counts = await q.getJobCounts("waiting", "active", "failed");
    // BullMQ stores worker registrations under bull:<name>:meta and worker keys.
    // A simple proxy: check if any "stalled" or "active" tracker keys exist.
    const workerKeys = await r.keys("bull:transactions:*");
    const hasWorker = workerKeys.length > 0; // best-effort signal
    await q.close();
    return {
      ok: true,
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      failed: counts.failed ?? 0,
      hasWorker,
    };
  } catch (err) {
    return {
      ok: false,
      waiting: 0,
      active: 0,
      failed: 0,
      hasWorker: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    r.disconnect();
  }
}

export async function GET() {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

  const [db, redis, queue, duplicatesBlocked] = await Promise.all([
    checkDb(),
    checkRedis(redisUrl),
    checkQueue(redisUrl),
    prisma.webhookEvent.count({ where: { status: "DUPLICATE" } }).catch(() => 0),
  ]);

  const stripeConfigured = Boolean(
    process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.startsWith("sk_")
  );
  const webhookConfigured = Boolean(
    process.env.STRIPE_WEBHOOK_SECRET && process.env.STRIPE_WEBHOOK_SECRET.startsWith("whsec_")
  );

  return NextResponse.json({
    db,
    redis,
    queue,
    stripe: { secretConfigured: stripeConfigured, webhookConfigured },
    chaosMode: isChaosMode(),
    duplicatesBlocked,
    timestamp: new Date().toISOString(),
  });
}
