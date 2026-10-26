import type { LucideIcon } from "lucide-react";

// A headline figure: the label says what it is, the numeral is the figure, the note says how to read it.
// The icon sits in a pastel disc whose colour follows the tone.
const TONE: Record<string, string> = {
  default: "text-slate-900",
  good: "text-emerald-700",
  warn: "text-amber-700",
  bad: "text-rose-600",
};
const DISC: Record<string, string> = {
  default: "bg-blue-50 text-blue-600",
  good: "bg-emerald-50 text-emerald-600",
  warn: "bg-amber-50 text-amber-600",
  bad: "bg-rose-50 text-rose-500",
};

export default function KpiCard({
  label,
  value,
  sublabel,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  sublabel?: string;
  icon?: LucideIcon;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  return (
    <div className="card flex items-start justify-between gap-3 p-5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <p className={`numeral mt-2 text-3xl ${TONE[tone]}`}>{value}</p>
        {sublabel && <p className="mt-2 text-xs text-slate-500">{sublabel}</p>}
      </div>
      {Icon && (
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${DISC[tone]}`}>
          <Icon size={18} aria-hidden="true" />
        </span>
      )}
    </div>
  );
}
