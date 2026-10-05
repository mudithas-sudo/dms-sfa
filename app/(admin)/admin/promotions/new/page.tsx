import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createPromotion } from "@/app/actions/admin-actions";

export default async function NewPromotionPage() {
  const [products, channels] = await Promise.all([
    prisma.product.findMany({ orderBy: { name: "asc" } }),
    prisma.channel.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="max-w-xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/admin/promotions" className="hover:underline">Promotions</Link>
        <span>/</span>
        <span className="text-slate-900">New</span>
      </div>
      <div className="card p-6">
        <h2 className="mb-4 text-base font-semibold text-slate-900">New Promotion</h2>
        <form action={createPromotion} className="space-y-4">
          <div>
            <label className="label" htmlFor="name">Promotion Name</label>
            <input className="input" id="name" name="name" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="type">Type</label>
              <select className="input" id="type" name="type" defaultValue="volume_discount">
                <option value="volume_discount">Volume Discount</option>
                <option value="free_good">Free Good (Buy-X-Get-Y)</option>
                <option value="price_off">Price-Off</option>
                <option value="rebate">Rebate</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="productId">Product</label>
              <select className="input" id="productId" name="productId" defaultValue="">
                <option value="">All Products</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="channelId">Channel</label>
            <select className="input" id="channelId" name="channelId" defaultValue="">
              <option value="">All Channels</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="eligibilityRule">Eligibility Rule (description)</label>
            <input className="input" id="eligibilityRule" name="eligibilityRule" placeholder="e.g. Channel=GT AND Qty>=10" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="minQty">Minimum Qty (eligibility)</label>
              <input className="input" id="minQty" name="minQty" type="number" min={1} placeholder="e.g. 10" />
            </div>
            <div>
              <label className="label" htmlFor="freeQty">Free Units (for Free Good type)</label>
              <input className="input" id="freeQty" name="freeQty" type="number" min={1} placeholder="e.g. 1" />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="discountValue">Discount % (for Volume/Price-Off/Rebate)</label>
            <input className="input" id="discountValue" name="discountValue" type="number" step="0.01" defaultValue={0} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="startDate">Start Date</label>
              <input className="input" id="startDate" name="startDate" type="date" required />
            </div>
            <div>
              <label className="label" htmlFor="endDate">End Date</label>
              <input className="input" id="endDate" name="endDate" type="date" required />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" className="btn-primary">Create Promotion</button>
            <Link href="/admin/promotions" className="btn-secondary">Cancel</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
