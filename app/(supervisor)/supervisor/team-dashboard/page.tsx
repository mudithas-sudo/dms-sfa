import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { formatCurrency } from "@/lib/format";

export default async function TeamDashboardPage() {
  const { branchId } = await getSession();
  if (!branchId) return <p className="text-sm text-slate-500">No branch selected.</p>;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [reps, branchOutletCount] = await Promise.all([
    prisma.user.findMany({ where: { branchId, role: "sales_rep" }, orderBy: { name: "asc" } }),
    prisma.outlet.count({ where: { branchId, status: "active" } }),
  ]);

  const plannedRouteSize = Math.max(1, Math.ceil(branchOutletCount / Math.max(reps.length, 1)));

  const rows = await Promise.all(
    reps.map(async (rep) => {
      const [visitsToday, ordersToday, ordersValue] = await Promise.all([
        prisma.fieldVisit.findMany({ where: { salespersonId: rep.id, checkinAt: { gte: startOfToday } } }),
        prisma.salesOrder.count({ where: { salespersonId: rep.id, orderDate: { gte: startOfToday } } }),
        prisma.salesOrder.aggregate({ where: { salespersonId: rep.id, orderDate: { gte: startOfToday } }, _sum: { total: true } }),
      ]);
      const distinctOutlets = new Set(visitsToday.map((v) => v.outletId)).size;
      const coveragePct = Math.min(100, Math.round((distinctOutlets / plannedRouteSize) * 100));

      return {
        rep,
        visitsToday: visitsToday.length,
        ordersToday,
        ordersValue: ordersValue._sum.total ?? 0,
        coveragePct,
      };
    }),
  );

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">Team Dashboard — Today</h2>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Sales Rep</th>
              <th className="th">Visits Today</th>
              <th className="th">Orders Today</th>
              <th className="th">Order Value</th>
              <th className="th">Route Coverage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(({ rep, visitsToday, ordersToday, ordersValue, coveragePct }) => (
              <tr key={rep.id} className="hover:bg-slate-50">
                <td className="td font-medium text-slate-900">{rep.name}</td>
                <td className="td">{visitsToday}</td>
                <td className="td">{ordersToday}</td>
                <td className="td">{formatCurrency(ordersValue)}</td>
                <td className="td">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${coveragePct >= 80 ? "bg-emerald-500" : coveragePct >= 40 ? "bg-amber-500" : "bg-rose-500"}`}
                        style={{ width: `${coveragePct}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-500">{coveragePct}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
