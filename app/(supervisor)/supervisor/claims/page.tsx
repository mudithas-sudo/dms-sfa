import Link from "next/link";
import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import Banner from "@/components/Banner";
import { formatCurrency, formatDate } from "@/lib/format";
import { CLAIM_STATUS_LABEL } from "@/lib/claims";
import { Plus } from "lucide-react";

export default async function ClaimsPage({ searchParams }: { searchParams: Promise<{ status?: string; error?: string; notice?: string }> }) {
  const { status, error, notice } = await searchParams;
  const claims = await prisma.claim.findMany({
    where: status ? { status } : {},
    orderBy: { submittedAt: "desc" },
    include: { promotion: true, submittedBy: true, _count: { select: { lines: true } } },
  });
  const all = await prisma.claim.groupBy({ by: ["status"], _count: true, _sum: { amount: true } });
  const filters = ["", "draft", "submitted", "under_review", "returned", "approved", "settlement_pending", "settled", "rejected"];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Promotion Claims</h2>
          <p className="text-xs text-slate-500">Claims are raised from the delivered orders that earned a promotion, reviewed, approved and then settled.</p>
        </div>
        <Link href="/supervisor/claims/new" className="btn-primary"><Plus size={16} /> New claim</Link>
      </div>
      <Banner error={error} notice={notice} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {["submitted", "under_review", "approved", "settlement_pending"].map((s) => {
          const row = all.find((a) => a.status === s);
          return (
            <div key={s} className="card p-4">
              <p className="text-xs text-slate-500">{CLAIM_STATUS_LABEL[s]}</p>
              <p className="text-xl font-semibold text-slate-900">{row?._count ?? 0}</p>
              <p className="text-[11px] text-slate-400">{formatCurrency(row?._sum.amount ?? 0)}</p>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <Link key={f} href={f ? `/supervisor/claims?status=${f}` : "/supervisor/claims"} className={`rounded-full px-3 py-1 text-xs ${(status ?? "") === f ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {f ? CLAIM_STATUS_LABEL[f] : "All"}
          </Link>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Claim #</th>
              <th className="th">Promotion</th>
              <th className="th">Period</th>
              <th className="th">Orders</th>
              <th className="th">Eligible</th>
              <th className="th">Claimed</th>
              <th className="th">Raised by</th>
              <th className="th">Status</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {claims.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="td font-medium text-slate-900">{c.claimNumber}</td>
                <td className="td">{c.promotion.name}</td>
                <td className="td text-xs">{c.periodStart ? `${formatDate(c.periodStart)} – ${formatDate(c.periodEnd ?? c.periodStart)}` : formatDate(c.submittedAt)}</td>
                <td className="td">{c._count.lines || "—"}</td>
                <td className="td">{c.eligibleAmount != null ? formatCurrency(c.eligibleAmount) : "—"}</td>
                <td className={`td ${c.eligibleAmount != null && c.amount > c.eligibleAmount + 0.5 ? "font-medium text-rose-600" : ""}`}>{formatCurrency(c.amount)}</td>
                <td className="td">{c.submittedBy.name}</td>
                <td className="td"><StatusBadge status={c.status} /></td>
                <td className="td text-right"><Link href={`/supervisor/claims/${c.id}`} className="text-blue-600 hover:underline">Open</Link></td>
              </tr>
            ))}
            {claims.length === 0 && <tr><td className="td text-slate-400" colSpan={9}>No claims in this view.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
