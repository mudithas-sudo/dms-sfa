import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/lib/rbac";
import { filterOptions, reportById, type Filters, type FilterDef } from "@/lib/reports";
import { currentScope, describeFilters, execute, filtersFromParams, fmtCell, labelMaps } from "@/lib/report-runner";
import { ageingBounds, bucketLabels } from "@/lib/finance";
import { getAllSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/format";
import { Download } from "lucide-react";

type Params = Record<string, string | string[] | undefined>;

async function optionsFor(fd: FilterDef, opts: Awaited<ReturnType<typeof filterOptions>>) {
  if (fd.options) return fd.options;
  switch (fd.type) {
    case "branch": return opts.branch;
    case "channel": return opts.channel;
    case "subchannel": return opts.subchannel;
    case "route": return opts.route;
    case "rep": return opts.rep;
    case "category": return opts.category;
    case "product": return opts.product;
    case "warehouse": return opts.warehouse;
    case "customer": return opts.customer;
    default:
      if (fd.key === "promotion") return opts.promotion;
      if (fd.key === "bucket") return bucketLabels(ageingBounds((await getAllSettings())["ageing.buckets"])).map((l, i) => ({ value: String(i), label: l }));
      return [];
  }
}

const isNumeric = (t?: string) => t === "money" || t === "int" || t === "pct";

export default async function ReportRunner({ id, basePath, params }: { id: string; basePath: string; params: Params }) {
  const def = reportById(id);
  if (!def) notFound();
  const scope = await currentScope();
  if (!(await can("reports", "view")) || !(await can(def.module, "view"))) {
    return <p className="card p-6 text-sm text-slate-600">Your role does not have access to the {def.title} report.</p>;
  }
  const filters: Filters = filtersFromParams(def, params);
  const opts = await filterOptions(scope);
  const allowExport = await can("export", "edit");
  const run = params.run === "1";
  const out = run ? await execute(def.id, filters, scope) : null;
  const labels = await labelMaps(scope);
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) query.set(k, v);
  const resolved = await Promise.all(def.filters.map(async (fd) => [fd, await optionsFor(fd, opts)] as const));
  const linkCol = out ? Math.max(0, out.result.columns.findIndex((x) => !x.type || x.type === "text")) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href={basePath} className="hover:underline">Reports</Link>
        <span>/</span>
        <span className="text-slate-900">{def.title}</span>
      </div>
      <div>
        <h2 className="text-base font-semibold text-slate-900">{def.title}</h2>
        <p className="text-xs text-slate-500">{def.purpose}{scope.branchIds ? " Your branch scope is applied automatically." : " Head office: choose one, several or all branches."}</p>
      </div>

      <form method="get" className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <input type="hidden" name="run" value="1" />
        {resolved.map(([fd, options]) => (
          <div key={fd.key}>
            <label className="label" htmlFor={`f_${fd.key}`}>{fd.label}</label>
            {fd.type === "date" ? (
              <input className="input" id={`f_${fd.key}`} type="date" name={fd.key} defaultValue={filters[fd.key] ?? ""} />
            ) : fd.type === "month" ? (
              <input className="input" id={`f_${fd.key}`} type="month" name={fd.key} defaultValue={filters[fd.key] ?? ""} />
            ) : fd.type === "number" ? (
              <input className="input" id={`f_${fd.key}`} type="number" name={fd.key} defaultValue={filters[fd.key] ?? ""} />
            ) : fd.type === "text" ? (
              <input className="input" id={`f_${fd.key}`} name={fd.key} defaultValue={filters[fd.key] ?? ""} />
            ) : fd.type === "branch" && !scope.branchIds ? (
              <select className="input" id={`f_${fd.key}`} name={fd.key} multiple size={Math.min(4, Math.max(2, options.length))} defaultValue={(filters[fd.key] ?? "").split(",").filter(Boolean)}>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : (
              <select className="input" id={`f_${fd.key}`} name={fd.key} defaultValue={filters[fd.key] ?? ""}>
                {!fd.default && <option value="">{fd.type === "branch" ? "My branch(es)" : "All"}</option>}
                {options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            )}
          </div>
        ))}
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
          <button className="btn-primary" type="submit">Run report</button>
          <Link href={`${basePath}/${def.id}`} className="btn-secondary">Reset</Link>
        </div>
      </form>

      {out && (
        <div className="space-y-3">
          <div className="card flex flex-wrap items-start justify-between gap-3 p-4 text-xs text-slate-600">
            <div>
              <p><strong className="text-slate-900">{def.title}</strong></p>
              <p>{describeFilters(def, filters, labels)}</p>
              <p>Branch scope: {scope.branchIds ? scope.branchIds.map((b) => labels.branch[b] ?? b).join(", ") : filters.branch ? filters.branch.split(",").map((b) => labels.branch[b] ?? b).join(", ") : "All branches"} · Run {formatDateTime(out.ranAt)} by {scope.userName} · {out.result.rows.length} row(s)</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {allowExport ? (
                <>
                  <a className="btn-secondary" href={`/api/reports/${def.id}/export?format=excel&${query}`}><Download size={14} /> Excel</a>
                  <a className="btn-secondary" href={`/api/reports/${def.id}/export?format=csv&${query}`}><Download size={14} /> CSV</a>
                  <a className="btn-secondary" href={`/api/reports/${def.id}/export?format=pdf&${query}`} target="_blank" rel="noreferrer"><Download size={14} /> PDF</a>
                </>
              ) : (
                <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-500">Export is not enabled for your role</span>
              )}
            </div>
          </div>
          {out.result.note && <p className="text-xs text-slate-500">{out.result.note}</p>}
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  {out.result.columns.map((c) => (
                    <th key={c.key} className={`th ${isNumeric(c.type) ? "text-right" : ""}`}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {out.result.rows.map((r, i) => {
                  const href = r._href ? String(r._href) : null;
                  return (
                    <tr key={i} className="hover:bg-slate-50">
                      {out.result.columns.map((c, ci) => {
                        const text = fmtCell(r[c.key], c);
                        return (
                          <td key={c.key} className={`td ${isNumeric(c.type) ? "text-right" : ""}`}>
                            {href && ci === linkCol ? <Link href={href} className="text-blue-700 hover:underline">{text || "Open"}</Link> : text}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {out.result.rows.length === 0 && <tr><td className="td text-slate-400" colSpan={out.result.columns.length}>No rows for these filters.</td></tr>}
              </tbody>
              {out.result.totals && (
                <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                  <tr>
                    {out.result.columns.map((c) => (
                      <td key={c.key} className={`td ${isNumeric(c.type) ? "text-right" : ""}`}>{out.result.totals![c.key] === undefined ? "" : fmtCell(out.result.totals![c.key], c)}</td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
