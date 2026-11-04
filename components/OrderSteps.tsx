import type { LucideIcon } from "lucide-react";
import { Check, CircleDot } from "lucide-react";

// The stages of a document as a row of tiles: finished stages are tinted, the current one is outlined in the accent.
export interface StageTile {
  label: string;
  note?: string;
  icon: LucideIcon;
}

export function StepTiles({ steps, current }: { steps: StageTile[]; current: number }) {
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] sm:gap-3">
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        const Icon = s.icon;
        return (
          <li key={s.label} className="step-tile" data-state={state} aria-current={state === "current" ? "step" : undefined}>
            <span className="step-icon">{state === "done" ? <Check size={20} strokeWidth={2.4} /> : <Icon size={20} />}</span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-tight text-slate-900">{s.label}</span>
              {s.note && <span className="block text-xs leading-tight text-slate-500">{s.note}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export interface TimelineEvent {
  title: string;
  note?: string;
  when: string;
}

// A vertical travel log, newest first: the latest event is marked with the accent, earlier ones with a tick.
export function Timeline({ events, empty = "No recorded events." }: { events: TimelineEvent[]; empty?: string }) {
  if (events.length === 0) return <p className="text-sm text-slate-400">{empty}</p>;
  return (
    <ol className="relative">
      {events.map((e, i) => (
        <li key={`${e.when}-${i}`} className="relative flex gap-3 pb-5 last:pb-0">
          {i < events.length - 1 && <span className="absolute left-[11px] top-6 h-[calc(100%-1.25rem)] w-px bg-slate-200" aria-hidden="true" />}
          <span className={`z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${i === 0 ? "bg-blue-100 text-blue-600" : "border border-slate-300 bg-white text-slate-500"}`}>
            {i === 0 ? <CircleDot size={14} /> : <Check size={13} strokeWidth={2.6} />}
          </span>
          <div className="min-w-0">
            <p className={`text-sm ${i === 0 ? "font-semibold text-slate-900" : "text-slate-800"}`}>{e.title}</p>
            {e.note && <p className="text-xs text-slate-500">{e.note}</p>}
            <p className="text-xs text-slate-400">{e.when}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
