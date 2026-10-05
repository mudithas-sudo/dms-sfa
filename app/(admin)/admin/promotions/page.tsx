import Link from "next/link";
import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import { formatDate } from "@/lib/format";
import { Plus } from "lucide-react";

export default async function PromotionsPage() {
  const promotions = await prisma.promotion.findMany({
    orderBy: { startDate: "desc" },
    include: { product: true, _count: { select: { claims: true } } },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">Promotions</h2>
        <Link href="/admin/promotions/new" className="btn-primary">
          <Plus size={16} /> New Promotion
        </Link>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Name</th>
              <th className="th">Type</th>
              <th className="th">Product</th>
              <th className="th">Eligibility</th>
              <th className="th">Value</th>
              <th className="th">Period</th>
              <th className="th">Claims</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {promotions.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="td font-medium text-slate-900">{p.name}</td>
                <td className="td capitalize">{p.type.replace("_", " ")}</td>
                <td className="td">{p.product?.name ?? "All Products"}</td>
                <td className="td text-xs text-slate-500">{p.eligibilityRule}</td>
                <td className="td">{p.discountValue}%</td>
                <td className="td text-xs">{formatDate(p.startDate)} – {formatDate(p.endDate)}</td>
                <td className="td">{p._count.claims}</td>
                <td className="td"><StatusBadge status={p.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
