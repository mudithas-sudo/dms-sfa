"use client";

import { useState } from "react";
import { createSchedule } from "@/app/actions/report-actions";

interface Opt {
  value: string;
  label: string;
}
interface Def {
  id: string;
  title: string;
  filters: { key: string; label: string; type: string; options?: Opt[]; default?: string }[];
}

// New report schedule: pick a report and its saved filters, how often, in which format and to whom.
export default function ScheduleForm({ reports, options }: { reports: Def[]; options: Record<string, Opt[]> }) {
  const [id, setId] = useState(reports[0]?.id ?? "");
  const def = reports.find((r) => r.id === id);
  const optsFor = (f: Def["filters"][number]) => f.options ?? options[f.type] ?? options[f.key] ?? [];
  const dated = def?.filters.some((f) => f.type === "date" || f.type === "month");

  return (
    <form action={createSchedule} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="name">Schedule name</label>
          <input className="input" id="name" name="name" required placeholder="e.g. Daily sales summary — Cebu" />
        </div>
        <div>
          <label className="label" htmlFor="reportType">Report</label>
          <select className="input" id="reportType" name="reportType" value={id} onChange={(e) => setId(e.target.value)}>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>{r.title}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-3" key={id}>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 sm:col-span-3">Saved filters</p>
        {def?.filters.filter((f) => !["date", "month"].includes(f.type)).map((f) => (
          <div key={f.key}>
            <label className="label">{f.label}</label>
            {f.type === "text" || f.type === "number" ? (
              <input className="input" name={`f_${f.key}`} type={f.type} />
            ) : f.type === "branch" ? (
              <select className="input" name={`f_${f.key}`} multiple size={3}>
                {optsFor(f).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : (
              <select className="input" name={`f_${f.key}`} defaultValue={f.default ?? ""}>
                {!f.default && <option value="">All</option>}
                {optsFor(f).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            )}
          </div>
        ))}
        {dated && (
          <div>
            <label className="label" htmlFor="relativeDates">Period</label>
            <select className="input" id="relativeDates" name="relativeDates" defaultValue="previous_day">
              <option value="previous_day">Previous day</option>
              <option value="previous_week">Previous 7 days</option>
              <option value="previous_month">Previous month</option>
              <option value="">Report default</option>
            </select>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <label className="label" htmlFor="frequency">Frequency</label>
          <select className="input" id="frequency" name="frequency" defaultValue="daily">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="time">Time</label>
          <input className="input" id="time" name="time" type="time" defaultValue="07:00" />
        </div>
        <div>
          <label className="label" htmlFor="format">Format</label>
          <select className="input" id="format" name="format" defaultValue="excel">
            <option value="excel">Excel</option>
            <option value="pdf">PDF</option>
            <option value="both">Excel + PDF</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="recipientEmails">Recipients</label>
          <input className="input" id="recipientEmails" name="recipientEmails" required placeholder="a@x.com, b@x.com" />
        </div>
      </div>
      <button type="submit" className="btn-primary">Create schedule</button>
    </form>
  );
}
