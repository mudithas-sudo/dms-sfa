import type { LucideIcon } from "lucide-react";

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
  const toneClasses: Record<string, string> = {
    default: "bg-blue-50 text-blue-600",
    good: "bg-emerald-50 text-emerald-600",
    warn: "bg-amber-50 text-amber-600",
    bad: "bg-rose-50 text-rose-600",
  };

  return (
    <div className="card flex items-start justify-between p-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-1.5 text-2xl font-semibold text-slate-900">{value}</p>
        {sublabel && <p className="mt-1 text-xs text-slate-500">{sublabel}</p>}
      </div>
      {Icon && (
        <div className={`rounded-lg p-2 ${toneClasses[tone]}`}>
          <Icon size={20} />
        </div>
      )}
    </div>
  );
}
