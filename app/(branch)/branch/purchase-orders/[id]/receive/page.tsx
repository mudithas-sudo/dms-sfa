import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { saveGoodsReceipt } from "@/app/actions/inventory-actions";
import Banner from "@/components/Banner";
import { receivedByProduct } from "@/lib/stock";
import { getAllSettings, num } from "@/lib/settings";

const VARIANCE_REASONS = ["Damaged on arrival", "Short-shipped by supplier", "Not delivered", "Over-delivered", "Wrong item sent", "Other"];

export default async function ReceiveGoodsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; draft?: string }>;
}) {
  const { id } = await params;
  const { error, draft } = await searchParams;
  const { branchId } = await getSession();

  const po = await prisma.purchaseOrder.findUnique({ where: { id }, include: { lines: { include: { product: true } } } });
  if (!po) notFound();
  const warehouses = await prisma.warehouse.findMany({ where: { branchId: po.branchId, status: "active", type: "saleable" }, orderBy: { name: "asc" } });
  const got = await receivedByProduct(id);
  const settings = await getAllSettings();
  const draftGr = draft ? await prisma.goodsReceipt.findUnique({ where: { id: draft }, include: { lines: true } }) : null;
  const wrongBranch = !!branchId && branchId !== po.branchId;
  const closed = po.status === "received" || po.status === "cancelled";

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/branch/purchase-orders" className="hover:underline">Purchase Orders</Link>
        <span>/</span>
        <Link href={`/branch/purchase-orders/${po.id}`} className="hover:underline">{po.poNumber}</Link>
        <span>/</span>
        <span className="text-slate-900">Receive</span>
      </div>
      <Banner error={error} />
      {wrongBranch && <Banner error="This order belongs to another branch — goods can be received only against your own branch's orders." />}
      {closed && <Banner error="This purchase order is closed — goods can be received only against an open order." />}

      <div className="card p-6">
        <h2 className="mb-1 text-base font-semibold text-slate-900">Receive goods — {po.poNumber}</h2>
        <p className="mb-4 text-xs text-slate-500">
          Enter what was physically received against the expected quantity. A shortage or overage needs a reason; receipts that vary by more than {num(settings, "gr.tolerancePct")}% are held for
          supervisor review. For lot-tracked products split the quantity by batch (batch and expiry are mandatory and must add up to the actual quantity). A draft does not change stock.
        </p>
        <form action={saveGoodsReceipt} className="space-y-5" encType="multipart/form-data">
          <input type="hidden" name="purchaseOrderId" value={po.id} />
          {draftGr && <input type="hidden" name="receiptId" value={draftGr.id} />}
          <div className="max-w-sm">
            <label className="label" htmlFor="warehouseId">Receiving warehouse</label>
            <select className="input" id="warehouseId" name="warehouseId" defaultValue={draftGr?.warehouseId} required>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>

          {po.lines.map((line) => {
            const outstanding = Math.max(0, line.qtyOrdered - (got.get(line.productId) ?? 0));
            const dLines = draftGr?.lines.filter((l) => l.productId === line.productId) ?? [];
            const dTotal = dLines.reduce((s, l) => s + l.qtyReceived, 0);
            return (
              <div key={line.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900">
                    {line.product.name} <span className="text-xs font-normal text-slate-400">{line.product.sku}</span>
                    {line.product.hasExpiry && <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">LOT &amp; EXPIRY</span>}
                  </p>
                  <p className="text-xs text-slate-500">Ordered {line.qtyOrdered} · expected now {outstanding}</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <div>
                    <label className="label">Actual quantity received</label>
                    <input className="input" type="number" min={0} name={`qty_${line.id}`} defaultValue={dTotal || outstanding} />
                  </div>
                  <div className="md:col-span-2">
                    <label className="label">Variance reason (if different from expected)</label>
                    <select className="input" name={`reason_${line.id}`} defaultValue={dLines[0]?.varianceReason ?? ""}>
                      <option value="">— none —</option>
                      {VARIANCE_REASONS.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {line.product.hasExpiry && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-medium text-slate-600">Batches (quantities must add up to the actual quantity)</p>
                    {[0, 1, 2].map((n) => {
                      const b = dLines[n];
                      return (
                        <div key={n} className="grid grid-cols-2 gap-2 md:grid-cols-4">
                          <input className="input" name={`lot_${line.id}_${n}`} placeholder={`Batch / lot ${n + 1}`} defaultValue={b?.lotNumber ?? ""} />
                          <input className="input" type="date" name={`mfg_${line.id}_${n}`} title="Manufacturing date" defaultValue={b?.manufacturingDate?.toISOString().slice(0, 10) ?? ""} />
                          <input className="input" type="date" name={`exp_${line.id}_${n}`} title="Expiry date" defaultValue={b?.expiryDate?.toISOString().slice(0, 10) ?? ""} />
                          <input className="input" type="number" min={0} name={`bqty_${line.id}_${n}`} placeholder="Qty in batch" defaultValue={b?.qtyReceived ?? ""} />
                        </div>
                      );
                    })}
                    <p className="text-[11px] text-slate-400">Columns: batch · manufacturing date · expiry date (must be in the future) · quantity</p>
                  </div>
                )}
              </div>
            );
          })}

          <div className="rounded-lg border border-slate-200 p-4">
            <p className="mb-2 text-sm font-medium text-slate-900">Delivery documents (scan or photo)</p>
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <input className="input" type="file" name={`file_${i}`} accept="image/*,.pdf" />
                  <select className="input" name={`docType_${i}`} defaultValue="delivery_receipt">
                    <option value="delivery_receipt">Delivery receipt</option>
                    <option value="packing_list">Packing list</option>
                    <option value="damage_report">Damage report</option>
                    <option value="other">Other</option>
                  </select>
                  <input className="input" name={`docDesc_${i}`} placeholder="Note (optional)" />
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">Documents stay with the receipt as part of the audit record; they can be removed only before posting.</p>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button type="submit" name="intent" value="post" className="btn-primary" disabled={wrongBranch || closed}>Post receipt</button>
            <button type="submit" name="intent" value="draft" className="btn-secondary" disabled={wrongBranch || closed}>Save as draft</button>
            <Link href={`/branch/purchase-orders/${po.id}`} className="btn-secondary">Cancel</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
