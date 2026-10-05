import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { submitStockCount, decideStockCount } from "@/app/actions/branch-actions";
import StatusBadge from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";

export default async function StockCountPage() {
  const { branchId } = await getSession();
  const warehouse = branchId ? await prisma.warehouse.findFirst({ where: { branchId } }) : null;

  const [rows, pendingCounts, recentCounts] = await Promise.all([
    warehouse
      ? prisma.stockBalance.findMany({ where: { warehouseId: warehouse.id }, include: { product: true }, orderBy: { product: { name: "asc" } } })
      : Promise.resolve([]),
    warehouse
      ? prisma.stockCount.findMany({ where: { warehouseId: warehouse.id, status: "pending_approval" }, orderBy: { countedAt: "desc" }, include: { lines: { include: { product: true } } } })
      : Promise.resolve([]),
    warehouse
      ? prisma.stockCount.findMany({ where: { warehouseId: warehouse.id, status: { in: ["closed", "rejected"] } }, orderBy: { countedAt: "desc" }, take: 5, include: { lines: true } })
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <h2 className="text-base font-semibold text-slate-900">Stock Count — {warehouse?.name ?? ""}</h2>
      <p className="text-sm text-slate-500">
        Generate a count sheet, capture the physical count, then route it for approval — variances
        only post to stock once approved.
      </p>

      {pendingCounts.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Pending Approval</h3>
          <div className="space-y-3">
            {pendingCounts.map((c) => {
              const variances = c.lines.filter((l) => l.variance !== 0);
              return (
                <div key={c.id} className="card p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-900">Counted by {c.countedBy}</p>
                      <p className="text-xs text-slate-500">{formatDateTime(c.countedAt)} · {variances.length} variance(s)</p>
                    </div>
                    <StatusBadge status={c.status} />
                  </div>
                  {variances.length > 0 && (
                    <table className="mt-3 w-full text-xs">
                      <thead>
                        <tr className="text-left text-slate-500">
                          <th className="py-1">Product</th>
                          <th className="py-1">System</th>
                          <th className="py-1">Counted</th>
                          <th className="py-1">Variance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {variances.map((l) => (
                          <tr key={l.id}>
                            <td className="py-1">{l.product.name}</td>
                            <td className="py-1">{l.systemQty}</td>
                            <td className="py-1">{l.countedQty}</td>
                            <td className={`py-1 font-medium ${l.variance < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                              {l.variance > 0 ? `+${l.variance}` : l.variance}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <form action={decideStockCount} className="mt-4 flex gap-2">
                    <input type="hidden" name="stockCountId" value={c.id} />
                    <button type="submit" name="decision" value="approved" className="btn-primary">Approve & Post Adjustment</button>
                    <button type="submit" name="decision" value="rejected" className="btn-danger">Reject</button>
                  </form>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card p-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">New Count Sheet</h3>
        <form action={submitStockCount} className="space-y-4">
          <input type="hidden" name="warehouseId" value={warehouse?.id ?? ""} />
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200">
              <tr>
                <th className="th">Product</th>
                <th className="th">Lot</th>
                <th className="th">System Qty</th>
                <th className="th">Counted Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="td font-medium text-slate-900">{r.product.name}</td>
                  <td className="td">{r.lotNumber}</td>
                  <td className="td">{r.qtyGood}</td>
                  <td className="td">
                    <input className="input w-24" type="number" name={`counted_${r.id}`} defaultValue={r.qtyGood} min={0} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="submit" className="btn-primary">Submit for Approval</button>
        </form>
      </div>

      <div className="card p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Recent Counts</h3>
        <ul className="space-y-2 text-sm">
          {recentCounts.map((c) => {
            const variances = c.lines.filter((l) => l.variance !== 0);
            return (
              <li key={c.id} className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span>{formatDateTime(c.countedAt)} by {c.countedBy}</span>
                <div className="flex items-center gap-2">
                  <span className={variances.length > 0 ? "text-amber-600" : "text-emerald-600"}>
                    {variances.length} variance{variances.length !== 1 ? "s" : ""}
                  </span>
                  <StatusBadge status={c.status} />
                </div>
              </li>
            );
          })}
          {recentCounts.length === 0 && <p className="text-xs text-slate-400">No closed stock counts yet.</p>}
        </ul>
      </div>
    </div>
  );
}
