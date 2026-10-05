import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import StatusBadge from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";
import { requestStockAdjustment, decideStockAdjustment } from "@/app/actions/branch-actions";

const REASON_CODES = [
  { value: "damage", label: "Damage" },
  { value: "shrinkage", label: "Shrinkage" },
  { value: "count_correction", label: "Count Correction" },
  { value: "other", label: "Other" },
];

export default async function StockAdjustmentsPage() {
  const { branchId } = await getSession();
  const warehouse = branchId ? await prisma.warehouse.findFirst({ where: { branchId } }) : null;

  const [adjustments, products] = await Promise.all([
    warehouse
      ? prisma.stockAdjustment.findMany({ where: { warehouseId: warehouse.id }, orderBy: { createdAt: "desc" }, include: { product: true } })
      : Promise.resolve([]),
    prisma.product.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <h2 className="text-base font-semibold text-slate-900">Stock Adjustments — {warehouse?.name ?? ""}</h2>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Product</th>
              <th className="th">Qty Δ</th>
              <th className="th">Reason</th>
              <th className="th">Requested</th>
              <th className="th">Status</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {adjustments.map((a) => (
              <tr key={a.id}>
                <td className="td font-medium text-slate-900">{a.product.name}</td>
                <td className={`td font-medium ${a.qtyDelta < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                  {a.qtyDelta > 0 ? `+${a.qtyDelta}` : a.qtyDelta}
                </td>
                <td className="td capitalize">{a.reasonCode.replace(/_/g, " ")}</td>
                <td className="td text-xs">{formatDateTime(a.createdAt)}</td>
                <td className="td"><StatusBadge status={a.status} /></td>
                <td className="td text-right">
                  {a.status === "pending" && (
                    <form action={decideStockAdjustment} className="flex justify-end gap-2">
                      <input type="hidden" name="id" value={a.id} />
                      <button type="submit" name="decision" value="approved" className="text-xs text-emerald-600 hover:underline">Approve</button>
                      <button type="submit" name="decision" value="rejected" className="text-xs text-rose-600 hover:underline">Reject</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {adjustments.length === 0 && <tr><td className="td text-slate-400" colSpan={6}>No stock adjustments yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card max-w-lg p-6">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">Request Adjustment</h3>
        <form action={requestStockAdjustment} className="space-y-4">
          <input type="hidden" name="warehouseId" value={warehouse?.id ?? ""} />
          <div>
            <label className="label" htmlFor="productId">Product</label>
            <select className="input" id="productId" name="productId" required>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="qtyDelta">Qty Change (negative to remove)</label>
              <input className="input" id="qtyDelta" name="qtyDelta" type="number" required />
            </div>
            <div>
              <label className="label" htmlFor="reasonCode">Reason</label>
              <select className="input" id="reasonCode" name="reasonCode" defaultValue="damage">
                {REASON_CODES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="notes">Notes</label>
            <input className="input" id="notes" name="notes" placeholder="Optional detail" />
          </div>
          <button type="submit" className="btn-primary">Submit for Approval</button>
        </form>
      </div>
    </div>
  );
}
