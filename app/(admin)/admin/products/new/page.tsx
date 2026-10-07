import Link from "next/link";
import { createProduct } from "@/app/actions/admin-actions";
import Banner from "@/components/Banner";
import ProductForm from "@/components/admin/ProductForm";

export default async function NewProductPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/admin/products" className="hover:underline">Products</Link>
        <span>/</span>
        <span className="text-slate-900">New</span>
      </div>
      <div className="card p-6">
        <h2 className="mb-1 text-base font-semibold text-slate-900">Receive product from ERP (simulated feed)</h2>
        <p className="mb-4 text-xs text-slate-500">
          In the live platform the core product definition arrives through the ERP interface. This form simulates one message of that feed; once
          received, those fields are read-only in the DMS.
        </p>
        <div className="mb-4">
          <Banner error={error} />
        </div>
        <ProductForm action={createProduct} submitLabel="Receive product" />
      </div>
    </div>
  );
}
