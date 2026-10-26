import { Phone, Truck } from "lucide-react";

// Small building blocks for the tracking-style screens: an initials avatar, a round call button,
// and a progress line with a truck riding along it.

export function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

const TINTS = ["bg-blue-50 text-blue-700", "bg-blue-100 text-blue-800", "bg-slate-100 text-slate-600"];

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const tint = TINTS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % TINTS.length];
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${tint}`} style={{ width: size, height: size, fontSize: size * 0.34 }} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}

// A real tel: link; renders nothing when there is no number on file.
export function CallButton({ phone, label }: { phone?: string | null; label: string }) {
  if (!phone) return null;
  return (
    <a href={`tel:${phone.replace(/\s+/g, "")}`} className="btn-round" aria-label={`Call ${label}`} title={`Call ${label} · ${phone}`}>
      <Phone size={15} />
    </a>
  );
}

export interface Step {
  label: string;
  note?: string;
}

// `at` is how far along the line the truck is, 0 to 1. Steps are spread evenly, first at the start and last at the end.
export function ProgressTrack({ steps, at, doneThrough }: { steps: Step[]; at: number; doneThrough: number }) {
  const pct = Math.max(0, Math.min(1, at)) * 100;
  return (
    <div className="px-4 pb-1 pt-2">
      <div className="track">
        <div className="track-fill" style={{ width: `${pct}%` }} />
        {steps.map((s, i) => {
          const left = steps.length === 1 ? 0 : (i / (steps.length - 1)) * 100;
          const done = i <= doneThrough;
          return <span key={s.label} className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${done ? "border-blue-600 bg-blue-600" : "border-slate-200 bg-white"}`} style={{ left: `${left}%` }} />;
        })}
        <span className="track-truck" style={{ left: `${pct}%` }}>
          <Truck size={15} />
        </span>
      </div>
      <div className="mt-3 flex justify-between text-xs">
        {steps.map((s, i) => (
          <div key={s.label} className={`min-w-0 flex-1 ${i === 0 ? "text-left" : i === steps.length - 1 ? "text-right" : "text-center"}`}>
            <p className={`font-semibold ${i <= doneThrough ? "text-slate-900" : "text-slate-400"}`}>{s.label}</p>
            {s.note && <p className="text-slate-400">{s.note}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
