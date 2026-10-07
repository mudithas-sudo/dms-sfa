import Link from "next/link";
import { prisma } from "@/lib/prisma";
import Banner from "@/components/Banner";
import { createPurchaseOrder } from "@/app/actions/po-actions";

export default async function NewPurchaseOrderPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const products = await prisma.product.findMany({ where: { status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true, sku: true } });
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/branch/purchase-orders" className="hover:underline">Purchase Orders</Link><span>/</span><span className="text-slate-900">New</span>
      </div>
      <Banner error={error} />
      <div className="card p-6">
        <h2 className="mb-1 text-base font-semibold text-slate-900">Create a purchase reference</h2>
        <p className="mb-4 text-xs text-slate-500">Use this for a purchase that has no ERP order yet. The reference is sent to the ERP and received into stock exactly like an ERP order.</p>
        <form action={createPurchaseOrder} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="supplier">Supplier</label><input className="input" id="supplier" name="supplier" required placeholder="e.g. Company F and B Central Warehouse" /></div>
            <div><label className="label" htmlFor="expectedDate">Expected delivery</label><input className="input" id="expectedDate" name="expectedDate" type="date" /></div>
          </div>
          <div className="space-y-2">
            <p className="label">Lines</p>
            {Array.from({ length: 6 }, (_, i) => i + 1).map((i) => (
              <div key={i} className="grid grid-cols-[1fr_90px_110px] gap-2">
                <select className="input" name={`product${i}`} defaultValue=""><option value="">— product {i} —</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}</select>
                <input className="input" name={`qty${i}`} type="number" min={1} placeholder="Qty" />
                <input className="input" name={`cost${i}`} type="number" step="0.01" min={0} placeholder="Unit cost ₱" />
              </div>
            ))}
          </div>
          <div className="flex gap-2"><button type="submit" className="btn-primary">Create purchase order</button><Link href="/branch/purchase-orders" className="btn-secondary">Cancel</Link></div>
        </form>
      </div>
    </div>
  );
}
