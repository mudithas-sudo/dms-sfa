import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import Banner from "@/components/Banner";
import { formatDate } from "@/lib/format";
import { createCustomerDiscount, endPricingRule } from "@/app/actions/admin-actions";

export default async function CustomerDiscountsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  const [discounts, outlets, products] = await Promise.all([
    prisma.pricingRule.findMany({
      where: { level: "customer", priceType: "discount_percent" },
      orderBy: { createdAt: "desc" },
      include: { outlet: true, product: true },
    }),
    prisma.outlet.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <h2 className="text-base font-semibold text-slate-900">Fixed Customer Discounts</h2>
      <p className="text-sm text-slate-500">
        A standing discount for a negotiated key account. It applies automatically to every eligible order until ended, needs approval before it takes effect, and
        historic orders keep the terms they were raised with. Where a promotion also applies, the promotion&apos;s stacking rule decides whether the two combine.
      </p>
      <Banner error={error} notice={notice} />

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Outlet</th>
              <th className="th">Discount</th>
              <th className="th">Scope</th>
              <th className="th">Effective</th>
              <th className="th">Agreement / remarks</th>
              <th className="th">Approval</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {discounts.map((d) => (
              <tr key={d.id}>
                <td className="td font-medium text-slate-900">{d.outlet?.name ?? "—"}</td>
                <td className="td">{d.value}%</td>
                <td className="td">{d.product?.name ?? d.scopeCategory ?? "All products"}</td>
                <td className="td text-xs">
                  {formatDate(d.startDate)} → {d.endDate ? formatDate(d.endDate) : "open"}
                </td>
                <td className="td text-xs text-slate-500">{d.remarks ?? "—"}</td>
                <td className="td">
                  <StatusBadge status={d.approvalStatus} />
                </td>
                <td className="td">
                  {d.status === "active" && d.approvalStatus === "active" && (
                    <form action={endPricingRule}>
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="back" value="/admin/customer-discounts" />
                      <button className="text-xs text-rose-600 hover:underline" type="submit">End</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {discounts.length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={7}>No standing customer discounts configured.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card max-w-xl p-6">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">New standing discount (requires approval)</h3>
        <form action={createCustomerDiscount} className="space-y-4">
          <div>
            <label className="label" htmlFor="name">Rule name</label>
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
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label" htmlFor="value">Discount %</label>
              <input className="input" id="value" name="value" type="number" step="0.01" required />
            </div>
            <div>
              <label className="label" htmlFor="startDate">Effective from</label>
              <input className="input" id="startDate" name="startDate" type="date" required />
            </div>
            <div>
              <label className="label" htmlFor="endDate">Effective to (optional)</label>
              <input className="input" id="endDate" name="endDate" type="date" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="productId">Scope: SKU</label>
              <select className="input" id="productId" name="productId" defaultValue="">
                <option value="">All products</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="scopeCategory">…or category</label>
              <input className="input" id="scopeCategory" name="scopeCategory" placeholder="e.g. Snacks" />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="remarks">Reason / agreement reference</label>
            <input className="input" id="remarks" name="remarks" placeholder="e.g. Contract KA-2026-014" />
          </div>
          <button type="submit" className="btn-primary">Submit for approval</button>
        </form>
      </div>
    </div>
  );
}
