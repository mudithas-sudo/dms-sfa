import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { dayStart } from "@/lib/van";
import { reopenDay } from "@/app/actions/supervisor-field-actions";

export default async function TeamDashboardPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { branchId } = await getSession();
  const { error, notice } = await searchParams;
  const start = dayStart();

  const reps = await prisma.user.findMany({ where: { role: "sales_rep", active: true, ...(branchId ? { branchId } : {}) }, orderBy: { name: "asc" }, include: { route: { include: { _count: { select: { stops: true } } } } } });
  const ids = reps.map((r) => r.id);
  const [visits, orders, att, openTasks, pending] = await Promise.all([
    prisma.fieldVisit.findMany({ where: { salespersonId: { in: ids }, checkinAt: { gte: start } } }),
    prisma.salesOrder.groupBy({ by: ["salespersonId"], where: { salespersonId: { in: ids }, orderDate: { gte: start }, status: { notIn: ["voided", "cancelled", "draft"] } }, _sum: { total: true }, _count: true }),
    prisma.attendance.findMany({ where: { userId: { in: ids }, dayDate: { gte: start } } }),
    prisma.task.groupBy({ by: ["assignedToId"], where: { assignedToId: { in: ids }, status: { in: ["pending", "acknowledged", "in_progress"] }, dueDate: { lt: new Date() } }, _count: true }),
    prisma.approvalRequest.count({ where: { status: "pending", ...(branchId ? { branchId } : {}) } }),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">Team Dashboard — Today</h2>
        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-800">{pending} approval(s) waiting</span>
      </div>
      <Banner error={error} notice={notice} />
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr><th className="th">Sales rep</th><th className="th">Day</th><th className="th">Visits</th><th className="th">Productive</th><th className="th">Orders</th><th className="th">Order value</th><th className="th">Route coverage</th><th className="th">Flags</th><th className="th"></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {reps.map((rep) => {
              const a = att.find((x) => x.userId === rep.id);
              const v = visits.filter((x) => x.salespersonId === rep.id);
              const o = orders.find((x) => x.salespersonId === rep.id);
              const planned = rep.route?._count.stops ?? 0;
              const distinct = new Set(v.filter((x) => x.status !== "skipped").map((x) => x.outletId)).size;
              const cov = planned ? Math.min(100, Math.round((distinct / planned) * 100)) : 0;
              const flags = [
                a?.startVariance === "late" && "late start",
                a?.clockSkewFlag && "clock skew",
                v.some((x) => x.mockLocation) && "mock location",
                v.some((x) => x.outOfTolerance) && "off-site check-in",
                v.filter((x) => x.visitType === "unplanned").length > 0 && `${v.filter((x) => x.visitType === "unplanned").length} unplanned`,
                v.filter((x) => x.status === "skipped").length > 0 && `${v.filter((x) => x.status === "skipped").length} skipped`,
                (openTasks.find((t) => t.assignedToId === rep.id)?._count ?? 0) > 0 && `${openTasks.find((t) => t.assignedToId === rep.id)?._count} overdue task(s)`,
              ].filter(Boolean) as string[];
              return (
                <tr key={rep.id} className="hover:bg-slate-50">
                  <td className="td font-medium text-slate-900">{rep.name}<p className="text-[11px] font-normal text-slate-400">{rep.route?.name ?? "no route"}</p></td>
                  <td className="td text-xs">{a ? `${a.status === "completed" ? "Ended" : "Working"} · ${a.startAt ? formatDateTime(a.startAt).split(",").pop() : ""}` : <span className="text-rose-600">Not started</span>}</td>
                  <td className="td">{v.length}</td>
                  <td className="td">{v.filter((x) => x.outcome === "order_taken").length}</td>
                  <td className="td">{o?._count ?? 0}</td>
                  <td className="td">{formatCurrency(o?._sum.total ?? 0)}</td>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${cov >= 80 ? "bg-emerald-500" : cov >= 40 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${cov}%` }} /></div>
                      <span className="text-xs text-slate-500">{cov}%</span>
                    </div>
                  </td>
                  <td className="td text-[11px] text-amber-700">{flags.join(" · ") || "—"}</td>
                  <td className="td">
                    {a?.status === "completed" && (
                      <form action={reopenDay} className="flex gap-1">
                        <input type="hidden" name="attendanceId" value={a.id} />
                        <input className="input w-28 py-0.5 text-[11px]" name="reason" placeholder="Reason" required />
                        <button className="text-[11px] text-blue-600 underline" type="submit">Reopen</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
            {reps.length === 0 && <tr><td className="td text-slate-400" colSpan={9}>No representatives.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
