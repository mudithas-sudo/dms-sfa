import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import StatusBadge from "@/components/StatusBadge";
import { formatDate } from "@/lib/format";

export default async function PurchaseOrdersPage() {
  const { branchId } = await getSession();
  const orders = branchId
    ? await prisma.purchaseOrder.findMany({
        where: { branchId },
        orderBy: { orderDate: "desc" },
        include: { lines: true },
      })
    : [];

  const now = new Date();
  const exceptions = orders.filter(
    (po) => po.status !== "received" && po.status !== "cancelled" && po.expectedDate && po.expectedDate < now,
  );

  return (
    <div className="space-y-6">
      <h2 className="text-base font-semibold text-slate-900">Purchase Orders</h2>

      {exceptions.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-rose-700">Exception Queue — Overdue Expected Date</h3>
          <div className="card overflow-x-auto border-rose-200">
            <table className="w-full">
              <thead className="border-b border-rose-100 bg-rose-50">
                <tr>
                  <th className="th">PO Number</th>
                  <th className="th">Expected</th>
                  <th className="th">Status</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {exceptions.map((po) => (
                  <tr key={po.id}>
                    <td className="td font-medium text-slate-900">{po.poNumber}</td>
                    <td className="td text-rose-600">{formatDate(po.expectedDate!)}</td>
                    <td className="td"><StatusBadge status={po.status} /></td>
                    <td className="td text-right">
                      <Link href={`/branch/purchase-orders/${po.id}/receive`} className="text-blue-600 hover:underline">Receive Goods</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">PO Number</th>
              <th className="th">Order Date</th>
              <th className="th">Expected</th>
              <th className="th">Lines</th>
              <th className="th">Status</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orders.map((po) => (
              <tr key={po.id} className="hover:bg-slate-50">
                <td className="td font-medium text-slate-900">{po.poNumber}</td>
                <td className="td">{formatDate(po.orderDate)}</td>
                <td className="td">{po.expectedDate ? formatDate(po.expectedDate) : "—"}</td>
                <td className="td">{po.lines.length}</td>
                <td className="td"><StatusBadge status={po.status} /></td>
                <td className="td text-right">
                  {po.status !== "received" && po.status !== "cancelled" && (
                    <Link href={`/branch/purchase-orders/${po.id}/receive`} className="text-blue-600 hover:underline">
                      Receive Goods
                    </Link>
                  )}
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr><td className="td text-slate-400" colSpan={6}>No purchase orders for this branch.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
