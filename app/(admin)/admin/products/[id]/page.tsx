import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { updateProduct } from "@/app/actions/admin-actions";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) notFound();

  return (
    <div className="max-w-xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/admin/products" className="hover:underline">Products</Link>
        <span>/</span>
        <span className="text-slate-900">{product.name}</span>
      </div>
      <div className="card p-6">
        <h2 className="mb-4 text-base font-semibold text-slate-900">Edit Product</h2>
        <form action={updateProduct} className="space-y-4">
          <input type="hidden" name="id" value={product.id} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="sku">SKU</label>
              <input className="input" id="sku" name="sku" defaultValue={product.sku} required />
            </div>
            <div>
              <label className="label" htmlFor="uom">UOM</label>
              <input className="input" id="uom" name="uom" defaultValue={product.uom} required />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="name">Product Name</label>
            <input className="input" id="name" name="name" defaultValue={product.name} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="category">Category</label>
              <input className="input" id="category" name="category" defaultValue={product.category} required />
            </div>
            <div>
              <label className="label" htmlFor="packSize">Pack Size</label>
              <input className="input" id="packSize" name="packSize" defaultValue={product.packSize ?? ""} placeholder="e.g. 24x330ml" />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="unitPrice">Unit Price (₱)</label>
            <input className="input" id="unitPrice" name="unitPrice" type="number" step="0.01" defaultValue={product.unitPrice} />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="hasExpiry" name="hasExpiry" defaultChecked={product.hasExpiry} className="h-4 w-4 rounded border-slate-300" />
            <label htmlFor="hasExpiry" className="text-sm text-slate-700">This product has expiry / lot tracking</label>
          </div>
          <div>
            <label className="label" htmlFor="status">Status</label>
            <select className="input" id="status" name="status" defaultValue={product.status}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" className="btn-primary">Save Changes</button>
            <Link href="/admin/products" className="btn-secondary">Cancel</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
