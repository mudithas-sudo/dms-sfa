import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import StatusBadge from "@/components/StatusBadge";
import Banner from "@/components/Banner";
import { formatCurrency, formatDate } from "@/lib/format";
import { requestOrderVoid } from "@/app/actions/supervisor-actions";
import { releaseStaleReservations } from "@/app/actions/sales-actions";

const FILTERS = [
  { id: "", label: "All" },
  { id: "on_hold", label: "On hold / exceptions" },
  { id: "draft", label: "Drafts" },
  { id: "confirmed", label: "Confirmed" },
  { id: "picked", label: "Picked" },
  { id: "invoiced", label: "Invoiced" },
  { id: "delivered", label: "Delivered" },
  { id: "voided", label: "Cancelled / voided" },
];

export default async function SupervisorOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; source?: string; error?: string; notice?: string }> }) {
  const { branchId } = await getSession();
  const { status, source, error, notice } = await searchParams;

  const orders = await prisma.salesOrder.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(status ? { status: status === "delivered" ? { in: ["delivered", "partially_delivered"] } : status } : {}),
      ...(source ? { source } : {}),
    },
    orderBy: { orderDate: "desc" },
    take: 60,
    include: {
      outlet: true,
      salesperson: true,
      invoices: { include: { deliveryReceipts: { include: { lines: true } } } },
      approvals: { where: { type: "order_void" } },
    },
  });
  const held = await prisma.salesOrder.count({ where: { ...(branchId ? { branchId } : {}), status: "on_hold" } });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Orders</h2>
          <p className="text-sm text-slate-500">
            Field orders arrive from the SFA app and backend orders are keyed in at the branch; both pass one validation engine, reserve stock (FEFO) and move through picklist, invoice and
            delivery. Orders that fail a check wait on hold with the reason — nothing is silently lost. Once invoiced an order is locked; a void needs approval and the original stays visible.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <form action={releaseStaleReservations}><button className="btn-secondary" type="submit">Release stale reservations</button></form>
          <Link href="/supervisor/orders/new" className="btn-primary">New Backend Order</Link>
        </div>
      </div>
      <Banner error={error} notice={notice} />

      {held > 0 && !status && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {held} order(s) are on hold — <Link className="underline" href="/supervisor/orders?status=on_hold">view the exception list</Link>.
        </p>
      )}

      <div className="flex flex-wrap gap-2 text-xs">
        {FILTERS.map((f) => (
          <Link key={f.id} href={`/supervisor/orders${f.id ? `?status=${f.id}` : ""}`} className={`btn-secondary px-3 py-1 ${(status ?? "") === f.id ? "ring-1 ring-blue-500" : ""}`}>{f.label}</Link>
        ))}
        <span className="mx-1 text-slate-300">|</span>
        <Link href={`/supervisor/orders?source=backend${status ? `&status=${status}` : ""}`} className={`btn-secondary px-3 py-1 ${source === "backend" ? "ring-1 ring-blue-500" : ""}`}>Backend entry</Link>
        <Link href={`/supervisor/orders?source=sfa${status ? `&status=${status}` : ""}`} className={`btn-secondary px-3 py-1 ${source === "sfa" ? "ring-1 ring-blue-500" : ""}`}>SFA</Link>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Order #</th>
              <th className="th">Outlet</th>
              <th className="th">Source · by</th>
              <th className="th">Date</th>
              <th className="th">Total</th>
              <th className="th">Delivery</th>
              <th className="th">Status</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orders.map((o) => {
              const dr = o.invoices[0]?.deliveryReceipts[0];
              const hasVoidPending = o.approvals.some((a) => a.status === "pending");
              const canVoid = ["invoiced", "delivered", "partially_delivered"].includes(o.status) && !hasVoidPending;
              return (
                <tr key={o.id}>
                  <td className="td font-medium text-slate-900">
                    <Link href={`/supervisor/orders/${o.id}`} className="text-blue-600 hover:underline">{o.orderNumber}</Link>
                  </td>
                  <td className="td">{o.outlet.name}</td>
                  <td className="td text-xs">{o.source === "backend" ? "Backend" : "SFA"} · {o.salesperson.name}</td>
                  <td className="td">{formatDate(o.orderDate)}</td>
                  <td className="td">{formatCurrency(o.total)}</td>
                  <td className="td">{dr ? <StatusBadge status={dr.status} /> : o.invoices[0] ? <StatusBadge status={o.invoices[0].deliveryStatus} /> : <span className="text-slate-400">—</span>}</td>
                  <td className="td"><StatusBadge status={o.status} /></td>
                  <td className="td text-right">
                    {canVoid && (
                      <form action={requestOrderVoid} className="flex justify-end gap-2">
                        <input type="hidden" name="salesOrderId" value={o.id} />
                        <input className="input w-40 py-1 text-xs" name="reason" placeholder="Void reason" required />
                        <button type="submit" className="text-xs text-rose-600 hover:underline">Request Void</button>
                      </form>
                    )}
                    {hasVoidPending && <span className="text-xs text-amber-600">Void pending approval</span>}
                    {o.status === "voided" && o.voidReason && <span className="text-xs text-slate-400" title={o.voidReason}>Voided</span>}
                  </td>
                </tr>
              );
            })}
            {orders.length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={8}>No orders match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
