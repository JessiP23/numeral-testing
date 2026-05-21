"use client";

import { StatusBadge, statusToVariant } from "./StatusBadge";

type Evt = {
  id: string;
  type: string;
  status: string;
  errorMessage: string | null;
  receivedAt: string | Date;
  processedAt: string | Date | null;
};

function fmtTime(d: string | Date) {
  return new Date(d).toLocaleTimeString();
}

function latencyMs(received: string | Date, processed: string | Date | null) {
  if (!processed) return null;
  return new Date(processed).getTime() - new Date(received).getTime();
}

export function EventLog({ events }: { events: Evt[] }) {
  return (
    <div className="border border-zinc-800/80 bg-zinc-950/40">
      <header className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-3">
        <h2 className="font-mono text-xs uppercase tracking-widest text-zinc-400">
          Webhook Event Log
        </h2>
        <span className="font-mono text-[11px] text-zinc-500">{events.length} events</span>
      </header>

      <div className="max-h-[360px] overflow-y-auto">
        <table className="w-full font-mono text-[11px]">
          <thead className="sticky top-0 bg-zinc-950/95 backdrop-blur">
            <tr className="border-b border-zinc-800/80 text-left text-[10px] uppercase tracking-widest text-zinc-500">
              <th className="px-3 py-2 font-medium">Event ID</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Latency</th>
              <th className="px-3 py-2 font-medium">Received</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-600">
                  No webhook events yet
                </td>
              </tr>
            )}
            {events.map((e) => {
              const lat = latencyMs(e.receivedAt, e.processedAt);
              const isPending = e.status === "PENDING";
              const isDup = e.status === "DUPLICATE";
              return (
                <tr
                  key={e.id}
                  className={`border-b border-zinc-900 ${
                    e.status === "FAILED" ? "bg-rose-500/5" : ""
                  }`}
                >
                  <td className="px-3 py-2 text-zinc-300">{e.id.slice(0, 22)}…</td>
                  <td className="px-3 py-2 text-zinc-400">{e.type}</td>
                  <td className="px-3 py-2">
                    <StatusBadge
                      label={e.status}
                      variant={statusToVariant(e.status)}
                      pulse={isPending}
                      strikethrough={isDup}
                    />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-500">
                    {lat == null ? "—" : `${lat}ms`}
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{fmtTime(e.receivedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
