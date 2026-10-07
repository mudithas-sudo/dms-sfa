import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { currentScope } from "@/lib/report-runner";
import { receivablesView } from "@/lib/headoffice";
import { formatCurrency, formatDate } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

// Head office: what every branch's customers owe, how old it is, and who to chase.
export default async function ReceivablesPage({ searchParams }: { searchParams: Promise<{ branch?: string; days?: string }> }) {
  const { branch, days: d } = await searchParams;
  const days = Math.max(1, Math.min(365, Number(d) || 30));
  const scope = await currentScope();
  const [v, branches] = await Promise.all([receivablesView(scope, branch || undefined, days), prisma.branch.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })]);
  const sum = (f: (r: (typeof v.rows)[number]) => number) => v.rows.reduce((a, r) => a + f(r), 0);
  const out = sum((r) => r.outstanding);
  const overdue = sum((r) => r.overdue);
  const rep = (id: string, extra = "") => `/admin/reports/${id}?run=1${branch ? `&branch=${branch}` : ""}${extra}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Accounts Receivable — all branches</h2>
          <p className="text-xs text-slate-500">What the customers of every distribution branch owe Company F and B&apos;s network, how late it is, and who to chase.</p>
        </div>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <div><label className="label" htmlFor="branch">Branch</label><select className="input" id="branch" name="branch" defaultValue={branch ?? ""}><option value="">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
          <div><label className="label" htmlFor="days">Collections period</label><select className="input" id="days" name="days" defaultValue={String(days)}>{[7, 30, 90].map((n) => <option key={n} value={n}>Last {n} days</option>)}</select></div>
          <button className="btn-secondary" type="submit">Show</button>
        </form>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4"><p className="text-xs text-slate-500">Outstanding</p><p className="text-xl font-semibold">{formatCurrency(out)}</p><p className="text-[11px] text-slate-400">{v.customerCount} customers owe money</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Overdue</p><p className="text-xl font-semibold text-rose-600">{formatCurrency(overdue)}</p><p className="text-[11px] text-slate-400">{pct(overdue, out)} of outstanding · {sum((r) => r.overdueInvoices)} invoices</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Collected, last {days} days</p><p className="text-xl font-semibold text-emerald-700">{formatCurrency(sum((r) => r.collections))}</p><p className="text-[11px] text-slate-400">{formatCurrency(sum((r) => r.pendingCheques))} cheques not yet cleared</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Over credit limit / on hold</p><p className="text-xl font-semibold text-amber-600">{v.overLimit.length} / {sum((r) => r.onHold)}</p><p className="text-[11px] text-slate-400">customers over limit / on hold or blocked</p></div>
      </div>

      <div className="card overflow-x-auto">
        <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Receivables by branch</h3>
        <table className="w-full">
          <thead className="bg-slate-50"><tr><th className="th">Branch</th><th className="th text-right">Outstanding</th>{v.labels.map((l) => <th key={l} className="th text-right">{l}</th>)}<th className="th text-right">Overdue %</th><th className="th text-right">Collected</th><th className="th text-right">Pending cheques</th><th className="th text-right">Over limit</th><th className="th text-right">On hold</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {v.rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="td font-medium"><Link className="text-blue-700 hover:underline" href={`/admin/network/${r.id}`}>{r.name}</Link></td>
                <td className="td text-right">{formatCurrency(r.outstanding)}</td>
                {r.buckets.map((b, i) => <td key={i} className={`td text-right ${i > 0 && b ? "text-rose-600" : ""}`}>{b ? formatCurrency(b) : "—"}</td>)}
                <td className={`td text-right ${r.outstanding && r.overdue / r.outstanding > 0.3 ? "font-medium text-rose-600" : ""}`}>{pct(r.overdue, r.outstanding)}</td>
                <td className="td text-right">{formatCurrency(r.collections)}</td>
                <td className="td text-right">{r.pendingCheques ? formatCurrency(r.pendingCheques) : "—"}</td>
                <td className="td text-right">{r.overLimit || "—"}</td>
                <td className="td text-right">{r.onHold || "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-semibold"><tr><td className="td">Network</td><td className="td text-right">{formatCurrency(out)}</td>{v.labels.map((_, i) => <td key={i} className="td text-right">{formatCurrency(sum((r) => r.buckets[i]))}</td>)}<td className="td text-right">{pct(overdue, out)}</td><td className="td text-right">{formatCurrency(sum((r) => r.collections))}</td><td className="td text-right">{formatCurrency(sum((r) => r.pendingCheques))}</td><td className="td text-right">{sum((r) => r.overLimit)}</td><td className="td text-right">{sum((r) => r.onHold)}</td></tr></tfoot>
        </table>
        <p className="px-4 py-2 text-[11px] text-slate-400">Open the full ageing: <Link className="text-blue-600 underline" href={rep("receivables-ageing", "&groupBy=branch")}>by branch</Link> · <Link className="text-blue-600 underline" href={rep("receivables-ageing", "&groupBy=route")}>by route</Link> · <Link className="text-blue-600 underline" href={rep("receivables-ageing")}>by customer</Link> · <Link className="text-blue-600 underline" href={rep("credit-exposure")}>credit exposure</Link></p>
      </div>

      <div className="card overflow-x-auto">
        <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Customers to chase — largest overdue balances</h3>
        <table className="w-full">
          <thead className="bg-slate-50"><tr><th className="th">Customer</th><th className="th">Branch</th><th className="th text-right">Overdue</th><th className="th text-right">Total owed</th><th className="th text-right">Invoices</th><th className="th text-right">Oldest (days late)</th><th className="th">Credit</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {v.overdueCustomers.map((c) => (
              <tr key={c.outlet.id} className="hover:bg-slate-50">
                <td className="td font-medium text-slate-900">{c.outlet.name} <span className="text-[10px] font-normal text-slate-400">{c.outlet.code}</span></td>
                <td className="td"><Link className="text-blue-700 hover:underline" href={`/admin/network/${c.outlet.branch.id}`}>{c.outlet.branch.name}</Link></td>
                <td className="td text-right font-medium text-rose-600">{formatCurrency(c.overdue)}</td>
                <td className="td text-right">{formatCurrency(c.balance)}</td>
                <td className="td text-right">{c.invoices}</td>
                <td className="td text-right">{c.oldest}</td>
                <td className="td"><StatusBadge status={c.outlet.creditStatus} /></td>
              </tr>
            ))}
            {v.overdueCustomers.length === 0 && <tr><td className="td text-slate-400" colSpan={7}>No overdue balances.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card overflow-x-auto">
          <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Largest balances owed</h3>
          <table className="w-full">
            <thead className="bg-slate-50"><tr><th className="th">Customer</th><th className="th">Branch</th><th className="th text-right">Owes</th><th className="th text-right">Limit</th><th className="th">Next due</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {v.topBalances.map((c) => <tr key={c.outlet.id}><td className="td">{c.outlet.name}</td><td className="td">{c.outlet.branch.name.replace(" Branch", "")}</td><td className="td text-right">{formatCurrency(c.balance)}</td><td className="td text-right">{formatCurrency(c.outlet.creditLimit)}</td><td className="td">{c.nextDue ? formatDate(c.nextDue) : "—"}</td></tr>)}
              {v.topBalances.length === 0 && <tr><td className="td text-slate-400" colSpan={5}>Nothing outstanding.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card overflow-x-auto">
          <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Over their credit limit</h3>
          <table className="w-full">
            <thead className="bg-slate-50"><tr><th className="th">Customer</th><th className="th">Branch</th><th className="th text-right">Owes</th><th className="th text-right">Limit</th><th className="th text-right">Excess</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {v.overLimit.map((c) => <tr key={c.outlet.id}><td className="td">{c.outlet.name}</td><td className="td">{c.outlet.branch.name.replace(" Branch", "")}</td><td className="td text-right">{formatCurrency(c.balance)}</td><td className="td text-right">{formatCurrency(c.outlet.creditLimit)}</td><td className="td text-right text-rose-600">{formatCurrency(c.balance - c.outlet.creditLimit)}</td></tr>)}
              {v.overLimit.length === 0 && <tr><td className="td text-slate-400" colSpan={5}>No customer is over their limit.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
