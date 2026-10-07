import { prisma } from "@/lib/prisma";
import { createPricingRule, endPricingRule } from "@/app/actions/admin-actions";
import { explainPrice, PRECEDENCE } from "@/lib/pricing";
import StatusBadge from "@/components/StatusBadge";
import Banner from "@/components/Banner";
import { formatCurrency, formatDate } from "@/lib/format";

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; checkOutlet?: string; checkProduct?: string }>;
}) {
  const { error, notice, checkOutlet, checkProduct } = await searchParams;
  const [rules, channels, outlets, products, branches] = await Promise.all([
    prisma.pricingRule.findMany({
      where: { kind: "pricing" },
      orderBy: { createdAt: "desc" },
      include: { channel: true, outlet: true, product: true },
    }),
    prisma.channel.findMany({ orderBy: { name: "asc" } }),
    prisma.outlet.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ orderBy: { name: "asc" } }),
    prisma.branch.findMany({ orderBy: { name: "asc" } }),
  ]);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const check = checkOutlet && checkProduct ? await explainPrice(checkOutlet, checkProduct).catch(() => null) : null;
  const now = new Date();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Pricing Engine</h2>
        <p className="mt-1 text-xs text-slate-500">
          Prices are built from the rules below. Each rule has an effective start date (and optional end date): a new price applies from its start date and never alters
          orders already created. The same engine prices SFA orders and branch orders.
        </p>
      </div>
      <Banner error={error} notice={notice} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Order of precedence</h3>
          <ol className="list-inside list-decimal space-y-1 text-sm text-slate-700">
            {PRECEDENCE.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-slate-500">When more than one rule applies, the highest-precedence rule decides the price. Standing customer discounts are managed separately and need approval.</p>
        </div>
        <div className="card p-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Price check</h3>
          <form method="get" className="space-y-2">
            <select name="checkOutlet" defaultValue={checkOutlet ?? ""} className="input" required>
              <option value="">Customer…</option>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            <select name="checkProduct" defaultValue={checkProduct ?? ""} className="input" required>
              <option value="">SKU…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button className="btn-secondary" type="submit">Explain this price</button>
          </form>
          {check && (
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
              <p>
                <span className="text-slate-500">{check.outlet.name} · {check.product.name}:</span>{" "}
                <strong className="text-slate-900">{formatCurrency(check.netPrice)}</strong>{" "}
                <span className="text-xs text-slate-500">(list {formatCurrency(check.listPrice)})</span>
              </p>
              <p className="mt-1 text-xs text-slate-600">{check.note}</p>
              <p className="text-xs text-slate-500">Decided by: {check.precedence}</p>
            </div>
          )}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Name</th>
              <th className="th">Level</th>
              <th className="th">Scope</th>
              <th className="th">SKU / category</th>
              <th className="th">Branches</th>
              <th className="th">Adjustment</th>
              <th className="th">Valid from</th>
              <th className="th">Valid to</th>
              <th className="th">Status</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rules.map((r) => {
              const future = r.startDate > now;
              return (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="td font-medium text-slate-900">{r.name}</td>
                  <td className="td capitalize">{r.level === "base" ? "Base price" : r.level === "sku" ? "SKU / category" : r.level}</td>
                  <td className="td">{r.channel?.name ?? r.outlet?.name ?? "All"}</td>
                  <td className="td">{r.product?.name ?? r.scopeCategory ?? "All products"}</td>
                  <td className="td">{r.branchId ? branchName.get(r.branchId) : "All branches"}</td>
                  <td className="td">{r.priceType === "fixed_price" ? `Fixed ${formatCurrency(r.value)}` : `${r.value}% off`}</td>
                  <td className="td">{formatDate(r.startDate)}</td>
                  <td className="td">{r.endDate ? formatDate(r.endDate) : "—"}</td>
                  <td className="td">
                    <StatusBadge status={future ? "pending" : r.status} />
                    {future && <span className="ml-1 text-xs text-slate-400">scheduled</span>}
                  </td>
                  <td className="td">
                    {r.status === "active" && (
                      <form action={endPricingRule}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="text-xs text-rose-600 hover:underline" type="submit">End rule</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
            {rules.length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={10}>No pricing rules configured yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card max-w-3xl p-6">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">New pricing rule</h3>
        <form action={createPricingRule} className="space-y-4">
          <div>
            <label className="label" htmlFor="name">Rule name</label>
            <input className="input" id="name" name="name" required placeholder="e.g. Modern Trade Beverage Discount" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label" htmlFor="level">Level</label>
              <select className="input" id="level" name="level" defaultValue="channel">
                <option value="channel">Channel / sub-channel</option>
                <option value="customer">Customer (outlet) markup</option>
                <option value="sku">SKU or category markup</option>
                <option value="base">Base price (SKU)</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="productId">SKU (optional, required for base price)</label>
              <select className="input" id="productId" name="productId" defaultValue="">
                <option value="">All products</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="scopeCategory">Category (for SKU-category rules)</label>
              <input className="input" id="scopeCategory" name="scopeCategory" placeholder="e.g. Beverages" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label" htmlFor="channelId">Channel (channel level)</label>
              <select className="input" id="channelId" name="channelId" defaultValue="">
                <option value="">—</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="outletId">Outlet (customer level)</label>
              <select className="input" id="outletId" name="outletId" defaultValue="">
                <option value="">—</option>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="branchId">Scope</label>
              <select className="input" id="branchId" name="branchId" defaultValue="">
                <option value="">All branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name} only</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="label" htmlFor="priceType">Adjustment type</label>
              <select className="input" id="priceType" name="priceType" defaultValue="discount_percent">
                <option value="discount_percent">Discount %</option>
                <option value="fixed_price">Fixed price</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="value">Value</label>
              <input className="input" id="value" name="value" type="number" step="0.01" required />
            </div>
            <div>
              <label className="label" htmlFor="startDate">Start date</label>
              <input className="input" id="startDate" name="startDate" type="date" required />
            </div>
            <div>
              <label className="label" htmlFor="endDate">End date (optional)</label>
              <input className="input" id="endDate" name="endDate" type="date" />
            </div>
          </div>
          <button type="submit" className="btn-primary">Create pricing rule</button>
        </form>
      </div>
    </div>
  );
}
