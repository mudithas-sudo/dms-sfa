import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import { formatDate } from "@/lib/format";
import { createCustomerDiscount } from "@/app/actions/admin-actions";

export default async function CustomerDiscountsPage() {
  const [discounts, outlets] = await Promise.all([
    prisma.pricingRule.findMany({
      where: { level: "customer" },
      orderBy: { createdAt: "desc" },
      include: { outlet: true },
    }),
    prisma.outlet.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <h2 className="text-base font-semibold text-slate-900">Fixed Customer Discounts</h2>
      <p className="text-sm text-slate-500">
        A standing discount percentage applied automatically to every order from a specific outlet,
        independent of any promotion.
      </p>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Outlet</th>
              <th className="th">Discount</th>
              <th className="th">Effective From</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {discounts.map((d) => (
              <tr key={d.id}>
                <td className="td font-medium text-slate-900">{d.outlet?.name ?? "—"}</td>
                <td className="td">{d.priceType === "fixed_price" ? `Fixed ₱${d.value}` : `${d.value}%`}</td>
                <td className="td">{formatDate(d.startDate)}</td>
                <td className="td"><StatusBadge status={d.status} /></td>
              </tr>
            ))}
            {discounts.length === 0 && <tr><td className="td text-slate-400" colSpan={4}>No standing customer discounts configured.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card max-w-lg p-6">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">New Standing Discount</h3>
        <form action={createCustomerDiscount} className="space-y-4">
          <div>
            <label className="label" htmlFor="name">Rule Name</label>
            <input className="input" id="name" name="name" required placeholder="e.g. Outlet Name — Standing 4% Discount" />
          </div>
          <div>
            <label className="label" htmlFor="outletId">Outlet</label>
            <select className="input" id="outletId" name="outletId" required>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="value">Discount %</label>
              <input className="input" id="value" name="value" type="number" step="0.01" required />
            </div>
            <div>
              <label className="label" htmlFor="startDate">Effective From</label>
              <input className="input" id="startDate" name="startDate" type="date" required />
            </div>
          </div>
          <button type="submit" className="btn-primary">Create Standing Discount</button>
        </form>
      </div>
    </div>
  );
}
