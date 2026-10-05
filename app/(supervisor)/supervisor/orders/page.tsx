import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import StatusBadge from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/format";
import { requestOrderVoid } from "@/app/actions/supervisor-actions";

export default async function SupervisorOrdersPage() {
  const { branchId } = await getSession();

  const orders = await prisma.salesOrder.findMany({
    where: { ...(branchId ? { branchId } : {}) },
    orderBy: { orderDate: "desc" },
    take: 40,
    include: {
      outlet: true,
      salesperson: true,
      invoices: { include: { deliveryReceipts: { include: { lines: true } } } },
      approvals: { where: { type: "order_void" } },
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Orders</h2>
          <p className="text-sm text-slate-500">
            Field orders arrive here automatically from the SFA app; backend orders for phone or walk-in
            business go through the identical validation. Once an order is invoiced it can no longer be
            edited directly — voiding requires an approval, and the original record stays visible marked
            &quot;Voided&quot; rather than being deleted.
          </p>
        </div>
        <Link href="/supervisor/orders/new" className="btn-primary shrink-0">New Backend Order</Link>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Order #</th>
              <th className="th">Outlet</th>
              <th className="th">Rep</th>
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
              const canVoid = (o.status === "invoiced" || o.status === "delivered") && !hasVoidPending;
              return (
                <tr key={o.id}>
                  <td className="td font-medium text-slate-900">
                    <Link href={`/supervisor/orders/${o.id}`} className="text-blue-600 hover:underline">{o.orderNumber}</Link>
                  </td>
                  <td className="td">{o.outlet.name}</td>
                  <td className="td">{o.salesperson.name}</td>
                  <td className="td">{formatDate(o.orderDate)}</td>
                  <td className="td">{formatCurrency(o.total)}</td>
                  <td className="td">
                    {dr ? <StatusBadge status={dr.status} /> : <span className="text-slate-400">—</span>}
                  </td>
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
                    {o.status === "voided" && o.voidReason && (
                      <span className="text-xs text-slate-400" title={o.voidReason}>Voided</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
