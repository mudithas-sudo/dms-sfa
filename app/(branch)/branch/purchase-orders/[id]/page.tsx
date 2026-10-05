import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import { formatDate, formatDateTime } from "@/lib/format";

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      lines: { include: { product: true } },
      goodsReceipts: { include: { lines: { include: { product: true } } }, orderBy: { receivedDate: "desc" } },
    },
  });
  if (!po) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Link href="/branch/purchase-orders" className="hover:underline">Purchase Orders</Link>
        <span>/</span>
        <span className="text-slate-900">{po.poNumber}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{po.poNumber}</h2>
          <p className="text-xs text-slate-500">
            Ordered {formatDate(po.orderDate)} · Expected {po.expectedDate ? formatDate(po.expectedDate) : "—"}
          </p>
        </div>
        <StatusBadge status={po.status} />
        {po.status !== "received" && po.status !== "cancelled" && (
          <Link href={`/branch/purchase-orders/${po.id}/receive`} className="btn-secondary">Receive Goods</Link>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Ordered Lines</h3>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Product</th>
                <th className="th">Qty Ordered</th>
                <th className="th">Unit Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {po.lines.map((l) => (
                <tr key={l.id}>
                  <td className="td font-medium text-slate-900">{l.product.name}</td>
                  <td className="td">{l.qtyOrdered}</td>
                  <td className="td">₱{l.unitCost.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Goods Receipts</h3>
        <div className="space-y-3">
          {po.goodsReceipts.map((gr) => (
            <div key={gr.id} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-900">{gr.grNumber}</p>
                <p className="text-xs text-slate-500">
                  {formatDateTime(gr.receivedDate)} · Received by {gr.receivedBy}
                  {gr.attachmentFilename && ` · 📎 ${gr.attachmentFilename}`}
                </p>
              </div>
              <table className="mt-2 w-full text-sm">
                <thead className="border-b border-slate-200">
                  <tr>
                    <th className="th">Product</th>
                    <th className="th">Lot</th>
                    <th className="th">Expiry</th>
                    <th className="th">Expected</th>
                    <th className="th">Received</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {gr.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="td">{l.product.name}</td>
                      <td className="td">{l.lotNumber}</td>
                      <td className="td">{l.expiryDate ? formatDate(l.expiryDate) : "—"}</td>
                      <td className="td">{l.qtyExpected}</td>
                      <td className={`td font-medium ${l.qtyReceived < l.qtyExpected ? "text-amber-600" : "text-slate-900"}`}>
                        {l.qtyReceived}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {po.goodsReceipts.length === 0 && <p className="text-sm text-slate-400">No goods received against this PO yet.</p>}
        </div>
      </div>
    </div>
  );
}
