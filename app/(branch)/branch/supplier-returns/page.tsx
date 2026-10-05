import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import StatusBadge from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";
import { requestSupplierReturn, decideSupplierReturn, markSupplierReturnShipped } from "@/app/actions/branch-actions";

const REASONS = [
  { value: "expired", label: "Expired" },
  { value: "damaged", label: "Damaged" },
  { value: "recalled", label: "Recalled by principal" },
  { value: "other", label: "Other" },
];

export default async function SupplierReturnsPage() {
  const { branchId } = await getSession();
  const [warehouse, products, returns] = await Promise.all([
    branchId ? prisma.warehouse.findFirst({ where: { branchId } }) : null,
    prisma.product.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
    branchId
      ? prisma.supplierReturn.findMany({
          where: { warehouse: { branchId } },
          orderBy: { createdAt: "desc" },
          include: { product: true },
          take: 20,
        })
      : [],
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Returns to Principal — {warehouse?.name ?? ""}</h2>
        <p className="mt-1 text-sm text-slate-500">
          Warehouse stock sent back to the supplier/manufacturer for credit — expired, damaged or recalled goods
          leaving the distributor&apos;s own stock entirely, distinct from van or market returns.
        </p>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Product</th>
              <th className="th">Lot</th>
              <th className="th">Qty</th>
              <th className="th">Reason</th>
              <th className="th">Requested</th>
              <th className="th">Status</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {returns.map((r) => (
              <tr key={r.id}>
                <td className="td font-medium text-slate-900">{r.product.name}</td>
                <td className="td text-xs text-slate-500">{r.lotNumber}</td>
                <td className="td">{r.qty}</td>
                <td className="td capitalize">{r.reason}</td>
                <td className="td text-xs">{formatDateTime(r.createdAt)}</td>
                <td className="td"><StatusBadge status={r.status} /></td>
                <td className="td text-right">
                  {r.status === "pending" && (
                    <form action={decideSupplierReturn} className="flex justify-end gap-2">
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" name="decision" value="approved" className="text-xs text-emerald-600 hover:underline">Approve</button>
                      <button type="submit" name="decision" value="rejected" className="text-xs text-rose-600 hover:underline">Reject</button>
                    </form>
                  )}
                  {r.status === "approved" && (
                    <form action={markSupplierReturnShipped}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className="text-xs text-blue-600 hover:underline">Mark Shipped</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {returns.length === 0 && <tr><td className="td text-slate-400" colSpan={7}>No returns to principal recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card max-w-lg p-6">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">Request a Return</h3>
        <form action={requestSupplierReturn} className="space-y-4">
          <input type="hidden" name="warehouseId" value={warehouse?.id ?? ""} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="productId">Product</label>
              <select className="input" id="productId" name="productId" required>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="qty">Quantity</label>
              <input className="input" id="qty" name="qty" type="number" min={1} required />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="reason">Reason</label>
            <select className="input" id="reason" name="reason" defaultValue="expired">
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">Expired/damaged returns are pulled from the bad-stock bucket; recalls from good stock.</p>
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
