import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/lib/rbac";
import { DASHBOARDS, dashboardById, type Tile } from "@/lib/dashboards";
import { filterOptions, type Filters } from "@/lib/reports";
import { currentScope } from "@/lib/report-runner";
import { getAllSettings, num } from "@/lib/settings";
import AutoRefresh from "@/components/dashboards/AutoRefresh";
import PrintButton from "@/components/PrintButton";
import { formatDateTime } from "@/lib/format";

type Params = Record<string, string | string[] | undefined>;

const TONE: Record<string, string> = { good: "text-emerald-600", warn: "text-amber-600", bad: "text-rose-600" };

export async function DashboardIndex({ basePath }: { basePath: string }) {
  const out = [];
  for (const d of DASHBOARDS) if ((await can("reports", "view")) && (await can(d.module, "view"))) out.push(d);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Operational Dashboards</h2>
        <p className="text-xs text-slate-500">Each tile is defined once and drills down to the report or screen behind the figure. Dashboards are limited to the branches you may see.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {out.map((d) => (
          <Link key={d.id} href={`${basePath}/${d.id}`} className="card p-4 transition hover:border-blue-300 hover:shadow">
            <p className="text-sm font-semibold text-slate-900">{d.title}</p>
            <p className="mt-1 text-xs text-slate-500">{d.blurb}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default async function DashboardView({ id, basePath, reportsBase, params }: { id: string; basePath: string; reportsBase: string; params: Params }) {
  const def = dashboardById(id);
  if (!def) notFound();
  if (!(await can("reports", "view")) || !(await can(def.module, "view"))) return <p className="card p-6 text-sm text-slate-600">Your role does not have access to the {def.title} dashboard.</p>;
  const scope = await currentScope();
  const settings = await getAllSettings();
  const minutes = num(settings, "dashboard.refreshMinutes");
  const filters: Filters = {};
  for (const k of ["branch", "dateFrom", "dateTo", "channel", "route", "rep"]) {
    const v = params[k];
    const s = Array.isArray(v) ? v.join(",") : v;
    if (s) filters[k] = s;
  }
  const [tiles, opts] = await Promise.all([def.tiles(filters, scope), filterOptions(scope)]);
  const refreshed = new Date();
  const drill = (t: Tile) => (t.href ? (t.href.startsWith("/reports/") ? `${reportsBase}${t.href.slice("/reports".length)}` : t.href) : null);
  const f = def.filters;

  return (
    <div className="space-y-4">
      <AutoRefresh minutes={minutes} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Link href={basePath} className="hover:underline">Dashboards</Link>
            <span>/</span>
            <span className="text-slate-900">{def.title}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{def.blurb}</p>
        </div>
        <div className="no-print flex items-center gap-3 text-xs text-slate-500">
          <span>Last refreshed {formatDateTime(refreshed)}{minutes ? ` · auto-refresh every ${minutes} min` : ""}</span>
          <PrintButton />
        </div>
      </div>

      <form method="get" className="no-print card grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
        {f.includes("branch") && (
          <div>
            <label className="label">Branch</label>
            {scope.branchIds ? (
              <p className="input bg-slate-50 text-slate-600">{opts.branch.map((b) => b.label).join(", ") || "My branch"}</p>
            ) : (
              <select className="input" name="branch" multiple size={2} defaultValue={(filters.branch ?? "").split(",").filter(Boolean)}>
                {opts.branch.map((b) => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </select>
            )}
          </div>
        )}
        {f.includes("date") && (
          <>
            <div><label className="label">From</label><input className="input" type="date" name="dateFrom" defaultValue={filters.dateFrom ?? ""} /></div>
            <div><label className="label">To</label><input className="input" type="date" name="dateTo" defaultValue={filters.dateTo ?? ""} /></div>
          </>
        )}
        {f.includes("channel") && (
          <div><label className="label">Channel</label><select className="input" name="channel" defaultValue={filters.channel ?? ""}><option value="">All</option>{opts.channel.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
        )}
        {f.includes("route") && (
          <div><label className="label">Route</label><select className="input" name="route" defaultValue={filters.route ?? ""}><option value="">All</option>{opts.route.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
        )}
        {f.includes("rep") && (
          <div><label className="label">Representative</label><select className="input" name="rep" defaultValue={filters.rep ?? ""}><option value="">All</option>{opts.rep.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
        )}
        <div className="flex items-end gap-2"><button className="btn-primary" type="submit">Apply</button><Link href={`${basePath}/${def.id}`} className="btn-secondary">Reset</Link></div>
      </form>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => {
          const href = drill(t);
          const inner = (
            <>
              <p className="text-xs text-slate-500">{t.label}</p>
              <p className={`mt-1 text-2xl font-semibold ${t.tone ? TONE[t.tone] : "text-slate-900"}`}>{t.value}</p>
              {t.sub && <p className="mt-0.5 text-[11px] text-slate-400">{t.sub}</p>}
              {href && <p className="mt-2 text-[11px] text-blue-600">Drill down →</p>}
            </>
          );
          return href ? (
            <Link key={t.label} href={href} className="card p-4 transition hover:border-blue-300 hover:shadow">{inner}</Link>
          ) : (
            <div key={t.label} className="card p-4">{inner}</div>
          );
        })}
      </div>
    </div>
  );
}
