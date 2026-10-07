import Link from "next/link";
import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import Banner from "@/components/Banner";
import { formatDate, formatCurrency } from "@/lib/format";
import { promoSummary, promoTypeLabel, PROMO_STATUS_FLOW } from "@/lib/promotions";
import { Plus } from "lucide-react";

export default async function PromotionsPage({ searchParams }: { searchParams: Promise<{ status?: string; error?: string; notice?: string }> }) {
  const { status, error, notice } = await searchParams;
  const [promotions, products] = await Promise.all([
    prisma.promotion.findMany({
      where: status ? { status } : { status: { not: "discarded" } },
      orderBy: [{ startDate: "desc" }, { version: "desc" }],
      include: { product: true, _count: { select: { claims: true } } },
    }),
    prisma.product.findMany({ select: { id: true, name: true } }),
  ]);
  const pname = (id: string) => products.find((p) => p.id === id)?.name ?? id;
  const filters = ["", "draft", "approved", "active", "suspended", "expired"];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Promotions</h2>
          <p className="text-xs text-slate-500">Lifecycle: {PROMO_STATUS_FLOW}. Only <strong>Active</strong> promotions apply to orders; changes to a running promotion are made as a new version.</p>
        </div>
        <Link href="/admin/promotions/new" className="btn-primary">
          <Plus size={16} /> New Promotion
        </Link>
      </div>
      <Banner error={error} notice={notice} />
      <div className="flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <Link key={f} href={f ? `/admin/promotions?status=${f}` : "/admin/promotions"} className={`rounded-full px-3 py-1 text-xs ${((status ?? "") === f) ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {f ? f[0].toUpperCase() + f.slice(1) : "All"}
          </Link>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Promotion</th>
              <th className="th">Type</th>
              <th className="th">Benefit</th>
              <th className="th">Period</th>
              <th className="th">Budget used</th>
              <th className="th">Redemptions</th>
              <th className="th">Claims</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {promotions.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="td">
                  <Link href={`/admin/promotions/${p.id}`} className="font-medium text-blue-700 hover:underline">{p.name}</Link>
                  <p className="text-[11px] text-slate-400">{p.code ? `${p.code} · ` : ""}v{p.version} · {p.product?.name ?? "All products"}</p>
                </td>
                <td className="td text-xs">{promoTypeLabel(p.type)}</td>
                <td className="td text-xs text-slate-600">{promoSummary(p, pname)}</td>
                <td className="td text-xs">{formatDate(p.startDate)} – {formatDate(p.endDate)}</td>
                <td className="td text-xs">{formatCurrency(p.budgetUsed)}{p.budget ? ` / ${formatCurrency(p.budget)}` : ""}</td>
                <td className="td text-xs">{p.redemptions}{p.maxRedemptions ? ` / ${p.maxRedemptions}` : ""}</td>
                <td className="td">{p._count.claims}</td>
                <td className="td"><StatusBadge status={p.status} /></td>
              </tr>
            ))}
            {promotions.length === 0 && (
              <tr><td className="td text-slate-400" colSpan={8}>No promotions in this view.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
