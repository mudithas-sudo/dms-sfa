import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import StatusBadge from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";
import {
  requestStockTransfer, decideStockTransfer, dispatchStockTransfer, receiveStockTransfer, closeTransferDiscrepancy, reverseStockTransfer,
} from "@/app/actions/inventory-actions";

export default async function StockTransfersPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { branchId, role } = await getSession();
  const { error, notice } = await searchParams;
  const [warehouses, products, myWarehouses] = await Promise.all([
    prisma.warehouse.findMany({ where: { status: "active", type: "saleable" }, include: { branch: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
    prisma.warehouse.findMany({ where: branchId ? { branchId } : {}, select: { id: true } }),
  ]);
  const mine = new Set(myWarehouses.map((w) => w.id));
  const whName = new Map(warehouses.map((w) => [w.id, `${w.name}`]));
  const transfers = await prisma.stockTransfer.findMany({
    where: { OR: [{ fromWarehouseId: { in: [...mine] } }, { toWarehouseId: { in: [...mine] } }] },
    include: { product: true },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  const isAdmin = role === "admin";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Stock Transfers</h2>
        <p className="mt-1 text-xs text-slate-500">
          Request → approval by the receiving branch&apos;s manager (head office above the value limit) → dispatch → in transit → receipt confirmed per line. While in transit the quantity
          is out of the sender&apos;s available stock; a short or damaged receipt raises a discrepancy for review. Dispatched transfers are never edited — a reversing transfer corrects them.
        </p>
      </div>
      <Banner error={error} notice={notice} />

      <div className="card max-w-3xl p-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">New transfer request</h3>
        <form action={requestStockTransfer} className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <label className="label">From warehouse</label>
            <select className="input" name="fromWarehouseId" required>
              {warehouses.filter((w) => mine.has(w.id)).map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">To warehouse</label>
            <select className="input" name="toWarehouseId" required>
              {warehouses.filter((w) => !mine.has(w.id)).map((w) => (
                <option key={w.id} value={w.id}>{w.name} ({w.branch.name})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Product</label>
            <select className="input" name="productId" required>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Quantity</label>
            <input className="input" type="number" min={1} name="qty" required />
          </div>
          <div className="md:col-span-3">
            <input className="input" name="notes" placeholder="Note (optional)" />
          </div>
          <button className="btn-primary" type="submit">Request transfer</button>
        </form>
        <p className="mt-2 text-xs text-slate-500">Only good stock that is not allocated to open orders can be transferred. The earliest-expiry lot is picked unless you choose another when raising it from the API.</p>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Requested</th>
              <th className="th">Product / lot</th>
              <th className="th">From → To</th>
              <th className="th">Qty</th>
              <th className="th">Approver</th>
              <th className="th">Status</th>
              <th className="th">Next step</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {transfers.map((t) => {
              const incoming = mine.has(t.toWarehouseId);
              const outgoing = mine.has(t.fromWarehouseId);
              return (
                <tr key={t.id} className="align-top">
                  <td className="td text-xs">{formatDateTime(t.createdAt)}<div className="text-slate-400">by {t.requestedBy}</div></td>
                  <td className="td font-medium text-slate-900">{t.product.name}<div className="text-xs font-normal text-slate-400">lot {t.lotNumber}</div></td>
                  <td className="td text-xs">{whName.get(t.fromWarehouseId)} → {whName.get(t.toWarehouseId)}</td>
                  <td className="td">
                    {t.qty}
                    {t.qtyReceived !== null && t.qtyReceived !== t.qty && <div className="text-xs text-amber-700">received {t.qtyReceived}</div>}
                  </td>
                  <td className="td text-xs">{t.approverRole === "head_office" ? "Head office" : "Branch manager"}{t.approvedBy && <div className="text-slate-400">{t.approvedBy}</div>}</td>
                  <td className="td">
                    <StatusBadge status={t.status} />
                    {t.discrepancyNote && <div className="mt-1 max-w-[180px] text-[11px] text-amber-700">{t.discrepancyNote}</div>}
                  </td>
                  <td className="td text-xs">
                    {t.status === "pending" && incoming && (
                      <form action={decideStockTransfer} className="flex gap-1">
                        <input type="hidden" name="id" value={t.id} />
                        <button className="btn-primary px-2 py-1 text-xs" type="submit" name="decision" value="approved" disabled={t.approverRole === "head_office" && !isAdmin}>Approve</button>
                        <button className="btn-secondary px-2 py-1 text-xs" type="submit" name="decision" value="rejected">Reject</button>
                      </form>
                    )}
                    {t.status === "pending" && !incoming && <span className="text-slate-400">Awaiting the receiving branch</span>}
                    {t.status === "approved" && outgoing && (
                      <form action={dispatchStockTransfer}><input type="hidden" name="id" value={t.id} /><button className="btn-primary px-2 py-1 text-xs" type="submit">Dispatch</button></form>
                    )}
                    {t.status === "in_transit" && incoming && (
                      <form action={receiveStockTransfer} className="grid gap-1">
                        <input type="hidden" name="id" value={t.id} />
                        <input className="input py-1 text-xs" type="number" min={0} max={t.qty} name="qtyReceived" defaultValue={t.qty} />
                        <input className="input py-1 text-xs" name="note" placeholder="Shortage / damage reason" />
                        <button className="btn-primary px-2 py-1 text-xs" type="submit">Confirm receipt</button>
                      </form>
                    )}
                    {t.status === "in_transit" && !incoming && <span className="text-slate-400">In transit</span>}
                    {t.status === "discrepancy" && (
                      <form action={closeTransferDiscrepancy} className="grid gap-1">
                        <input type="hidden" name="id" value={t.id} />
                        <input className="input py-1 text-xs" name="note" placeholder="Resolution" required />
                        <button className="btn-secondary px-2 py-1 text-xs" type="submit">Close discrepancy</button>
                      </form>
                    )}
                    {t.status === "completed" && !t.reversalOfId && incoming && (
                      <form action={reverseStockTransfer}><input type="hidden" name="id" value={t.id} /><button className="text-slate-500 hover:underline" type="submit">Reverse…</button></form>
                    )}
                    {t.reversalOfId && <span className="text-slate-400">reversing transfer</span>}
                  </td>
                </tr>
              );
            })}
            {transfers.length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={7}>No transfers yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
