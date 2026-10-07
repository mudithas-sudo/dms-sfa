import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import StatusBadge from "@/components/StatusBadge";
import Banner from "@/components/Banner";
import { formatDate, daysAgo } from "@/lib/format";
import { flagPoException } from "@/app/actions/inventory-actions";
import { receivedByProduct } from "@/lib/stock";

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  const { branchId } = await getSession();
  const orders = branchId
    ? await prisma.purchaseOrder.findMany({ where: { branchId }, orderBy: { orderDate: "desc" }, include: { lines: { include: { product: true } } } })
    : [];
  const now = daysAgo(0);
  const received = new Map<string, Map<string, number>>();
  for (const po of orders) received.set(po.id, await receivedByProduct(po.id));

  const isOpen = (s: string) => s !== "received" && s !== "cancelled";
  // Exception queue: orders flagged as exceptions plus orders past their expected date.
  const exceptions = orders.filter((po) => po.status === "exception" || (isOpen(po.status) && po.expectedDate && po.expectedDate < now));

  const qtyOf = (po: (typeof orders)[number]) => {
    const got = received.get(po.id)!;
    const ordered = po.lines.reduce((s, l) => s + l.qtyOrdered, 0);
    const recd = po.lines.reduce((s, l) => s + Math.min(l.qtyOrdered, got.get(l.productId) ?? 0), 0);
    return { ordered, recd, balance: ordered - recd };
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Purchase Orders</h2>
        <p className="mt-1 text-xs text-slate-500">
          Orders arrive from the ERP for this branch. The status moves from Pending to Partially Received to Fully Received as receipts are posted; orders that need attention
          are collected in the exception queue until resolved or closed.
        </p>
      </div>
      <Banner error={error} notice={notice} />

      {exceptions.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-rose-700">Exception queue ({exceptions.length})</h3>
          <div className="card overflow-x-auto border-rose-200">
            <table className="w-full">
              <thead className="border-b border-rose-100 bg-rose-50">
                <tr>
                  <th className="th">PO</th>
                  <th className="th">Expected</th>
                  <th className="th">Why it needs attention</th>
                  <th className="th">Status</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {exceptions.map((po) => (
                  <tr key={po.id}>
                    <td className="td font-medium text-slate-900">{po.poNumber}</td>
                    <td className="td text-rose-600">{po.expectedDate ? formatDate(po.expectedDate) : "—"}</td>
                    <td className="td text-xs">{po.exceptionReason ?? "Overdue — expected date has passed"}</td>
                    <td className="td"><StatusBadge status={po.status} /></td>
                    <td className="td text-right">
                      <Link href={`/branch/purchase-orders/${po.id}`} className="text-blue-600 hover:underline">Open &amp; resolve</Link>
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
              <th className="th">PO number · date</th>
              <th className="th">Supplier</th>
              <th className="th">Expected</th>
              <th className="th">Ordered</th>
              <th className="th">Received</th>
              <th className="th">Balance</th>
              <th className="th">Status</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orders.map((po) => {
              const q = qtyOf(po);
              return (
                <tr key={po.id} className="hover:bg-slate-50">
                  <td className="td font-medium text-slate-900">
                    <Link href={`/branch/purchase-orders/${po.id}`} className="hover:underline">{po.poNumber}</Link>
                    <div className="text-xs font-normal text-slate-400">{formatDate(po.orderDate)}</div>
                  </td>
                  <td className="td text-xs">{po.supplier ?? "Company F and B central warehouse"}</td>
                  <td className="td">{po.expectedDate ? formatDate(po.expectedDate) : "—"}</td>
                  <td className="td">{q.ordered}</td>
                  <td className="td">{q.recd}</td>
                  <td className={`td ${q.balance > 0 ? "font-medium text-amber-700" : ""}`}>{q.balance}</td>
                  <td className="td"><StatusBadge status={po.status} /></td>
                  <td className="td text-right">
                    {isOpen(po.status) && (
                      <div className="flex flex-col items-end gap-1 text-xs">
                        <Link href={`/branch/purchase-orders/${po.id}/receive`} className="text-blue-600 hover:underline">Receive goods</Link>
                        {po.status !== "exception" && (
                          <details>
                            <summary className="cursor-pointer text-slate-500">Flag exception</summary>
                            <form action={flagPoException} className="mt-1 flex gap-1">
                              <input type="hidden" name="id" value={po.id} />
                              <input className="input py-1 text-xs" name="reason" placeholder="Reason" required />
                              <button className="btn-secondary px-2 py-1 text-xs" type="submit">Flag</button>
                            </form>
                          </details>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {orders.length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={8}>No purchase orders for this branch.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
