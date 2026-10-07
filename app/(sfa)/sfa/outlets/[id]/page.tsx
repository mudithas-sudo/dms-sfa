import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import Banner from "@/components/Banner";
import StatusBadge from "@/components/StatusBadge";
import { ageingBounds, bucketIndex, bucketLabels, invoiceBalance, outletBalance } from "@/lib/finance";
import { getAllSettings } from "@/lib/settings";
import { formatCurrency, formatDate, daysBetween } from "@/lib/format";

export default async function OutletDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { id } = await params;
  const { error, notice } = await searchParams;

  const outlet = await prisma.outlet.findUnique({ where: { id }, include: { channel: true, route: true } });
  if (!outlet) notFound();
  const settings = await getAllSettings();
  const bounds = ageingBounds(settings["ageing.buckets"]);
  const labels = bucketLabels(bounds);

  const [invoices, orders, topLines, ledger, notes, returns, changes, balance] = await Promise.all([
    prisma.invoice.findMany({ where: { outletId: id, status: { in: ["unpaid", "partially_paid", "overdue"] } }, include: { arLedgerEntries: true }, orderBy: { dueDate: "asc" } }),
    prisma.salesOrder.findMany({ where: { outletId: id }, orderBy: { orderDate: "desc" }, take: 6, include: { lines: { include: { product: true } } } }),
    prisma.salesOrderLine.groupBy({ by: ["productId"], where: { salesOrder: { outletId: id, status: { notIn: ["voided", "cancelled", "draft"] } } }, _sum: { qty: true }, orderBy: { _sum: { qty: "desc" } }, take: 4 }),
    prisma.aRLedgerEntry.findMany({ where: { outletId: id, OR: [{ unappliedAmount: { gt: 0 } }, { paymentStatus: "pending" }] }, orderBy: { entryDate: "desc" } }),
    prisma.fieldNote.count({ where: { outletId: id } }),
    prisma.marketReturn.findMany({ where: { outletId: id }, orderBy: { createdAt: "desc" }, take: 3, include: { creditNote: true, product: true } }),
    prisma.customerChangeRequest.findMany({ where: { outletId: id, status: "pending" } }),
    outletBalance(id),
  ]);
  const topNames = await prisma.product.findMany({ where: { id: { in: topLines.map((t) => t.productId) } }, select: { id: true, name: true } });

  const buckets = labels.map(() => 0);
  let oldest = 0;
  for (const inv of invoices) {
    const bal = invoiceBalance(inv);
    if (bal <= 0) continue;
    const late = daysBetween(new Date(), inv.dueDate);
    oldest = Math.max(oldest, late);
    buckets[bucketIndex(late, bounds)] += bal;
  }
  const overdue = buckets.slice(1).reduce((a, b) => a + b, 0);
  const lastOrder = orders.find((o) => !["draft", "voided", "cancelled"].includes(o.status));
  const unapplied = ledger.filter((e) => e.unappliedAmount > 0 && e.paymentStatus !== "pending");
  const pendingCheques = ledger.filter((e) => e.paymentStatus === "pending");
  const outstanding = Math.max(0, balance);

  return (
    <div className="space-y-4">
      <Banner error={error} notice={notice} />

      <div className="card p-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{outlet.name}</h2>
            <p className="text-xs text-slate-500">{outlet.code} · {outlet.channel.name} · {outlet.subChannel}</p>
          </div>
          <StatusBadge status={outlet.creditStatus} />
        </div>
        <p className="mt-1 text-xs text-slate-500">{outlet.address}</p>
        {outlet.contactPerson && <p className="text-xs text-slate-500">Contact: {outlet.contactPerson}{outlet.phone ? ` · ${outlet.phone}` : ""}</p>}
        <p className="text-xs text-slate-500">Route {outlet.route?.name ?? "—"}{outlet.visitDay ? ` · visited on ${outlet.visitDay}s` : ""} · terms {outlet.paymentTerms.replace("_", " ")}</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-slate-50 p-2"><p className="text-[10px] text-slate-500">Credit limit</p><p className="text-xs font-semibold text-slate-900">{formatCurrency(outlet.creditLimit)}</p></div>
          <div className="rounded-lg bg-slate-50 p-2"><p className="text-[10px] text-slate-500">Outstanding</p><p className={`text-xs font-semibold ${outstanding > outlet.creditLimit * 0.8 ? "text-rose-600" : "text-slate-900"}`}>{formatCurrency(outstanding)}</p></div>
          <div className="rounded-lg bg-slate-50 p-2"><p className="text-[10px] text-slate-500">Available</p><p className="text-xs font-semibold text-slate-900">{formatCurrency(outlet.creditLimit - outstanding)}</p></div>
        </div>
        {overdue > 0 && <p className="mt-2 rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700">Overdue {formatCurrency(overdue)} — oldest {oldest} days. Collect before selling more.</p>}
        {outlet.creditStatus !== "active" && <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">Credit status: {outlet.creditStatus.replace("_", " ")}{outlet.blockedReason ? ` — ${outlet.blockedReason}` : ""}.</p>}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Link href={`/sfa/order/new?outlet=${outlet.id}`} className="btn-primary text-center">New order</Link>
          <Link href={`/sfa/collections/new?outlet=${outlet.id}`} className="btn-secondary text-center">Collect payment</Link>
          <Link href={`/sfa/visit/new?outlet=${outlet.id}`} className="btn-secondary text-center">Check in</Link>
          <Link href={`/sfa/field-notes/new?outlet=${outlet.id}`} className="btn-secondary text-center">Field form{notes ? ` (${notes})` : ""}</Link>
          <Link href={`/sfa/market-returns/new?outlet=${outlet.id}`} className="btn-secondary text-center">Market return</Link>
          <Link href={`/sfa/outlets/${outlet.id}/change-request`} className="btn-secondary text-center">Request a change{changes.length ? ` (${changes.length})` : ""}</Link>
        </div>
      </div>

      <div className="card p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Receivables ageing</h3>
        <div className="grid grid-cols-3 gap-1.5 text-center">
          {labels.map((l, i) => (
            <div key={l} className="rounded-md bg-slate-50 p-1.5"><p className="text-[9px] text-slate-500">{l}</p><p className={`text-[11px] font-semibold ${i > 0 && buckets[i] ? "text-rose-600" : "text-slate-900"}`}>{formatCurrency(buckets[i])}</p></div>
          ))}
        </div>
        {unapplied.length > 0 && <p className="mt-2 text-xs text-emerald-700">Unapplied credit: {formatCurrency(unapplied.reduce((s, e) => s + e.unappliedAmount, 0))} (a supervisor applies it to an invoice).</p>}
        {pendingCheques.length > 0 && <p className="mt-1 text-xs text-amber-700">Cheques pending clearance: {pendingCheques.map((c) => `${c.chequeNumber} ${formatCurrency(c.amount)}`).join(", ")} — not yet deducted from the balance.</p>}
        <ul className="mt-2 divide-y divide-slate-100">
          {invoices.map((i) => {
            const b = invoiceBalance(i);
            return b > 0 ? (
              <li key={i.id} className="flex items-center justify-between py-1.5 text-xs">
                <Link href={`/sfa/invoice/${i.id}`} className="text-blue-600 hover:underline">{i.invoiceNumber}</Link>
                <span className={i.dueDate < new Date() ? "text-rose-600" : "text-slate-500"}>due {formatDate(i.dueDate)}</span>
                <span className="font-medium">{formatCurrency(b)}</span>
              </li>
            ) : null;
          })}
        </ul>
      </div>

      <div className="card p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Buying pattern</h3>
        {lastOrder ? (
          <p className="text-xs text-slate-600">Last order <strong>{lastOrder.orderNumber}</strong> on {formatDate(lastOrder.orderDate)} — {formatCurrency(lastOrder.total)} ({lastOrder.lines.length} lines). <Link href={`/sfa/order/new?outlet=${outlet.id}`} className="text-blue-600 underline">Reorder</Link></p>
        ) : (
          <p className="text-xs text-slate-400">No orders yet.</p>
        )}
        {topLines.length > 0 && <p className="mt-1 text-xs text-slate-600">Top products: {topLines.map((t) => `${topNames.find((n) => n.id === t.productId)?.name ?? "?"} (${t._sum.qty})`).join(", ")}</p>}
      </div>

      {returns.length > 0 && (
        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Market returns &amp; credit notes</h3>
          <ul className="divide-y divide-slate-100 text-xs">
            {returns.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-1.5">
                <span>{r.qty} × {r.product.name} · {r.reason.replace(/_/g, " ")}</span>
                <span className="text-right">
                  <StatusBadge status={r.status} />
                  {r.creditNote && <span className="block text-[10px] text-slate-500">{r.creditNote.noteNumber} · {r.creditNote.status.replace(/_/g, " ")}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Recent orders</h3>
        <ul className="divide-y divide-slate-100">
          {orders.map((o) => (
            <li key={o.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <p className="font-medium text-slate-900">{o.orderNumber}</p>
                <p className="text-xs text-slate-500">{formatDate(o.orderDate)} · {o.orderType.replace("_", " ")}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs">{formatCurrency(o.total)}</span>
                <StatusBadge status={o.status} />
              </div>
            </li>
          ))}
          {orders.length === 0 && <p className="py-2 text-xs text-slate-400">No orders yet.</p>}
        </ul>
      </div>
    </div>
  );
}
