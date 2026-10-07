import Link from "next/link";
import { branchRollup } from "@/lib/network";
import { currentScope } from "@/lib/report-runner";
import { daysAgo, formatCurrency, formatDateTime } from "@/lib/format";
import AutoRefresh from "@/components/dashboards/AutoRefresh";

// Head-office consolidated view: receivables and returns for every branch side by side, with a drill-down into the
// matching report for each branch.
export default async function NetworkView({ reportsBase, days, profileBase }: { reportsBase: string; days: number; profileBase?: string }) {
  const scope = await currentScope();
  const { rows, labels } = await branchRollup(scope, days);
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  const rep = (id: string, branch: string, extra = "") => `${reportsBase}/${id}?run=1&branch=${branch}${extra}`;
  const all = (id: string, extra = "") => `${reportsBase}/${id}?run=1${extra}`;
  const totalOut = sum((r) => r.outstanding);

  return (
    <div className="space-y-6">
      <AutoRefresh minutes={5} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Head Office — Branch Network View</h2>
          <p className="text-xs text-slate-500">Receivables and returns of every distribution branch side by side. Click a branch figure to open the detail behind it. Returns cover the last {days} days. Last refreshed {formatDateTime(new Date())}.</p>
        </div>
        <form method="get" className="flex items-end gap-2">
          <div>
            <label className="label" htmlFor="days">Returns period</label>
            <select className="input" id="days" name="days" defaultValue={String(days)}>
              {[7, 30, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}
            </select>
          </div>
          <button className="btn-secondary" type="submit">Show</button>
        </form>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4"><p className="text-xs text-slate-500">Receivables outstanding (all branches)</p><p className="text-xl font-semibold text-slate-900">{formatCurrency(totalOut)}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Overdue</p><p className="text-xl font-semibold text-rose-600">{formatCurrency(sum((r) => r.overdue))}</p><p className="text-[11px] text-slate-400">{totalOut ? Math.round((sum((r) => r.overdue) / totalOut) * 100) : 0}% of outstanding</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Market returns awaiting credit</p><p className="text-xl font-semibold text-amber-600">{sum((r) => r.market.awaitingCredit)}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Central-warehouse returns in transit / awaiting approval</p><p className="text-xl font-semibold text-slate-900">{sum((r) => r.central.inTransit)} / {sum((r) => r.central.awaitingApproval)}</p></div>
      </div>

      <div className="card overflow-x-auto">
        <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Accounts receivable by branch</h3>
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Branch</th><th className="th text-right">Outstanding</th>
              {labels.map((l) => <th key={l} className="th text-right">{l}</th>)}
              <th className="th text-right">Overdue %</th><th className="th text-right">Collected ({days}d)</th><th className="th text-right">Pending cheques</th><th className="th text-right">Over limit</th><th className="th text-right">On hold / blocked</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="td font-medium text-slate-900">{profileBase ? <Link className="text-blue-700 hover:underline" href={`${profileBase}/${r.id}`}>{r.name}</Link> : r.name}</td>
                <td className="td text-right"><Link className="text-blue-700 hover:underline" href={rep("receivables-ageing", r.id)}>{formatCurrency(r.outstanding)}</Link></td>
                {r.buckets.map((b, i) => <td key={i} className={`td text-right ${i > 0 && b ? "text-rose-600" : ""}`}>{b ? formatCurrency(b) : "—"}</td>)}
                <td className="td text-right">{r.outstanding ? `${Math.round((r.overdue / r.outstanding) * 100)}%` : "—"}</td>
                <td className="td text-right"><Link className="text-blue-700 hover:underline" href={rep("sfa-collections", r.id)}>{formatCurrency(r.collections)}</Link></td>
                <td className="td text-right">{r.pendingCheques ? formatCurrency(r.pendingCheques) : "—"}</td>
                <td className="td text-right">{r.overLimit || "—"}</td>
                <td className="td text-right">{r.onHold || "—"} <span className="text-[10px] text-slate-400">of {r.customers}</span></td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
            <tr>
              <td className="td">Network</td><td className="td text-right">{formatCurrency(totalOut)}</td>
              {labels.map((_, i) => <td key={i} className="td text-right">{formatCurrency(sum((r) => r.buckets[i]))}</td>)}
              <td className="td text-right">{totalOut ? `${Math.round((sum((r) => r.overdue) / totalOut) * 100)}%` : "—"}</td>
              <td className="td text-right">{formatCurrency(sum((r) => r.collections))}</td><td className="td text-right">{formatCurrency(sum((r) => r.pendingCheques))}</td>
              <td className="td text-right">{sum((r) => r.overLimit)}</td><td className="td text-right">{sum((r) => r.onHold)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="px-4 py-2 text-[11px] text-slate-400">
          <Link className="text-blue-600 underline" href={all("receivables-ageing", "&groupBy=branch")}>Open the network ageing report</Link> · by route: <Link className="text-blue-600 underline" href={all("receivables-ageing", "&groupBy=route")}>route ageing</Link> · <Link className="text-blue-600 underline" href={all("receivables-ageing")}>by customer</Link>
        </p>
      </div>

      <div className="card overflow-x-auto">
        <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Returns by branch (last {days} days)</h3>
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Branch</th>
              <th className="th text-right">Market returns</th><th className="th text-right">Value</th><th className="th text-right">Awaiting credit note</th><th className="th text-right">Outside policy</th>
              <th className="th text-right">Van returns</th><th className="th text-right">Variance open</th>
              <th className="th text-right">To central warehouse</th><th className="th text-right">Awaiting approval</th><th className="th text-right">In transit</th><th className="th text-right">Discrepancies</th>
              <th className="th text-right">Claims open</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="td font-medium text-slate-900"><Link className="text-blue-700 hover:underline" href={rep("returns-register", r.id, `&dateFrom=${daysAgo(days).toISOString().slice(0, 10)}`)}>{r.name}</Link></td>
                <td className="td text-right">{r.market.count}</td><td className="td text-right">{formatCurrency(r.market.value)}</td>
                <td className={`td text-right ${r.market.awaitingCredit ? "text-amber-600" : ""}`}>{r.market.awaitingCredit || "—"}</td><td className="td text-right">{r.market.outsidePolicy || "—"}</td>
                <td className="td text-right">{r.van.count} <span className="text-[10px] text-slate-400">({r.van.units} units)</span></td><td className={`td text-right ${r.van.varianceOpen ? "text-rose-600" : ""}`}>{r.van.varianceOpen || "—"}</td>
                <td className="td text-right">{r.central.count} <span className="text-[10px] text-slate-400">({r.central.units} units)</span></td><td className="td text-right">{r.central.awaitingApproval || "—"}</td><td className="td text-right">{r.central.inTransit || "—"}</td><td className={`td text-right ${r.central.discrepancies ? "text-rose-600" : ""}`}>{r.central.discrepancies || "—"}</td>
                <td className="td text-right"><Link className="text-blue-700 hover:underline" href={rep("claims-register", r.id)}>{r.claimsPending || "—"}</Link></td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
            <tr>
              <td className="td">Network</td>
              <td className="td text-right">{sum((r) => r.market.count)}</td><td className="td text-right">{formatCurrency(sum((r) => r.market.value))}</td><td className="td text-right">{sum((r) => r.market.awaitingCredit)}</td><td className="td text-right">{sum((r) => r.market.outsidePolicy)}</td>
              <td className="td text-right">{sum((r) => r.van.count)}</td><td className="td text-right">{sum((r) => r.van.varianceOpen)}</td>
              <td className="td text-right">{sum((r) => r.central.count)}</td><td className="td text-right">{sum((r) => r.central.awaitingApproval)}</td><td className="td text-right">{sum((r) => r.central.inTransit)}</td><td className="td text-right">{sum((r) => r.central.discrepancies)}</td><td className="td text-right">{sum((r) => r.claimsPending)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="px-4 py-2 text-[11px] text-slate-400">Market returns are goods taken back from customers; van returns are unsold stock returned to the branch warehouse; central-warehouse returns are bad stock sent back to Company F and B.</p>
      </div>
    </div>
  );
}
