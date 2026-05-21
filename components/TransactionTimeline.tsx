"use client";

import { Fragment, useState } from "react";
import { StatusBadge, statusToVariant } from "./StatusBadge";

type Tx = {
  id: string;
  stripeChargeId: string;
  customerEmail: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingZip: string | null;
  billingCountry: string | null;
  amountCents: number;
  taxAmountCents: number;
  taxRate: number;
  jurisdictionName: string | null;
  status: string;
  processedAt: string | Date;
};

function fmtMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtTime(d: string | Date) {
  return new Date(d).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function TransactionTimeline({
  transactions,
  onStateClick,
}: {
  transactions: Tx[];
  onStateClick?: (state: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="border border-zinc-800/80 bg-zinc-950/40">
      <header className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-3">
        <h2 className="font-mono text-xs uppercase tracking-widest text-zinc-400">
          Transaction Timeline
        </h2>
        <span className="font-mono text-[11px] text-zinc-500">
          {transactions.length} records
        </span>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full font-mono text-[12px]">
          <thead>
            <tr className="border-b border-zinc-800/80 text-left text-[10px] uppercase tracking-widest text-zinc-500">
              <th className="px-3 py-2 font-medium">Charge ID</th>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">State</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 text-right font-medium">Tax</th>
              <th className="px-3 py-2 font-medium">Jurisdiction</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Time</th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-zinc-600">
                  No transactions yet — run <span className="text-zinc-400">Generate Test Data</span>
                </td>
              </tr>
            )}
            {transactions.map((t) => {
              const isOpen = expanded === t.id;
              return (
                <Fragment key={t.id}>
                  <tr
                    onClick={() => setExpanded(isOpen ? null : t.id)}
                    className="cursor-pointer border-b border-zinc-900 hover:bg-zinc-900/40"
                  >
                    <td className="px-3 py-2 text-zinc-300">
                      {t.stripeChargeId.slice(0, 18)}…
                    </td>
                    <td className="px-3 py-2 text-zinc-400">
                      {t.customerEmail ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      {t.billingState ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onStateClick?.(t.billingState!);
                          }}
                          className="text-sky-400 hover:underline"
                        >
                          {t.billingState}
                        </button>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-200">
                      {fmtMoney(t.amountCents)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-400">
                      {fmtMoney(t.taxAmountCents)}
                    </td>
                    <td className="px-3 py-2 text-zinc-400">
                      {t.jurisdictionName ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge label={t.status} variant={statusToVariant(t.status)} />
                    </td>
                    <td className="px-3 py-2 text-zinc-500">{fmtTime(t.processedAt)}</td>
                  </tr>
                  {isOpen && (
                    <tr key={`${t.id}-detail`} className="border-b border-zinc-900 bg-zinc-950/80">
                      <td colSpan={8} className="px-6 py-4 text-[11px] text-zinc-400">
                        <div className="grid grid-cols-3 gap-6">
                          <div>
                            <div className="text-zinc-500 uppercase tracking-widest text-[9px] mb-1">Billing Address</div>
                            <div>{t.billingCity ?? "—"}, {t.billingState ?? "—"} {t.billingZip ?? ""}</div>
                            <div className="text-zinc-600">{t.billingCountry ?? "—"}</div>
                          </div>
                          <div>
                            <div className="text-zinc-500 uppercase tracking-widest text-[9px] mb-1">Tax Breakdown</div>
                            <div>Rate: {(t.taxRate * 100).toFixed(2)}%</div>
                            <div>Tax: {fmtMoney(t.taxAmountCents)} on {fmtMoney(t.amountCents)}</div>
                          </div>
                          <div>
                            <div className="text-zinc-500 uppercase tracking-widest text-[9px] mb-1">Charge ID</div>
                            <div className="break-all">{t.stripeChargeId}</div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
