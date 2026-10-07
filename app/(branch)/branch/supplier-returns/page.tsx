import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import PrintButton from "@/components/PrintButton";
import { formatDateTime, formatDate } from "@/lib/format";
import {
  requestCentralReturn, submitCentralReturn, decideSupplierReturn, dispatchCentralReturn, receiveCentralReturn, retryErpPosting,
} from "@/app/actions/inventory-actions";
import { RETURN_REASONS, RETURN_STATUS_LABEL } from "@/lib/inventory-constants";

const TONE: Record<string, string> = {
  draft: "badge-slate", pending: "badge-amber", approved: "badge-green", shipped: "badge-amber",
  received: "badge-green", posted_to_erp: "badge-green", rejected: "badge-red", cancelled: "badge-red",
};

export default async function CentralReturnsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; doc?: string }> }) {
  const { branchId } = await getSession();
  const { error, notice, doc } = await searchParams;
  const warehouses = await prisma.warehouse.findMany({ where: branchId ? { branchId, status: "active" } : { status: "active" }, orderBy: { name: "asc" } });
  const ids = warehouses.map((w) => w.id);
  const [badRows, returns] = await Promise.all([
    prisma.stockBalance.findMany({
      where: { warehouseId: { in: ids }, OR: [{ qtyDamaged: { gt: 0 } }, { qtyExpired: { gt: 0 } }] },
      include: { product: true },
      orderBy: { product: { name: "asc" } },
    }),
    prisma.supplierReturn.findMany({ where: { warehouseId: { in: ids } }, include: { product: true, warehouse: { include: { branch: true } } }, orderBy: { createdAt: "desc" }, take: 40 }),
  ]);
  const printing = doc ? returns.find((r) => r.id === doc) : undefined;
  const byReason = new Map<string, number>();
  for (const r of returns.filter((x) => !["rejected", "cancelled", "draft"].includes(x.status))) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + r.qty);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Returns to Central Warehouse</h2>
        <p className="mt-1 text-xs text-slate-500">
          Company F and B distributes through its own branches, so unsellable stock goes back to the company&apos;s <strong>central warehouse</strong> — not to an external supplier. Only bad stock
          (damaged or expired) can be returned. Flow: draft → approval by the branch manager → dispatch (branch bad stock falls) → received at the central warehouse → posted to the ERP.
        </p>
      </div>
      <Banner error={error} notice={notice} />

      {printing && (
        <div className="card p-6">
          <div className="mb-3 flex items-center justify-between no-print">
            <h3 className="text-sm font-semibold text-slate-900">Return document</h3>
            <PrintButton />
          </div>
          <div className="space-y-1 text-sm text-slate-700">
            <p className="text-base font-semibold text-slate-900">{printing.returnNumber} — Return to central warehouse</p>
            <p>From: {printing.warehouse.name} ({printing.warehouse.branch.name}) → To: {printing.destination}</p>
            <p>Product: {printing.product.name} · lot {printing.lotNumber}{printing.expiryDate ? ` · expiry ${formatDate(printing.expiryDate)}` : ""} · quantity {printing.qty}</p>
            <p>Reason: {printing.reason} · Requested by {printing.requestedBy}{printing.approvedBy ? ` · Approved by ${printing.approvedBy}` : ""}</p>
            <p>Status: {RETURN_STATUS_LABEL[printing.status]}{printing.erpReference ? ` · ERP ref ${printing.erpReference}` : ""}</p>
          </div>
        </div>
      )}

      <div className="card max-w-3xl p-6 no-print">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">New return</h3>
        <form action={requestCentralReturn} className="grid grid-cols-2 gap-3 md:grid-cols-4" encType="multipart/form-data">
          <div className="md:col-span-2">
            <label className="label">Bad-stock lot</label>
            <select className="input" name="lotChoice" required defaultValue="">
              <option value="" disabled>Select a lot with bad stock…</option>
              {badRows.map((r) => (
                <option key={r.id} value={`${r.warehouseId}|${r.productId}|${r.lotNumber}`}>
                  {r.product.name} — lot {r.lotNumber} (damaged {r.qtyDamaged}, expired {r.qtyExpired})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Reason</label>
            <select className="input" name="reason" defaultValue="damaged">
              {RETURN_REASONS.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Quantity</label>
            <input className="input" type="number" min={1} name="qty" required />
          </div>
          <div className="md:col-span-2">
            <label className="label">Notes</label>
            <input className="input" name="notes" />
          </div>
          <div className="md:col-span-2">
            <label className="label">Photos / supporting notes (optional)</label>
            <input className="input" type="file" name="file_0" accept="image/*,.pdf" />
          </div>
          <div className="flex gap-2 md:col-span-4">
            <button className="btn-primary" type="submit" name="intent" value="submit">Submit for approval</button>
            <button className="btn-secondary" type="submit" name="intent" value="draft">Save as draft</button>
          </div>
        </form>
        <p className="mt-2 text-xs text-slate-500">No bad stock to return? Mark good stock as damaged or expired first on the Warehouse Stock screen.</p>
      </div>

      <div className="card overflow-x-auto no-print">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Return</th>
              <th className="th">Product / lot</th>
              <th className="th">Qty</th>
              <th className="th">Reason</th>
              <th className="th">Status</th>
              <th className="th">Next step</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {returns.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="td text-xs">
                  <span className="font-medium text-slate-900">{r.returnNumber}</span>
                  <div className="text-slate-400">{formatDateTime(r.createdAt)} · {r.requestedBy}</div>
                  <a className="text-blue-600 hover:underline" href={`/branch/supplier-returns?doc=${r.id}`}>Return document</a>
                </td>
                <td className="td font-medium text-slate-900">{r.product.name}<div className="text-xs font-normal text-slate-400">lot {r.lotNumber}</div></td>
                <td className="td">
                  {r.qty}
                  {r.qtyReceived !== null && r.qtyReceived !== r.qty && <div className="text-xs text-amber-700">received {r.qtyReceived}</div>}
                </td>
                <td className="td text-xs capitalize">{r.reason.replace(/_/g, " ")}{r.notes && <div className="max-w-[180px] normal-case text-slate-500">{r.notes}</div>}</td>
                <td className="td">
                  <span className={`badge ${TONE[r.status] ?? "badge-slate"}`}>{RETURN_STATUS_LABEL[r.status] ?? r.status}</span>
                  {r.erpReference && <div className="mt-1 text-[11px] text-slate-500">ERP {r.erpReference}</div>}
                  {r.erpError && <div className="mt-1 max-w-[190px] text-[11px] text-rose-600">ERP posting failed: {r.erpError}</div>}
                  {r.discrepancyNote && <div className="mt-1 max-w-[190px] text-[11px] text-amber-700">{r.discrepancyNote}</div>}
                </td>
                <td className="td text-xs">
                  {r.status === "draft" && (
                    <form action={submitCentralReturn}><input type="hidden" name="id" value={r.id} /><button className="btn-primary px-2 py-1 text-xs" type="submit">Submit for approval</button></form>
                  )}
                  {r.status === "pending" && (
                    <form action={decideSupplierReturn} className="grid gap-1">
                      <input type="hidden" name="id" value={r.id} />
                      <input className="input py-1 text-xs" name="reason" placeholder="Reason (if rejecting)" />
                      <div className="flex gap-1">
                        <button className="btn-primary px-2 py-1 text-xs" type="submit" name="decision" value="approved">Approve</button>
                        <button className="btn-danger px-2 py-1 text-xs" type="submit" name="decision" value="rejected">Reject</button>
                        <button className="btn-secondary px-2 py-1 text-xs" type="submit" name="decision" value="cancelled">Cancel</button>
                      </div>
                    </form>
                  )}
                  {r.status === "approved" && (
                    <form action={dispatchCentralReturn}><input type="hidden" name="id" value={r.id} /><button className="btn-primary px-2 py-1 text-xs" type="submit">Dispatch to central warehouse</button></form>
                  )}
                  {r.status === "shipped" && (
                    <form action={receiveCentralReturn} className="grid gap-1">
                      <input type="hidden" name="id" value={r.id} />
                      <input className="input py-1 text-xs" type="number" min={0} max={r.qty} name="qtyReceived" defaultValue={r.qty} />
                      <input className="input py-1 text-xs" name="note" placeholder="Reason if quantity differs" />
                      <button className="btn-primary px-2 py-1 text-xs" type="submit">Central warehouse: confirm receipt</button>
                    </form>
                  )}
                  {r.status === "received" && (
                    <form action={retryErpPosting}><input type="hidden" name="id" value={r.id} /><button className="btn-secondary px-2 py-1 text-xs" type="submit">Retry ERP posting</button></form>
                  )}
                </td>
              </tr>
            ))}
            {returns.length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={6}>No returns yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card p-5 no-print">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Returns volume by reason (this branch)</h3>
        <ul className="flex flex-wrap gap-4 text-sm text-slate-700">
          {[...byReason.entries()].map(([reason, qty]) => (
            <li key={reason}><span className="capitalize">{reason.replace(/_/g, " ")}</span>: <strong>{qty}</strong> units</li>
          ))}
          {byReason.size === 0 && <li className="text-slate-400">No returns recorded.</li>}
        </ul>
        <p className="mt-2 text-xs text-slate-500">Head office sees the same by branch on the management dashboard.</p>
      </div>
    </div>
  );
}
