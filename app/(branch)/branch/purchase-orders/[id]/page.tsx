import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import Banner from "@/components/Banner";
import { formatDate, formatDateTime } from "@/lib/format";
import { receivedByProduct } from "@/lib/stock";
import { postGoodsReceipt, reviewGoodsReceipt, cancelGoodsReceipt, reverseGoodsReceipt, closePurchaseOrder } from "@/app/actions/inventory-actions";

export default async function PurchaseOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { id } = await params;
  const { error, notice } = await searchParams;
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      lines: { include: { product: true } },
      goodsReceipts: { include: { lines: { include: { product: true } }, attachments: true }, orderBy: { receivedDate: "desc" } },
    },
  });
  if (!po) notFound();
  const got = await receivedByProduct(id);
  const open = po.status !== "received" && po.status !== "cancelled";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Link href="/branch/purchase-orders" className="hover:underline">Purchase Orders</Link>
        <span>/</span>
        <span className="text-slate-900">{po.poNumber}</span>
      </div>
      <Banner error={error} notice={notice} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{po.poNumber}</h2>
          <p className="text-xs text-slate-500">
            Ordered {formatDate(po.orderDate)} · Expected {po.expectedDate ? formatDate(po.expectedDate) : "—"} · Supplier: {po.supplier ?? "Company F and B central warehouse"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={po.status} />
          {open && <Link href={`/branch/purchase-orders/${po.id}/receive`} className="btn-secondary">Receive goods</Link>}
        </div>
      </div>
      {po.exceptionReason && <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">Exception: {po.exceptionReason}</p>}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Ordered lines</h3>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Product</th>
                <th className="th">Ordered</th>
                <th className="th">Received (net)</th>
                <th className="th">Balance</th>
                <th className="th">Unit cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {po.lines.map((l) => {
                const r = got.get(l.productId) ?? 0;
                return (
                  <tr key={l.id}>
                    <td className="td font-medium text-slate-900">{l.product.name}{l.product.hasExpiry && <span className="ml-2 text-xs text-slate-400">lot &amp; expiry</span>}</td>
                    <td className="td">{l.qtyOrdered}</td>
                    <td className="td">{r}</td>
                    <td className={`td ${l.qtyOrdered - r > 0 ? "font-medium text-amber-700" : ""}`}>{Math.max(0, l.qtyOrdered - r)}{r > l.qtyOrdered ? ` (+${r - l.qtyOrdered} over)` : ""}</td>
                    <td className="td">₱{l.unitCost.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {open && (
        <form action={closePurchaseOrder} className="card flex flex-wrap items-center gap-2 p-4">
          <input type="hidden" name="id" value={po.id} />
          <span className="text-sm text-slate-700">Resolve / close this order</span>
          <input className="input max-w-sm flex-1" name="note" placeholder="Closing note (e.g. supplier confirmed short-ship)" required />
          <button className="btn-secondary" type="submit">Close order</button>
        </form>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Goods receipts</h3>
        <div className="space-y-3">
          {po.goodsReceipts.map((gr) => (
            <div key={gr.id} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                  {gr.grNumber} <StatusBadge status={gr.status} />
                  {gr.reversalOfId && <span className="text-xs font-normal text-slate-500">(reversing entry)</span>}
                </p>
                <p className="text-xs text-slate-500">
                  {formatDateTime(gr.receivedDate)} · Recorded by {gr.receivedBy}
                  {gr.reviewedBy && ` · Reviewed by ${gr.reviewedBy}`}
                </p>
              </div>
              {gr.varianceNote && <p className="mt-1 text-xs text-amber-700">{gr.varianceNote}</p>}
              <table className="mt-2 w-full text-sm">
                <thead className="border-b border-slate-200">
                  <tr>
                    <th className="th">Product</th>
                    <th className="th">Batch</th>
                    <th className="th">Mfg</th>
                    <th className="th">Expiry</th>
                    <th className="th">Expected</th>
                    <th className="th">Received</th>
                    <th className="th">Variance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {gr.lines.map((l) => {
                    const v = l.qtyExpected > 0 ? l.qtyReceived - l.qtyExpected : 0;
                    return (
                      <tr key={l.id}>
                        <td className="td">{l.product.name}</td>
                        <td className="td">{l.lotNumber}</td>
                        <td className="td">{l.manufacturingDate ? formatDate(l.manufacturingDate) : "—"}</td>
                        <td className="td">{l.expiryDate ? formatDate(l.expiryDate) : "—"}</td>
                        <td className="td">{l.qtyExpected || ""}</td>
                        <td className={`td font-medium ${l.qtyReceived < 0 ? "text-rose-600" : "text-slate-900"}`}>{l.qtyReceived}</td>
                        <td className="td text-xs">
                          {l.qtyExpected > 0 ? (v === 0 ? <span className="text-emerald-700">Match</span> : <span className="text-amber-700">{v < 0 ? "Shortage" : "Overage"} {Math.abs(v)}{l.varianceReason ? ` — ${l.varianceReason}` : ""}</span>) : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {gr.attachments.length > 0 && (
                <p className="mt-2 text-xs text-slate-500">
                  Documents: {gr.attachments.map((a) => `📎 ${a.filename} (${a.docType.replace(/_/g, " ")}${a.description ? `, ${a.description}` : ""})`).join(" · ")}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                {gr.status === "draft" && (
                  <>
                    <Link className="btn-secondary px-3 py-1 text-xs" href={`/branch/purchase-orders/${po.id}/receive?draft=${gr.id}`}>Edit draft</Link>
                    <form action={postGoodsReceipt}><input type="hidden" name="id" value={gr.id} /><button className="btn-primary px-3 py-1 text-xs" type="submit">Post to stock</button></form>
                    <form action={cancelGoodsReceipt}><input type="hidden" name="id" value={gr.id} /><button className="btn-secondary px-3 py-1 text-xs" type="submit">Cancel draft</button></form>
                  </>
                )}
                {gr.status === "pending_review" && (
                  <form action={reviewGoodsReceipt} className="flex gap-2">
                    <input type="hidden" name="id" value={gr.id} />
                    <button className="btn-primary px-3 py-1 text-xs" type="submit" name="decision" value="approved">Approve &amp; post</button>
                    <button className="btn-danger px-3 py-1 text-xs" type="submit" name="decision" value="rejected">Reject</button>
                  </form>
                )}
                {gr.status === "posted" && !gr.reversalOfId && (
                  <details>
                    <summary className="cursor-pointer text-xs text-slate-500">Reverse this receipt…</summary>
                    <form action={reverseGoodsReceipt} className="mt-2 flex gap-2">
                      <input type="hidden" name="id" value={gr.id} />
                      <input className="input py-1 text-xs" name="reason" placeholder="Reason for reversal" required />
                      <button className="btn-danger px-3 py-1 text-xs" type="submit">Post reversal</button>
                    </form>
                  </details>
                )}
              </div>
            </div>
          ))}
          {po.goodsReceipts.length === 0 && <p className="text-sm text-slate-400">No goods received against this PO yet.</p>}
        </div>
      </div>
    </div>
  );
}
