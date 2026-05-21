type Variant = "success" | "warning" | "error" | "neutral" | "info";

const STYLES: Record<Variant, string> = {
  success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  warning: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  error: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  info: "bg-sky-500/10 text-sky-400 border-sky-500/30",
  neutral: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
};

const DOT: Record<Variant, string> = {
  success: "bg-emerald-400",
  warning: "bg-amber-400",
  error: "bg-rose-400",
  info: "bg-sky-400",
  neutral: "bg-zinc-400",
};

export function StatusBadge({
  label,
  variant = "neutral",
  pulse = false,
  strikethrough = false,
}: {
  label: string;
  variant?: Variant;
  pulse?: boolean;
  strikethrough?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${STYLES[variant]} ${strikethrough ? "line-through opacity-60" : ""}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[variant]} ${pulse ? "animate-pulse" : ""}`} />
      {label}
    </span>
  );
}

export function statusToVariant(status: string): Variant {
  switch (status) {
    case "RECORDED":
    case "PROCESSED":
    case "SAFE":
    case "COMPLETE":
      return "success";
    case "REFUNDED":
    case "WARNING":
    case "PENDING":
    case "RUNNING":
      return "warning";
    case "DISPUTED":
    case "FAILED":
    case "EXCEEDED":
      return "error";
    case "DUPLICATE":
      return "neutral";
    default:
      return "info";
  }
}
