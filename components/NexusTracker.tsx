"use client";

import { StatusBadge, statusToVariant } from "./StatusBadge";

type Exposure = {
  id: string;
  stateCode: string;
  stateName: string;
  totalRevenueCents: number;
  transactionCount: number;
  thresholdStatus: string;
  revenuePercent: number;
  txPercent: number;
};

function barColor(pct: number) {
  if (pct >= 100) return "bg-rose-500";
  if (pct >= 80) return "bg-amber-500";
  return "bg-emerald-500";
}

export function NexusTracker({
  exposures,
  highlightState,
}: {
  exposures: Exposure[];
  highlightState: string | null;
}) {
  return (
    <div className="border border-zinc-800/80 bg-zinc-950/40">
      <header className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-3">
        <h2 className="font-mono text-xs uppercase tracking-widest text-zinc-400">
          Economic Nexus Exposure
        </h2>
        <span className="font-mono text-[11px] text-zinc-500">
          Threshold: $100,000 / 200 transactions per state
        </span>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full font-mono text-[12px]">
          <thead>
            <tr className="border-b border-zinc-800/80 text-left text-[10px] uppercase tracking-widest text-zinc-500">
              <th className="px-3 py-2 font-medium">State</th>
              <th className="px-3 py-2 text-right font-medium">Revenue</th>
              <th className="px-3 py-2 font-medium w-[28%]">Revenue %</th>
              <th className="px-3 py-2 text-right font-medium">Tx Count</th>
              <th className="px-3 py-2 font-medium w-[28%]">Tx %</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {exposures.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-zinc-600">
                  No nexus exposure recorded yet
                </td>
              </tr>
            )}
            {exposures.map((e) => {
              const isHighlighted = highlightState === e.stateCode;
              return (
                <tr
                  key={e.id}
                  className={`border-b border-zinc-900 ${
                    isHighlighted ? "bg-sky-500/10" : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    <span className="text-zinc-200">{e.stateCode}</span>
                    <span className="ml-2 text-zinc-500">{e.stateName}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-200">
                    ${(e.totalRevenueCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 bg-zinc-800">
                        <div
                          className={`h-full ${barColor(e.revenuePercent)}`}
                          style={{ width: `${Math.min(100, e.revenuePercent)}%` }}
                        />
                      </div>
                      <span className="w-12 text-right text-zinc-500">
                        {e.revenuePercent.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-200">
                    {e.transactionCount}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 bg-zinc-800">
                        <div
                          className={`h-full ${barColor(e.txPercent)}`}
                          style={{ width: `${Math.min(100, e.txPercent)}%` }}
                        />
                      </div>
                      <span className="w-12 text-right text-zinc-500">
                        {e.txPercent.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge
                      label={e.thresholdStatus}
                      variant={statusToVariant(e.thresholdStatus)}
                    />
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
