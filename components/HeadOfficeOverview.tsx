import Link from "next/link";
import { headOfficeCards, networkAttention, topOverdueCustomers } from "@/lib/headoffice";
import { currentScope } from "@/lib/report-runner";
import { formatCurrency, formatDateTime } from "@/lib/format";
import AutoRefresh from "@/components/dashboards/AutoRefresh";
import StatusBadge from "@/components/StatusBadge";

const TONE = { red: "border-rose-200 bg-rose-50 text-rose-700", amber: "border-amber-200 bg-amber-50 text-amber-700", blue: "border-blue-200 bg-blue-50 text-blue-700" };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
// A comparison with a near-empty earlier period says nothing, so it is not shown.
const growthOf = (now: number, before: number) => (before > now * 0.1 ? Math.round(((now - before) / before) * 100) : null);

// The central administrator's home: every branch compared on one screen, with what needs head-office action first.
export default async function HeadOfficeOverview({ days = 30 }: { days?: number }) {
  const scope = await currentScope();
  const [{ cards, labels }, attention, top] = await Promise.all([
    headOfficeCards(scope, days),
    networkAttention(scope, { admin: "/admin", supervisor: "/supervisor" }),
    topOverdueCustomers(scope, 8),
  ]);
  const sum = (f: (c: (typeof cards)[number]) => number) => cards.reduce((a, c) => a + f(c), 0);
  const out = sum((c) => c.outstanding);
  const overdue = sum((c) => c.overdue);
  const sales = sum((c) => c.sales);
  const prev = sum((c) => c.salesPrev);
  const target = sum((c) => c.target);
  const mtd = sum((c) => c.salesMtd);
  const returnsValue = sum((c) => c.market.value);

  return (
    <div className="space-y-6">
      <AutoRefresh minutes={5} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Head Office — Network at a Glance</h2>
          <p className="text-xs text-slate-500">All {cards.length} distribution branches. Figures cover the last {days} days unless stated. Last refreshed {formatDateTime(new Date())}.</p>
        </div>
        <Link href="/admin/network" className="btn-secondary text-xs">Receivables &amp; returns in detail</Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4"><p className="text-xs text-slate-500">Sales, last {days} days</p><p className="text-xl font-semibold text-slate-900">{formatCurrency(sales)}</p><p className={`text-[11px] ${growthOf(sales, prev) === null ? "text-slate-400" : sales >= prev ? "text-emerald-600" : "text-rose-600"}`}>{growthOf(sales, prev) !== null ? `${growthOf(sales, prev)! >= 0 ? "+" : ""}${growthOf(sales, prev)}% vs previous ${days} days` : "not enough earlier history to compare"}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">This month vs target</p><p className="text-xl font-semibold text-slate-900">{formatCurrency(mtd)}</p><p className="text-[11px] text-slate-400">{target ? `${pct(mtd, target)} of ${formatCurrency(target)}` : "no target set"}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Receivables from customers</p><p className="text-xl font-semibold text-slate-900">{formatCurrency(out)}</p><p className="text-[11px] text-rose-600">{formatCurrency(overdue)} overdue ({pct(overdue, out)})</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Collected, last {days} days</p><p className="text-xl font-semibold text-emerald-700">{formatCurrency(sum((c) => c.collections))}</p><p className="text-[11px] text-slate-400">{formatCurrency(sum((c) => c.pendingCheques))} cheques not yet cleared</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Returns from customers</p><p className="text-xl font-semibold text-slate-900">{formatCurrency(returnsValue)}</p><p className="text-[11px] text-amber-600">{sum((c) => c.market.awaitingCredit)} awaiting credit note · {pct(returnsValue, sales)} of sales</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Returns to central warehouse</p><p className="text-xl font-semibold text-slate-900">{sum((c) => c.central.units)} units</p><p className="text-[11px] text-slate-400">{sum((c) => c.central.inTransit)} in transit · {sum((c) => c.central.awaitingApproval)} awaiting approval</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Warehouse stock value</p><p className="text-xl font-semibold text-slate-900">{formatCurrency(sum((c) => c.stockValue))}</p><p className="text-[11px] text-amber-600">{sum((c) => c.nearExpiryLots)} lots near expiry · {sum((c) => c.expiredUnits)} units expired</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Promotion claims in progress</p><p className="text-xl font-semibold text-slate-900">{formatCurrency(sum((c) => c.claimsValue))}</p><p className="text-[11px] text-slate-400">{sum((c) => c.claimsPending)} claims open</p></div>
      </div>

      <div className="card p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Needs head-office attention</h3>
        {attention.length === 0 ? <p className="text-xs text-slate-400">Nothing is waiting — all branches are clear.</p> : (
          <ul className="grid gap-2 md:grid-cols-2">
            {attention.map((a) => (
              <li key={a.title}>
                <Link href={a.href} className={`flex items-start gap-3 rounded-lg border p-3 hover:shadow-sm ${TONE[a.tone]}`}>
                  <span className="min-w-8 text-center text-lg font-semibold leading-none">{a.count}</span>
                  <span className="text-xs"><span className="block font-medium">{a.title}</span><span className="opacity-80">{a.detail}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card overflow-x-auto">
        <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Branch comparison <span className="font-normal text-slate-400">— open a branch for its full profile</span></h3>
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Branch</th><th className="th text-right">Sales</th><th className="th text-right">vs previous</th><th className="th text-right">Month vs target</th>
              <th className="th text-right">Receivable</th><th className="th text-right">Overdue %</th><th className="th text-right">Collected</th>
              <th className="th text-right">Returns value</th><th className="th text-right">Returns % of sales</th><th className="th text-right">Stock value</th>
              <th className="th text-right">Claims open</th><th className="th text-right">Approvals</th><th className="th text-right">Exceptions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cards.map((c) => {
              const exc = c.einvoiceRejected + c.poExceptions + c.van.varianceOpen + c.central.discrepancies;
              const growth = growthOf(c.sales, c.salesPrev);
              return (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="td font-medium"><Link className="text-blue-700 hover:underline" href={`/admin/network/${c.id}`}>{c.name}</Link><p className="text-[10px] font-normal text-slate-400">{c.customers} customers</p></td>
                  <td className="td text-right">{formatCurrency(c.sales)}</td>
                  <td className={`td text-right ${growth === null ? "" : growth >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{growth === null ? "—" : `${growth >= 0 ? "+" : ""}${growth}%`}</td>
                  <td className="td text-right">{c.target ? <span className={c.salesMtd >= c.target ? "text-emerald-600" : ""}>{pct(c.salesMtd, c.target)}</span> : "—"}</td>
                  <td className="td text-right">{formatCurrency(c.outstanding)}</td>
                  <td className={`td text-right ${c.outstanding && c.overdue / c.outstanding > 0.3 ? "font-medium text-rose-600" : ""}`}>{pct(c.overdue, c.outstanding)}</td>
                  <td className="td text-right">{formatCurrency(c.collections)}</td>
                  <td className="td text-right">{formatCurrency(c.market.value)}</td>
                  <td className={`td text-right ${c.sales && c.market.value / c.sales > 0.05 ? "text-rose-600" : ""}`}>{pct(c.market.value, c.sales)}</td>
                  <td className="td text-right">{formatCurrency(c.stockValue)}</td>
                  <td className="td text-right">{c.claimsPending || "—"}</td>
                  <td className={`td text-right ${c.approvalsPending ? "text-amber-600" : ""}`}>{c.approvalsPending || "—"}</td>
                  <td className={`td text-right ${exc ? "text-rose-600" : ""}`}>{exc || "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
            <tr>
              <td className="td">Network</td><td className="td text-right">{formatCurrency(sales)}</td><td className="td text-right">{growthOf(sales, prev) !== null ? `${growthOf(sales, prev)! >= 0 ? "+" : ""}${growthOf(sales, prev)}%` : "—"}</td><td className="td text-right">{target ? pct(mtd, target) : "—"}</td>
              <td className="td text-right">{formatCurrency(out)}</td><td className="td text-right">{pct(overdue, out)}</td><td className="td text-right">{formatCurrency(sum((c) => c.collections))}</td>
              <td className="td text-right">{formatCurrency(returnsValue)}</td><td className="td text-right">{pct(returnsValue, sales)}</td><td className="td text-right">{formatCurrency(sum((c) => c.stockValue))}</td>
              <td className="td text-right">{sum((c) => c.claimsPending)}</td><td className="td text-right">{sum((c) => c.approvalsPending)}</td><td className="td text-right">{sum((c) => c.einvoiceRejected + c.poExceptions + c.van.varianceOpen + c.central.discrepancies)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="px-4 py-2 text-[11px] text-slate-400">Exceptions = rejected e-invoices + purchase orders in the exception queue + open van variances + central-warehouse discrepancies. Receivable ageing ({labels.join(" · ")}) is on the receivables page.</p>
      </div>

      <div className="card overflow-x-auto">
        <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Largest overdue customers across the network</h3>
        <table className="w-full">
          <thead className="bg-slate-50"><tr><th className="th">Customer</th><th className="th">Branch</th><th className="th text-right">Overdue</th><th className="th text-right">Invoices</th><th className="th text-right">Oldest (days late)</th><th className="th">Credit</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {top.map((t) => (
              <tr key={t.outlet.id} className="hover:bg-slate-50">
                <td className="td font-medium text-slate-900">{t.outlet.name} <span className="text-[10px] font-normal text-slate-400">{t.outlet.code}</span></td>
                <td className="td"><Link className="text-blue-700 hover:underline" href={`/admin/network/${t.outlet.branch.id}`}>{t.outlet.branch.name}</Link></td>
                <td className="td text-right font-medium text-rose-600">{formatCurrency(t.overdue)}</td>
                <td className="td text-right">{t.invoices}</td>
                <td className="td text-right">{t.oldest}</td>
                <td className="td"><StatusBadge status={t.outlet.creditStatus} /></td>
              </tr>
            ))}
            {top.length === 0 && <tr><td className="td text-slate-400" colSpan={6}>No overdue balances.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
