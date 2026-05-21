"use client";

import { useEffect, useState } from "react";

type Health = {
  db: { ok: boolean; latencyMs: number; error?: string };
  redis: { ok: boolean; latencyMs: number; error?: string };
  queue: { ok: boolean; waiting: number; active: number; failed: number; hasWorker: boolean; error?: string };
  stripe: { secretConfigured: boolean; webhookConfigured: boolean };
  timestamp: string;
};

function Dot({ ok, warning = false }: { ok: boolean; warning?: boolean }) {
  const color = ok ? (warning ? "bg-amber-400" : "bg-emerald-400") : "bg-rose-400";
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${color}`} />;
}

export function SystemStatus() {
  const [h, setH] = useState<Health | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const data = (await res.json()) as Health;
        if (!cancelled) setH(data);
      } catch {
        if (!cancelled) setH(null);
      }
    }
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!h) {
    return (
      <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-500">
        <Dot ok={false} /> health check…
      </div>
    );
  }

  const stripeOk = h.stripe.secretConfigured && h.stripe.webhookConfigured;

  return (
    <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-widest text-zinc-400">
      <div className="flex items-center gap-1.5" title={h.db.error ?? `${h.db.latencyMs}ms`}>
        <Dot ok={h.db.ok} /> Postgres
      </div>
      <div className="flex items-center gap-1.5" title={h.redis.error ?? `${h.redis.latencyMs}ms`}>
        <Dot ok={h.redis.ok} /> Redis
      </div>
      <div
        className="flex items-center gap-1.5"
        title={
          h.queue.error ??
          `waiting=${h.queue.waiting} active=${h.queue.active} failed=${h.queue.failed}`
        }
      >
        <Dot ok={h.queue.ok} warning={h.queue.failed > 0} /> Queue
        <span className="text-zinc-500 normal-case tracking-normal">
          {h.queue.waiting}w / {h.queue.active}a
          {h.queue.failed > 0 ? ` / ${h.queue.failed}f` : ""}
        </span>
      </div>
      <div
        className="flex items-center gap-1.5"
        title={
          stripeOk
            ? "Stripe key + webhook secret configured"
            : "Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in .env.local"
        }
      >
        <Dot ok={stripeOk} warning={h.stripe.secretConfigured && !h.stripe.webhookConfigured} />
        Stripe
      </div>
    </div>
  );
}
