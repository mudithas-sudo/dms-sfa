import Link from "next/link";
import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import { formatCurrency } from "@/lib/format";
import { Plus } from "lucide-react";

export default async function ProductsPage() {
  const products = await prisma.product.findMany({ orderBy: { sku: "asc" } });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">Products</h2>
        <Link href="/admin/products/new" className="btn-primary">
          <Plus size={16} /> New Product
        </Link>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">SKU</th>
              <th className="th">Name</th>
              <th className="th">Brand / Category</th>
              <th className="th">UOM · Pack</th>
              <th className="th">Min order</th>
              <th className="th">Unit Price</th>
              <th className="th">Has Expiry</th>
              <th className="th">Status</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {products.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="td font-mono text-xs text-slate-500">{p.sku}</td>
                <td className="td font-medium text-slate-900">{p.name}</td>
                <td className="td">{p.brand ? `${p.brand} · ` : ""}{p.category}</td>
                <td className="td">{p.uom}{p.packSize ? ` · ${p.packSize}` : ""}</td>
                <td className="td">{p.minOrderQty}</td>
                <td className="td">{formatCurrency(p.unitPrice)}</td>
                <td className="td">{p.hasExpiry ? "Yes" : "No"}</td>
                <td className="td"><StatusBadge status={p.status} /></td>
                <td className="td text-right">
                  <Link href={`/admin/products/${p.id}`} className="text-blue-600 hover:underline">Edit</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
