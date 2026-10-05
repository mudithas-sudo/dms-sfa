import Link from "next/link";
import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/format";

export default async function ClaimsPage() {
  const claims = await prisma.claim.findMany({
    orderBy: { submittedAt: "desc" },
    include: { promotion: true, submittedBy: true },
  });

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">Claims Review</h2>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Claim #</th>
              <th className="th">Promotion</th>
              <th className="th">Submitted By</th>
              <th className="th">Amount</th>
              <th className="th">Submitted</th>
              <th className="th">Status</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {claims.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="td font-medium text-slate-900">{c.claimNumber}</td>
                <td className="td">{c.promotion.name}</td>
                <td className="td">{c.submittedBy.name}</td>
                <td className="td">{formatCurrency(c.amount)}</td>
                <td className="td">{formatDate(c.submittedAt)}</td>
                <td className="td"><StatusBadge status={c.status} /></td>
                <td className="td text-right">
                  <Link href={`/supervisor/claims/${c.id}`} className="text-blue-600 hover:underline">Review</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
