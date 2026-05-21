export function MetricCard({
  label,
  value,
  sublabel,
  alert = false,
}: {
  label: string;
  value: string;
  sublabel?: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`border bg-zinc-950/40 p-5 ${alert ? "border-rose-500/40" : "border-zinc-800/80"}`}
    >
      <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
        {label}
      </div>
      <div
        className={`mt-2 font-mono text-3xl tabular-nums ${alert ? "text-rose-400" : "text-zinc-100"}`}
      >
        {value}
      </div>
      {sublabel && (
        <div className="mt-1 font-mono text-[11px] text-zinc-500">{sublabel}</div>
      )}
    </div>
  );
}
