"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MetricCard } from "./MetricCard";
import { TransactionTimeline } from "./TransactionTimeline";
import { ReconciliationPanel } from "./ReconciliationPanel";
import { NexusTracker } from "./NexusTracker";
import { EventLog } from "./EventLog";

type Props = {
  transactions: any[];
  nexus: any[];
  gaps: any[];
  events: any[];
  latestRun: any;
  summary: { totalRevenue: number; totalTax: number; count: number };
  dbError: string | null;
};

function fmtMoney(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function DashboardClient(props: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [seeding, setSeeding] = useState(false);
  const [highlightState, setHighlightState] = useState<string | null>(null);

  const openGaps = props.gaps.length;

  async function handleSeed() {
    setSeeding(true);
    try {
      const res = await fetch("/api/seed", { method: "POST" });
      const data = await res.json();
      console.log("[seed]", data);
      // Webhooks are async; give the worker a beat then refresh.
      setTimeout(() => startTransition(() => router.refresh()), 1500);
    } catch (e) {
      console.error(e);
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-zinc-200">
      <header className="border-b border-zinc-800/80 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <h1 className="font-mono text-sm uppercase tracking-[0.25em] text-zinc-300">
              Numeral Compliance Inspector
            </h1>
            <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
              webhook · queue · reconcile · nexus
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSeed}
              disabled={seeding || isPending}
              className="border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-sky-300 hover:bg-sky-500/20 disabled:opacity-50"
            >
              {seeding ? "Seeding…" : "Generate Test Data"}
            </button>
            <button
              onClick={() => startTransition(() => router.refresh())}
              className="border border-zinc-700 bg-zinc-900 px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-zinc-300 hover:bg-zinc-800"
            >
              {isPending ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
        {props.dbError && (
          <div className="mt-3 border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-mono text-[11px] text-rose-300">
            DB error: {props.dbError} — make sure Postgres is running and `pnpm db:migrate` has been applied.
          </div>
        )}
      </header>

      <main className="px-6 py-6 space-y-6">
        <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <MetricCard label="Transactions" value={props.summary.count.toString()} />
          <MetricCard label="Total Revenue" value={fmtMoney(props.summary.totalRevenue)} />
          <MetricCard label="Tax Collected" value={fmtMoney(props.summary.totalTax)} />
          <MetricCard
            label="Open Gaps"
            value={openGaps.toString()}
            sublabel={openGaps > 0 ? "Reconciliation pending" : "All clear"}
            alert={openGaps > 0}
          />
        </section>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <TransactionTimeline
              transactions={props.transactions}
              onStateClick={(s) => setHighlightState(s === highlightState ? null : s)}
            />
          </div>
          <div className="lg:col-span-2">
            <ReconciliationPanel latestRun={props.latestRun} gaps={props.gaps} />
          </div>
        </section>

        <section>
          <NexusTracker exposures={props.nexus} highlightState={highlightState} />
        </section>

        <section>
          <EventLog events={props.events} />
        </section>
      </main>
    </div>
  );
}
