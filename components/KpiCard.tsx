import type { LucideIcon } from "lucide-react";

// A headline figure: the label says what it is, the condensed numeral is the figure, the note says how to read it.
const TONE: Record<string, string> = {
  default: "text-slate-900",
  good: "text-emerald-700",
  warn: "text-amber-700",
  bad: "text-rose-600",
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
    <div className="card flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <p className={`numeral mt-1.5 text-3xl ${TONE[tone]}`}>{value}</p>
        {sublabel && <p className="mt-1.5 text-xs text-slate-500">{sublabel}</p>}
      </div>
      {Icon && <Icon size={20} className="mt-0.5 shrink-0 text-slate-300" aria-hidden="true" />}
    </div>
  );
}
