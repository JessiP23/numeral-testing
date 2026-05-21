"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge, statusToVariant } from "./StatusBadge";

async function retryGap(gapId: string) {
  const res = await fetch(`/api/gaps/${gapId}/retry`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Retry failed (${res.status})`);
  }
  return res.json() as Promise<{ queued: boolean; jobId: string; chargeId: string }>;
}

type Run = {
  id: string;
  status: string;
  totalStripe: number;
  totalLocal: number;
  gapsFound: number;
  startedAt: string | Date;
  completedAt: string | Date | null;
} | null;

type Gap = {
  id: string;
  gapType: string;
  stripeChargeId: string;
  stripeAmount: number | null;
  localAmount: number | null;
  severity: string;
};

const GAP_VARIANT: Record<string, "error" | "warning" | "neutral"> = {
  MISSING_IN_LOCAL: "error",
  AMOUNT_MISMATCH: "warning",
  DUPLICATE: "neutral",
};

function fmtMoney(cents: number | null) {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtTime(d: string | Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

export function ReconciliationPanel({
  latestRun,
  gaps,
}: {
  latestRun: Run;
  gaps: Gap[];
}) {
  const router = useRouter();
  const [running, setRunning] = useState(latestRun?.status === "RUNNING");
  const [run, setRun] = useState<Run>(latestRun);
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});

  async function handleRetry(gapId: string) {
    setRetrying((prev) => ({ ...prev, [gapId]: true }));
    try {
      await retryGap(gapId);
      // Worker resolves the gap async; pull fresh data after it's had a beat.
      setTimeout(() => router.refresh(), 1500);
    } catch (err) {
      console.error("[retry]", err);
    } finally {
      setRetrying((prev) => ({ ...prev, [gapId]: false }));
    }
  }

  // Poll while a run is in progress.
  useEffect(() => {
    if (!running) return;
    const i = setInterval(async () => {
      const res = await fetch("/api/reconcile/status", { cache: "no-store" });
      const data = await res.json();
      setRun(data.latestRun);
      if (data.latestRun?.status !== "RUNNING") {
        setRunning(false);
        router.refresh();
        clearInterval(i);
      }
    }, 3000);
    return () => clearInterval(i);
  }, [running, router]);

  async function startRun() {
    setRunning(true);
    const res = await fetch("/api/reconcile", { method: "POST" });
    const data = await res.json();
    setRun({
      id: data.runId,
      status: "RUNNING",
      totalStripe: 0,
      totalLocal: 0,
      gapsFound: 0,
      startedAt: new Date().toISOString(),
      completedAt: null,
    });
  }

  return (
    <div className="border border-zinc-800/80 bg-zinc-950/40">
      <header className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-3">
        <h2 className="font-mono text-xs uppercase tracking-widest text-zinc-400">
          Reconciliation
        </h2>
        <button
          onClick={startRun}
          disabled={running}
          className="border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
        >
          {running ? "Running…" : "Run Reconciliation"}
        </button>
      </header>

      <div className="grid grid-cols-3 gap-px bg-zinc-800/80">
        <div className="bg-zinc-950/40 p-3">
          <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Stripe</div>
          <div className="font-mono text-xl tabular-nums text-zinc-200">
            {run?.totalStripe ?? 0}
          </div>
        </div>
        <div className="bg-zinc-950/40 p-3">
          <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Local</div>
          <div className="font-mono text-xl tabular-nums text-zinc-200">
            {run?.totalLocal ?? 0}
          </div>
        </div>
        <div className="bg-zinc-950/40 p-3">
          <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Gaps</div>
          <div
            className={`font-mono text-xl tabular-nums ${
              (run?.gapsFound ?? 0) > 0 ? "text-rose-400" : "text-zinc-200"
            }`}
          >
            {run?.gapsFound ?? 0}
          </div>
        </div>
      </div>

      <div className="border-t border-zinc-800/80 px-4 py-2 font-mono text-[11px] text-zinc-500">
        {run ? (
          <div className="flex items-center justify-between">
            <span>
              Run <span className="text-zinc-300">{run.id.slice(0, 10)}…</span>
            </span>
            <StatusBadge label={run.status} variant={statusToVariant(run.status)} pulse={run.status === "RUNNING"} />
            <span>{fmtTime(run.completedAt ?? run.startedAt)}</span>
          </div>
        ) : (
          <span className="text-zinc-600">No reconciliation runs yet</span>
        )}
      </div>

      <div className="max-h-[420px] overflow-y-auto">
        <table className="w-full font-mono text-[11px]">
          <thead className="sticky top-0 bg-zinc-950/95 backdrop-blur">
            <tr className="border-b border-zinc-800/80 text-left text-[10px] uppercase tracking-widest text-zinc-500">
              <th className="px-3 py-2 font-medium">Charge</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 text-right font-medium">Stripe</th>
              <th className="px-3 py-2 text-right font-medium">Local</th>
              <th className="px-3 py-2 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {gaps.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-600">
                  No open gaps
                </td>
              </tr>
            )}
            {gaps.map((g) => {
              const canRetry = g.gapType === "MISSING_IN_LOCAL";
              const isRetrying = retrying[g.id];
              return (
                <tr key={g.id} className="border-b border-zinc-900">
                  <td className="px-3 py-2 text-zinc-300">{g.stripeChargeId.slice(0, 18)}…</td>
                  <td className="px-3 py-2">
                    <StatusBadge
                      label={g.gapType}
                      variant={GAP_VARIANT[g.gapType] ?? "neutral"}
                    />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-300">
                    {fmtMoney(g.stripeAmount)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-300">
                    {fmtMoney(g.localAmount)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canRetry ? (
                      <button
                        onClick={() => handleRetry(g.id)}
                        disabled={isRetrying}
                        className="border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                      >
                        {isRetrying ? "…" : "Retry"}
                      </button>
                    ) : (
                      <span className="font-mono text-[10px] text-zinc-600">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
