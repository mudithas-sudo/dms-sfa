import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { currentScope } from "@/lib/report-runner";
import { returnsView } from "@/lib/headoffice";
import { formatCurrency, formatDate } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";

// Head office: every return record from every branch — what customers sent back, what branches sent to the central
// warehouse, and what vans brought back unsold — with the status that tells head office what still needs action.
export default async function ReturnsPage({ searchParams }: { searchParams: Promise<{ branch?: string; days?: string }> }) {
  const { branch, days: d } = await searchParams;
  const days = Math.max(1, Math.min(365, Number(d) || 30));
  const scope = await currentScope();
  const [v, branches] = await Promise.all([returnsView(scope, branch || undefined, days), prisma.branch.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })]);
  const sum = (f: (r: (typeof v.rows)[number]) => number) => v.rows.reduce((a, r) => a + f(r), 0);
  const marketValue = v.market.reduce((s, m) => s + m.product.unitPrice * m.qty, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Returns — all branches</h2>
          <p className="text-xs text-slate-500">Goods coming back to the network: from customers, from vans and from branches to the central warehouse.</p>
        </div>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <div><label className="label" htmlFor="branch">Branch</label><select className="input" id="branch" name="branch" defaultValue={branch ?? ""}><option value="">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
          <div><label className="label" htmlFor="days">Period</label><select className="input" id="days" name="days" defaultValue={String(days)}>{[7, 30, 90, 180].map((n) => <option key={n} value={n}>Last {n} days</option>)}</select></div>
          <button className="btn-secondary" type="submit">Show</button>
        </form>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4"><p className="text-xs text-slate-500">Returned by customers</p><p className="text-xl font-semibold">{formatCurrency(marketValue)}</p><p className="text-[11px] text-slate-400">{v.market.length} returns · {sum((r) => r.market.awaitingCredit)} awaiting a credit note</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Outside the return policy</p><p className="text-xl font-semibold text-amber-600">{sum((r) => r.market.outsidePolicy)}</p><p className="text-[11px] text-slate-400">need an exception approval</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">To the central warehouse</p><p className="text-xl font-semibold">{sum((r) => r.central.units)} units</p><p className="text-[11px] text-slate-400">{sum((r) => r.central.awaitingApproval)} awaiting approval · {sum((r) => r.central.inTransit)} in transit</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Discrepancies and variances</p><p className="text-xl font-semibold text-rose-600">{sum((r) => r.central.discrepancies) + sum((r) => r.van.varianceOpen)}</p><p className="text-[11px] text-slate-400">central {sum((r) => r.central.discrepancies)} · van {sum((r) => r.van.varianceOpen)}</p></div>
      </div>

      <div className="card overflow-x-auto">
        <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Returns by branch</h3>
        <table className="w-full">
          <thead className="bg-slate-50"><tr><th className="th">Branch</th><th className="th text-right">Customer returns</th><th className="th text-right">Value</th><th className="th text-right">Awaiting credit note</th><th className="th text-right">Van returns</th><th className="th text-right">To central warehouse</th><th className="th text-right">Awaiting approval</th><th className="th text-right">In transit</th><th className="th text-right">Discrepancies</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {v.rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="td font-medium"><Link className="text-blue-700 hover:underline" href={`/admin/network/${r.id}`}>{r.name}</Link></td>
                <td className="td text-right">{r.market.count}</td><td className="td text-right">{formatCurrency(r.market.value)}</td>
                <td className={`td text-right ${r.market.awaitingCredit ? "text-amber-600" : ""}`}>{r.market.awaitingCredit || "—"}</td>
                <td className="td text-right">{r.van.count}</td>
                <td className="td text-right">{r.central.count} <span className="text-[10px] text-slate-400">({r.central.units} units)</span></td>
                <td className="td text-right">{r.central.awaitingApproval || "—"}</td><td className="td text-right">{r.central.inTransit || "—"}</td>
                <td className={`td text-right ${r.central.discrepancies ? "text-rose-600" : ""}`}>{r.central.discrepancies || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto">
        <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Returned by customers <span className="font-normal text-slate-400">({v.market.length})</span></h3>
        <table className="w-full">
          <thead className="bg-slate-50"><tr><th className="th">Date</th><th className="th">Branch</th><th className="th">Customer</th><th className="th">Product</th><th className="th text-right">Qty</th><th className="th text-right">Value</th><th className="th">Reason</th><th className="th">Credit note</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {v.market.map((m) => (
              <tr key={m.id}>
                <td className="td">{formatDate(m.createdAt)}</td><td className="td">{m.outlet.branch.name.replace(" Branch", "")}</td><td className="td">{m.outlet.name}</td><td className="td">{m.product.name}</td>
                <td className="td text-right">{m.qty}</td><td className="td text-right">{formatCurrency(m.product.unitPrice * m.qty)}</td>
                <td className="td">{m.reason}{m.outsidePolicy ? <span className="ml-1 text-[10px] text-rose-600">outside policy</span> : null}</td>
                <td className="td">{m.creditNote ? <>{m.creditNote.noteNumber} <StatusBadge status={m.creditNote.status} /></> : <StatusBadge status={m.status} />}</td>
              </tr>
            ))}
            {v.market.length === 0 && <tr><td className="td text-slate-400" colSpan={8}>No customer returns in this period.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto">
        <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Branch returns to the central warehouse <span className="font-normal text-slate-400">({v.central.length})</span></h3>
        <table className="w-full">
          <thead className="bg-slate-50"><tr><th className="th">Date</th><th className="th">Return</th><th className="th">Branch</th><th className="th">Product</th><th className="th text-right">Sent</th><th className="th text-right">Received</th><th className="th">Reason</th><th className="th">Status</th><th className="th">ERP</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {v.central.map((s) => (
              <tr key={s.id}>
                <td className="td">{formatDate(s.createdAt)}</td><td className="td">{s.returnNumber ?? "draft"}</td><td className="td">{s.warehouse.branch.name.replace(" Branch", "")}</td><td className="td">{s.product.name}</td>
                <td className="td text-right">{s.qty}</td><td className={`td text-right ${s.qtyReceived != null && s.qtyReceived !== s.qty ? "text-rose-600" : ""}`}>{s.qtyReceived ?? "—"}</td>
                <td className="td">{s.reason}{s.discrepancyNote ? <p className="text-[10px] text-rose-600">{s.discrepancyNote}</p> : null}</td>
                <td className="td"><StatusBadge status={s.status} /></td><td className="td text-xs text-slate-500">{s.erpReference ?? "—"}</td>
              </tr>
            ))}
            {v.central.length === 0 && <tr><td className="td text-slate-400" colSpan={9}>No returns to the central warehouse in this period.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto">
        <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Van returns — unsold stock back to the branch <span className="font-normal text-slate-400">({v.van.length})</span></h3>
        <table className="w-full">
          <thead className="bg-slate-50"><tr><th className="th">Date</th><th className="th">Branch</th><th className="th">Van</th><th className="th">Product</th><th className="th text-right">Declared</th><th className="th text-right">Received</th><th className="th">Condition</th><th className="th">Status</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {v.van.map((r) => (
              <tr key={r.id}>
                <td className="td">{formatDate(r.createdAt)}</td><td className="td">{r.van.branch.name.replace(" Branch", "")}</td><td className="td">{r.van.code}</td><td className="td">{r.product.name}</td>
                <td className="td text-right">{r.qtyDeclared ?? r.qty}</td><td className={`td text-right ${r.qtyReceived != null && r.qtyReceived !== (r.qtyDeclared ?? r.qty) ? "text-rose-600" : ""}`}>{r.qtyReceived ?? "—"}</td>
                <td className="td">{r.condition}</td><td className="td"><StatusBadge status={r.status} /></td>
              </tr>
            ))}
            {v.van.length === 0 && <tr><td className="td text-slate-400" colSpan={8}>No van returns in this period.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
