import { prisma } from "@/lib/prisma";
import { createPricingRule } from "@/app/actions/admin-actions";
import StatusBadge from "@/components/StatusBadge";
import { formatDate } from "@/lib/format";

export default async function PricingPage() {
  const [rules, channels, outlets, products] = await Promise.all([
    prisma.pricingRule.findMany({
      orderBy: { createdAt: "desc" },
      include: { channel: true, outlet: true, product: true },
    }),
    prisma.channel.findMany({ orderBy: { name: "asc" } }),
    prisma.outlet.findMany({ orderBy: { name: "asc" }, take: 50 }),
    prisma.product.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <h2 className="text-base font-semibold text-slate-900">Pricing Rules</h2>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Name</th>
              <th className="th">Level</th>
              <th className="th">Scope</th>
              <th className="th">Product</th>
              <th className="th">Adjustment</th>
              <th className="th">Valid From</th>
              <th className="th">Valid To</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rules.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="td font-medium text-slate-900">{r.name}</td>
                <td className="td capitalize">{r.level}</td>
                <td className="td">{r.channel?.name ?? r.outlet?.name ?? "All"}</td>
                <td className="td">{r.product?.name ?? "All Products"}</td>
                <td className="td">
                  {r.priceType === "fixed_price" ? `Fixed ₱${r.value}` : `${r.value}% off`}
                </td>
                <td className="td">{formatDate(r.startDate)}</td>
                <td className="td">{r.endDate ? formatDate(r.endDate) : "—"}</td>
                <td className="td"><StatusBadge status={r.status} /></td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={8}>No pricing rules configured yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card max-w-2xl p-6">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">New Pricing Rule</h3>
        <form action={createPricingRule} className="space-y-4">
          <div>
            <label className="label" htmlFor="name">Rule Name</label>
            <input className="input" id="name" name="name" required placeholder="e.g. Modern Trade Beverage Discount" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="level">Level</label>
              <select className="input" id="level" name="level" defaultValue="channel">
                <option value="channel">Channel</option>
                <option value="customer">Customer (Outlet)</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="productId">Product (optional)</label>
              <select className="input" id="productId" name="productId" defaultValue="">
                <option value="">All Products</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="channelId">Channel (if channel-level)</label>
              <select className="input" id="channelId" name="channelId" defaultValue="">
                <option value="">—</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="outletId">Outlet (if customer-level)</label>
              <select className="input" id="outletId" name="outletId" defaultValue="">
                <option value="">—</option>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="priceType">Adjustment Type</label>
              <select className="input" id="priceType" name="priceType" defaultValue="discount_percent">
                <option value="discount_percent">Discount %</option>
                <option value="fixed_price">Fixed Price</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="value">Value</label>
              <input className="input" id="value" name="value" type="number" step="0.01" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="startDate">Start Date</label>
              <input className="input" id="startDate" name="startDate" type="date" required />
            </div>
            <div>
              <label className="label" htmlFor="endDate">End Date (optional)</label>
              <input className="input" id="endDate" name="endDate" type="date" />
            </div>
          </div>
          <button type="submit" className="btn-primary">Create Pricing Rule</button>
        </form>
      </div>
    </div>
  );
}
