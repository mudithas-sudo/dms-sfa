import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import StatusBadge from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";
import { recordVanReturn } from "@/app/actions/branch-actions";

export default async function VanReturnsPage() {
  const { branchId } = await getSession();
  const [warehouse, vans, products, returns] = await Promise.all([
    branchId ? prisma.warehouse.findFirst({ where: { branchId } }) : null,
    branchId ? prisma.van.findMany({ where: { branchId }, orderBy: { code: "asc" } }) : [],
    prisma.product.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
    branchId
      ? prisma.vanReturn.findMany({
          where: { van: { branchId } },
          orderBy: { createdAt: "desc" },
          include: { van: true, product: true },
          take: 20,
        })
      : [],
  ]);

  return (
    <div className="space-y-6">
      <h2 className="text-base font-semibold text-slate-900">Van-to-Warehouse Returns — {warehouse?.name ?? ""}</h2>
      <p className="text-sm text-slate-500">Also covers returns to the central warehouse — same workflow, either direction.</p>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Van</th>
              <th className="th">Product</th>
              <th className="th">Qty</th>
              <th className="th">Condition</th>
              <th className="th">Returned</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {returns.map((r) => (
              <tr key={r.id}>
                <td className="td">{r.van.code}</td>
                <td className="td font-medium text-slate-900">{r.product.name}</td>
                <td className="td">{r.qty}</td>
                <td className="td"><StatusBadge status={r.condition} /></td>
                <td className="td text-xs">{formatDateTime(r.createdAt)}</td>
                <td className="td"><StatusBadge status={r.status} /></td>
              </tr>
            ))}
            {returns.length === 0 && <tr><td className="td text-slate-400" colSpan={6}>No van returns recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card max-w-lg p-6">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">Record a Return</h3>
        <form action={recordVanReturn} className="space-y-4">
          <input type="hidden" name="warehouseId" value={warehouse?.id ?? ""} />
          <div>
            <label className="label" htmlFor="vanId">Van</label>
            <select className="input" id="vanId" name="vanId" required>
              {vans.map((v) => (
                <option key={v.id} value={v.id}>{v.code} — {v.driverName}</option>
              ))}
            </select>
          </div>
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
            <label className="label" htmlFor="condition">Condition</label>
            <select className="input" id="condition" name="condition" defaultValue="good">
              <option value="good">Good — back into sellable stock</option>
              <option value="damaged">Damaged — bad stock bucket</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="reason">Reason</label>
            <input className="input" id="reason" name="reason" placeholder="e.g. Unsold surplus, damaged in transit" />
          </div>
          <button type="submit" className="btn-primary">Record Return</button>
        </form>
      </div>
    </div>
  );
}
