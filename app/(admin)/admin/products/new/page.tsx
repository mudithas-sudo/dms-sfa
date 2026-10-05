import Link from "next/link";
import { createProduct } from "@/app/actions/admin-actions";

export default function NewProductPage() {
  return (
    <div className="max-w-xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/admin/products" className="hover:underline">Products</Link>
        <span>/</span>
        <span className="text-slate-900">New</span>
      </div>
      <div className="card p-6">
        <h2 className="mb-4 text-base font-semibold text-slate-900">New Product</h2>
        <form action={createProduct} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="sku">SKU</label>
              <input className="input" id="sku" name="sku" required placeholder="e.g. BEV-006" />
            </div>
            <div>
              <label className="label" htmlFor="uom">UOM</label>
              <input className="input" id="uom" name="uom" required placeholder="CS / PACK / PC" />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="name">Product Name</label>
            <input className="input" id="name" name="name" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="category">Category</label>
              <input className="input" id="category" name="category" required placeholder="Beverages" />
            </div>
            <div>
              <label className="label" htmlFor="packSize">Pack Size</label>
              <input className="input" id="packSize" name="packSize" placeholder="e.g. 24x330ml" />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="unitPrice">Unit Price (₱)</label>
            <input className="input" id="unitPrice" name="unitPrice" type="number" step="0.01" required />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="hasExpiry" name="hasExpiry" defaultChecked className="h-4 w-4 rounded border-slate-300" />
            <label htmlFor="hasExpiry" className="text-sm text-slate-700">This product has expiry / lot tracking</label>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" className="btn-primary">Create Product</button>
            <Link href="/admin/products" className="btn-secondary">Cancel</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
