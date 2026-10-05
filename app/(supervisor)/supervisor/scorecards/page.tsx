import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { formatCurrency, daysAgo } from "@/lib/format";

export default async function ScorecardsPage() {
  const { branchId } = await getSession();
  if (!branchId) return <p className="text-sm text-slate-500">No branch selected.</p>;

  const since = daysAgo(30);
  const reps = await prisma.user.findMany({ where: { branchId, role: "sales_rep" }, orderBy: { name: "asc" } });

  const rows = await Promise.all(
    reps.map(async (rep) => {
      const [orders, visits, collections] = await Promise.all([
        prisma.salesOrder.aggregate({
          where: { salespersonId: rep.id, orderDate: { gte: since }, status: { not: "voided" } },
          _sum: { total: true },
          _count: true,
        }),
        prisma.fieldVisit.count({ where: { salespersonId: rep.id, checkinAt: { gte: since } } }),
        // Scope to invoices raised from this rep's own orders — not just any
        // payment at an outlet they've ever sold to, which would double-count
        // collections across every rep who has ever touched that outlet.
        prisma.aRLedgerEntry.aggregate({
          where: {
            type: "payment",
            entryDate: { gte: since },
            invoice: { salesOrder: { salespersonId: rep.id } },
          },
          _sum: { amount: true },
        }),
      ]);
      return {
        rep,
        orderCount: orders._count,
        salesValue: orders._sum.total ?? 0,
        visitCount: visits,
        collectionsValue: collections._sum.amount ?? 0,
      };
    }),
  );

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">Rep Scorecards (30 Days)</h2>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Rep</th>
              <th className="th">Orders</th>
              <th className="th">Sales Value</th>
              <th className="th">Visits</th>
              <th className="th">Collections</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.rep.id}>
                <td className="td font-medium text-slate-900">{r.rep.name}</td>
                <td className="td">{r.orderCount}</td>
                <td className="td">{formatCurrency(r.salesValue)}</td>
                <td className="td">{r.visitCount}</td>
                <td className="td">{formatCurrency(r.collectionsValue)}</td>
                <td className="td text-right">
                  <Link href={`/supervisor/scorecards/${r.rep.id}`} className="text-blue-600 hover:underline">View Scorecard</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
