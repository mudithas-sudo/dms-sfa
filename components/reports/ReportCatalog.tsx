import Link from "next/link";
import { AREA_LABEL, type ReportDef } from "@/lib/reports";

// The standard report catalog, grouped by business area; only reports the role is permitted to open are listed.
export default function ReportCatalog({ reports, basePath }: { reports: ReportDef[]; basePath: string }) {
  const areas = [...new Set(reports.map((r) => r.area))];
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Report Catalog</h2>
        <p className="text-xs text-slate-500">
          Choose a report, set its filters and run it on screen; it can then be exported to Excel, CSV or PDF (with export permission), scheduled, or drilled into. Branch users see only their own branch.
        </p>
      </div>
      {areas.map((a) => (
        <div key={a}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{AREA_LABEL[a]}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {reports.filter((r) => r.area === a).map((r) => (
              <Link key={r.id} href={`${basePath}/${r.id}`} className="card p-4 transition hover:border-blue-300 hover:shadow">
                <p className="text-sm font-semibold text-slate-900">{r.title}</p>
                <p className="mt-1 text-xs text-slate-500">{r.purpose}</p>
                <p className="mt-2 text-[11px] text-slate-400">Filters: {r.filters.map((f) => f.label).join(", ")}</p>
              </Link>
            ))}
          </div>
        </div>
      ))}
      {reports.length === 0 && <p className="text-sm text-slate-400">No reports are available to your role.</p>}
    </div>
  );
}
