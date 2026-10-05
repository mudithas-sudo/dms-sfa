import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { fulfillOrder } from "@/app/actions/supervisor-actions";

export default async function BackendOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await prisma.salesOrder.findUnique({
    where: { id },
    include: {
      outlet: true,
      salesperson: true,
      lines: { include: { product: true } },
      approvals: true,
      invoices: { include: { lines: true, deliveryReceipts: { include: { lines: true } } } },
    },
  });
  if (!order) notFound();

  const pendingApproval = order.approvals.find((a) => a.status === "pending");
  const invoice = order.invoices[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Link href="/supervisor/orders" className="hover:underline">Orders</Link>
        <span>/</span>
        <span className="text-slate-900">{order.orderNumber}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{order.orderNumber} — {order.outlet.name}</h2>
          <p className="text-xs text-slate-500">Entered by {order.salesperson.name} · {formatDateTime(order.orderDate)}</p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      {pendingApproval && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
          Held for exception approval — <span className="capitalize">{pendingApproval.type.replace(/_/g, " ")}</span>:{" "}
          {pendingApproval.reason}. Resolve this from{" "}
          <Link href="/supervisor/approvals" className="underline">Approvals</Link> before it can be fulfilled.
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">
          {order.status === "confirmed" ? "Picklist (FEFO-reserved lots)" : "Order Lines"}
        </h3>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Product</th>
                <th className="th">Qty Ordered</th>
                <th className="th">Reserved Lot</th>
                <th className="th">Line Total</th>
                {order.status !== "confirmed" && <th className="th">Qty Delivered</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {order.lines.map((l) => (
                <tr key={l.id}>
                  <td className="td font-medium text-slate-900">{l.product.name}</td>
                  <td className="td">{l.qty}</td>
                  <td className="td text-xs text-slate-500">{l.reservedLotNumber ?? "—"}</td>
                  <td className="td">{formatCurrency(l.lineTotal)}</td>
                  {order.status !== "confirmed" && (
                    <td className={`td font-medium ${l.qtyDelivered !== null && l.qtyDelivered < l.qty ? "text-amber-600" : "text-slate-900"}`}>
                      {l.qtyDelivered ?? "—"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {order.status === "confirmed" && !pendingApproval && (
        <div className="card max-w-lg p-6">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Record Delivery</h3>
          <p className="mb-3 text-xs text-slate-500">
            Enter what was actually delivered — it can be less than ordered. Any shortfall stays visible
            on the order rather than being billed as if it were delivered in full.
          </p>
          <form action={fulfillOrder} className="space-y-3">
            <input type="hidden" name="orderId" value={order.id} />
            {order.lines.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-2">
                <span className="flex-1 text-sm text-slate-700">{l.product.name}</span>
                <input className="input w-24" type="number" name={`delivered_${l.id}`} min={0} max={l.qty} defaultValue={l.qty} />
              </div>
            ))}
            <div>
              <label className="label" htmlFor="receivedBy">Received By</label>
              <input className="input" id="receivedBy" name="receivedBy" placeholder="Outlet contact name" />
            </div>
            <button type="submit" className="btn-primary w-full">Confirm Delivery</button>
          </form>
        </div>
      )}

      {invoice && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Invoice</h3>
          <div className="card p-4 text-sm">
            <p className="font-medium text-slate-900">
              <Link href={`/supervisor/invoices/${invoice.id}`} className="text-blue-600 hover:underline">
                {invoice.invoiceNumber}
              </Link>
              {" "}— {formatCurrency(invoice.amount)}
            </p>
            <p className="text-xs text-slate-500"><StatusBadge status={invoice.status} /></p>
            {invoice.deliveryReceipts[0] && (
              <p className="mt-2 text-xs text-slate-500">
                Delivery: <StatusBadge status={invoice.deliveryReceipts[0].status} />
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
