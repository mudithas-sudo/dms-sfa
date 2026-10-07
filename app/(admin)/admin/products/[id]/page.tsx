import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { updateProduct } from "@/app/actions/admin-actions";
import Banner from "@/components/Banner";
import StatusBadge from "@/components/StatusBadge";
import ProductForm from "@/components/admin/ProductForm";
import { formatDateTime } from "@/lib/format";

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const [product, history] = await Promise.all([
    prisma.product.findUnique({ where: { id } }),
    prisma.auditLog.findMany({ where: { entity: "Product", entityId: id }, orderBy: { createdAt: "desc" }, take: 6, include: { user: true } }),
  ]);
  if (!product) notFound();

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/admin/products" className="hover:underline">Products</Link>
        <span>/</span>
        <span className="text-slate-900">{product.name}</span>
      </div>
      <div className="card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Product details</h2>
          <StatusBadge status={product.status} />
        </div>
        <div className="mb-4">
          <Banner error={error} />
        </div>
        <ProductForm action={updateProduct} product={product} submitLabel="Save local details" />
      </div>
      <div className="card p-5">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Change history</h3>
        <ul className="space-y-1.5 text-xs text-slate-600">
          {history.map((h) => (
            <li key={h.id}>
              <span className="text-slate-400">{formatDateTime(h.createdAt)}</span> · {h.user.name} · {h.summary}
            </li>
          ))}
          {history.length === 0 && <li className="text-slate-400">No recorded changes.</li>}
        </ul>
      </div>
    </div>
  );
}
