import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/format";

export default async function OutletDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ orderStatus?: string; return?: string }>;
}) {
  const { id } = await params;
  const { orderStatus, return: returnStatus } = await searchParams;

  const outlet = await prisma.outlet.findUnique({ where: { id }, include: { channel: true } });
  if (!outlet) notFound();

  const invoices = await prisma.invoice.findMany({
    where: { outletId: id },
    include: { arLedgerEntries: true },
    orderBy: { invoiceDate: "desc" },
    take: 10,
  });

  const outstanding = invoices
    .filter((i) => i.status !== "paid")
    .reduce((sum, inv) => {
      const paid = inv.arLedgerEntries.filter((e) => e.type === "payment").reduce((s, e) => s + e.amount, 0);
      return sum + (inv.amount - paid);
    }, 0);

  const orders = await prisma.salesOrder.findMany({
    where: { outletId: id },
    orderBy: { orderDate: "desc" },
    take: 10,
  });

  return (
    <div className="space-y-4">
      {orderStatus === "success" && (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">Order submitted and invoiced successfully.</div>
      )}
      {orderStatus === "hold" && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">Order placed on credit hold, pending supervisor approval.</div>
      )}
      {returnStatus === "submitted" && (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">Market return submitted for supervisor review.</div>
      )}

      <div className="card p-4">
        <h2 className="text-base font-semibold text-slate-900">{outlet.name}</h2>
        <p className="text-xs text-slate-500">{outlet.channel.name} · {outlet.subChannel}</p>
        <p className="mt-1 text-xs text-slate-500">{outlet.address}</p>
        {outlet.contactPerson && <p className="text-xs text-slate-500">Contact: {outlet.contactPerson}</p>}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs text-slate-500">Credit Limit</p>
            <p className="text-sm font-semibold text-slate-900">{formatCurrency(outlet.creditLimit)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs text-slate-500">Outstanding AR</p>
            <p className={`text-sm font-semibold ${outstanding > outlet.creditLimit * 0.8 ? "text-rose-600" : "text-slate-900"}`}>
              {formatCurrency(outstanding)}
            </p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Link href={`/sfa/order/new?outlet=${outlet.id}`} className="btn-primary">New Order</Link>
          <Link href={`/sfa/collections/new?outlet=${outlet.id}`} className="btn-secondary">Collect Payment</Link>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Link href={`/sfa/visit/new?outlet=${outlet.id}`} className="btn-secondary">Check In</Link>
          <Link href={`/sfa/field-notes/new?outlet=${outlet.id}`} className="btn-secondary">Field Note</Link>
        </div>
        <div className="mt-2">
          <Link href={`/sfa/market-returns/new?outlet=${outlet.id}`} className="btn-secondary block text-center">Market Return</Link>
        </div>
      </div>

      <div className="card p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Order History</h3>
        <ul className="divide-y divide-slate-100">
          {orders.map((o) => (
            <li key={o.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <p className="font-medium text-slate-900">{o.orderNumber}</p>
                <p className="text-xs text-slate-500">{formatDate(o.orderDate)}</p>
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
