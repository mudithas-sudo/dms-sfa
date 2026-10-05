import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { createBackendOrder } from "@/app/actions/supervisor-actions";

export default async function NewBackendOrderPage() {
  const { branchId } = await getSession();
  const [outlets, products] = await Promise.all([
    branchId ? prisma.outlet.findMany({ where: { branchId, status: "active" }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    prisma.product.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Link href="/supervisor/orders" className="hover:underline">Orders</Link>
        <span>/</span>
        <span className="text-slate-900">New</span>
      </div>

      <div>
        <h2 className="text-base font-semibold text-slate-900">New Backend Order</h2>
        <p className="mt-1 text-sm text-slate-500">
          For phone or walk-in business entered directly by branch staff. Goes through the same
          validation as a field order — customer status, pricing/promotions, credit limit and stock
          availability — before it&apos;s reserved against warehouse inventory for fulfillment.
        </p>
      </div>

      <div className="card p-6">
        <form action={createBackendOrder} className="space-y-4">
          <div>
            <label className="label" htmlFor="outletId">Outlet</label>
            <select className="input" id="outletId" name="outletId" required>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>

          <table className="w-full text-sm">
            <thead className="border-b border-slate-200">
              <tr>
                <th className="th">Product</th>
                <th className="th">Unit Price</th>
                <th className="th">Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.map((p) => (
                <tr key={p.id}>
                  <td className="td font-medium text-slate-900">{p.name}</td>
                  <td className="td">₱{p.unitPrice.toLocaleString()}</td>
                  <td className="td">
                    <input className="input w-20" type="number" name={`qty_${p.id}`} min={0} defaultValue={0} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button type="submit" className="btn-primary" disabled={outlets.length === 0}>Submit Order</button>
        </form>
      </div>
    </div>
  );
}
