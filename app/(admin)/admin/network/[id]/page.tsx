import Link from "next/link";
import { notFound } from "next/navigation";
import { branchDetail } from "@/lib/headoffice";
import { typeLabel } from "@/lib/approval-types";
import { daysAgo, formatCurrency, formatDate } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export default async function BranchProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ days?: string }> }) {
  const { id } = await params;
  const { days: d } = await searchParams;
  const days = Math.max(1, Math.min(365, Number(d) || 30));
  const x = await branchDetail(id, days);
  if (!x.branch || !x.card) notFound();
  const c = x.card;
  const rep = (r: string, extra = "") => `/admin/reports/${r}?run=1&branch=${id}${extra}`;
  const since = daysAgo(days).toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <Link href="/admin" className="text-sm text-blue-600 hover:underline">← Head office overview</Link>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{x.branch.name}</h2>
          <p className="text-xs text-slate-500">{c.customers} customers · {x.reps} sales reps · figures for the last {days} days</p>
        </div>
        <form method="get" className="flex items-end gap-2">
          <select className="input" name="days" defaultValue={String(days)}>{[7, 30, 90].map((n) => <option key={n} value={n}>Last {n} days</option>)}</select>
          <button className="btn-secondary" type="submit">Show</button>
        </form>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4"><p className="text-xs text-slate-500">Sales</p><p className="text-xl font-semibold">{formatCurrency(c.sales)}</p><p className="text-[11px] text-slate-400">{c.target ? `Month: ${pct(c.salesMtd, c.target)} of ${formatCurrency(c.target)} target` : "No target set"}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Receivable</p><p className="text-xl font-semibold">{formatCurrency(c.outstanding)}</p><p className="text-[11px] text-rose-600">{formatCurrency(c.overdue)} overdue · {c.overdueInvoices} invoices</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Returns from customers</p><p className="text-xl font-semibold">{formatCurrency(c.market.value)}</p><p className="text-[11px] text-slate-400">{c.market.count} returns · {pct(c.market.value, c.sales)} of sales</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Warehouse stock</p><p className="text-xl font-semibold">{formatCurrency(c.stockValue)}</p><p className="text-[11px] text-amber-600">{c.nearExpiryLots} lots near expiry · {c.expiredUnits} expired units</p></div>
      </div>

      <div className="card overflow-x-auto">
        <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Receivable ageing</h3>
        <table className="w-full"><thead className="bg-slate-50"><tr>{x.labels.map((l) => <th key={l} className="th text-right">{l}</th>)}<th className="th text-right">Collected</th><th className="th text-right">Pending cheques</th><th className="th text-right">Over limit</th><th className="th text-right">On hold / blocked</th></tr></thead>
          <tbody><tr>{c.buckets.map((b, i) => <td key={i} className={`td text-right ${i > 0 && b ? "text-rose-600" : ""}`}>{formatCurrency(b)}</td>)}<td className="td text-right">{formatCurrency(c.collections)}</td><td className="td text-right">{formatCurrency(c.pendingCheques)}</td><td className="td text-right">{c.overLimit}</td><td className="td text-right">{c.onHold}</td></tr></tbody></table>
        <p className="px-4 py-2 text-[11px] text-slate-400"><Link className="text-blue-600 underline" href={rep("receivables-ageing")}>Full ageing by customer</Link> · <Link className="text-blue-600 underline" href={rep("receivables-ageing", "&groupBy=route")}>by route</Link> · Collected by mode: {x.collections.length ? x.collections.map(([m, v]) => `${m.replace("_", " ")} ${formatCurrency(v)}`).join(", ") : "none"}</p>
      </div>

      <div className="card overflow-x-auto">
        <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Largest overdue customers</h3>
        <table className="w-full"><thead className="bg-slate-50"><tr><th className="th">Customer</th><th className="th text-right">Overdue</th><th className="th text-right">Invoices</th><th className="th text-right">Oldest (days late)</th><th className="th">Credit</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {x.top.map((t) => <tr key={t.outlet.id}><td className="td font-medium">{t.outlet.name} <span className="text-[10px] text-slate-400">{t.outlet.code}</span></td><td className="td text-right text-rose-600">{formatCurrency(t.overdue)}</td><td className="td text-right">{t.invoices}</td><td className="td text-right">{t.oldest}</td><td className="td"><StatusBadge status={t.outlet.creditStatus} /></td></tr>)}
            {x.top.length === 0 && <tr><td className="td text-slate-400" colSpan={5}>No overdue balances.</td></tr>}
          </tbody></table>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card overflow-x-auto">
          <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Returns from customers <span className="font-normal text-slate-400">({c.market.count})</span></h3>
          <table className="w-full"><thead className="bg-slate-50"><tr><th className="th">Date</th><th className="th">Customer</th><th className="th">Product</th><th className="th text-right">Qty</th><th className="th">Reason</th><th className="th">Credit note</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {x.market.map((m) => <tr key={m.id}><td className="td">{formatDate(m.createdAt)}</td><td className="td">{m.outlet.name}</td><td className="td">{m.product.name}</td><td className="td text-right">{m.qty}</td><td className="td">{m.reason}{m.outsidePolicy ? <span className="ml-1 text-[10px] text-rose-600">outside policy</span> : null}</td><td className="td">{m.creditNote ? <>{m.creditNote.noteNumber} <StatusBadge status={m.creditNote.status} /></> : <StatusBadge status={m.status} />}</td></tr>)}
              {x.market.length === 0 && <tr><td className="td text-slate-400" colSpan={6}>No returns in this period.</td></tr>}
            </tbody></table>
          <p className="px-4 py-2 text-[11px] text-slate-400"><Link className="text-blue-600 underline" href={rep("returns-register", `&dateFrom=${since}`)}>Open the returns register for this branch</Link></p>
        </div>

        <div className="card overflow-x-auto">
          <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Returns to Company F and B (central warehouse) <span className="font-normal text-slate-400">({c.central.count})</span></h3>
          <table className="w-full"><thead className="bg-slate-50"><tr><th className="th">Return</th><th className="th">Product</th><th className="th text-right">Qty</th><th className="th">Reason</th><th className="th">Status</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {x.central.map((s) => <tr key={s.id}><td className="td">{s.returnNumber ?? "draft"}</td><td className="td">{s.product.name}</td><td className="td text-right">{s.qty}{s.qtyReceived != null && s.qtyReceived !== s.qty ? <span className="ml-1 text-[10px] text-rose-600">recv {s.qtyReceived}</span> : null}</td><td className="td">{s.reason}</td><td className="td"><StatusBadge status={s.status} /></td></tr>)}
              {x.central.length === 0 && <tr><td className="td text-slate-400" colSpan={5}>None in this period.</td></tr>}
            </tbody></table>
          <p className="px-4 py-2 text-[11px] text-slate-400">Van returns (unsold stock back to the branch warehouse): {x.van.length} in the period, {c.van.varianceOpen} with open variance.</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card overflow-x-auto">
          <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Waiting for approval <span className="font-normal text-slate-400">({c.approvalsPending})</span></h3>
          <table className="w-full"><thead className="bg-slate-50"><tr><th className="th">Request</th><th className="th text-right">Amount</th><th className="th">Raised</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {x.approvals.map((a) => <tr key={a.id}><td className="td">{typeLabel(a.type)}<p className="text-[10px] text-slate-400">{a.reason.slice(0, 80)}</p></td><td className="td text-right">{formatCurrency(a.amount)}</td><td className="td">{formatDate(a.createdAt)}</td></tr>)}
              {x.approvals.length === 0 && <tr><td className="td text-slate-400" colSpan={3}>Nothing waiting.</td></tr>}
            </tbody></table>
        </div>
        <div className="card overflow-x-auto">
          <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Promotion claims in progress <span className="font-normal text-slate-400">({c.claimsPending})</span></h3>
          <table className="w-full"><thead className="bg-slate-50"><tr><th className="th">Claim</th><th className="th">Promotion</th><th className="th text-right">Amount</th><th className="th">Status</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {x.claims.map((k) => <tr key={k.id}><td className="td">{k.claimNumber}</td><td className="td">{k.promotion.name}</td><td className="td text-right">{formatCurrency(k.amount)}</td><td className="td"><StatusBadge status={k.status} /></td></tr>)}
              {x.claims.length === 0 && <tr><td className="td text-slate-400" colSpan={4}>No open claims.</td></tr>}
            </tbody></table>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Warehouse lots near expiry or expired</h3>
        <table className="w-full"><thead className="bg-slate-50"><tr><th className="th">Product</th><th className="th">Lot</th><th className="th">Expiry</th><th className="th text-right">Good</th><th className="th text-right">Expired</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {x.lots.map((l) => <tr key={l.id}><td className="td">{l.product.name}</td><td className="td">{l.lotNumber}</td><td className="td">{l.expiryDate ? formatDate(l.expiryDate) : "—"}</td><td className="td text-right">{l.qtyGood}</td><td className={`td text-right ${l.qtyExpired ? "text-rose-600" : ""}`}>{l.qtyExpired || "—"}</td></tr>)}
            {x.lots.length === 0 && <tr><td className="td text-slate-400" colSpan={5}>No lots at risk.</td></tr>}
          </tbody></table>
      </div>

      <p className="text-xs text-slate-500">E-invoicing at this branch: {c.einvoicePending} not yet sent, {c.einvoiceRejected} rejected · purchase orders in exception queue: {c.poExceptions}.</p>
    </div>
  );
}
