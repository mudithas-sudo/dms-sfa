import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { dayStart } from "@/lib/van";
import { formatCurrency } from "@/lib/format";

// The supervisor's view of the field app: today's team at a glance, what is waiting for a decision and the key links.
export default async function SfaSupervisorHome({ branchId, name }: { branchId: string | null; name: string }) {
  const start = dayStart();
  const reps = await prisma.user.findMany({ where: { role: "sales_rep", active: true, ...(branchId ? { branchId } : {}) }, orderBy: { name: "asc" } });
  const ids = reps.map((r) => r.id);
  const [att, visits, orders, pending, tasks, requests] = await Promise.all([
    prisma.attendance.findMany({ where: { userId: { in: ids }, dayDate: { gte: start } } }),
    prisma.fieldVisit.findMany({ where: { salespersonId: { in: ids }, checkinAt: { gte: start } } }),
    prisma.salesOrder.groupBy({ by: ["salespersonId"], where: { salespersonId: { in: ids }, orderDate: { gte: start }, status: { notIn: ["draft", "voided", "cancelled"] } }, _sum: { total: true }, _count: true }),
    prisma.approvalRequest.count({ where: { status: "pending", ...(branchId ? { branchId } : {}) } }),
    prisma.task.count({ where: { assignedToId: { in: ids }, status: { in: ["pending", "acknowledged", "in_progress"] }, dueDate: { lt: new Date() } } }),
    prisma.leaveRequest.count({ where: { userId: { in: ids }, status: "pending" } }),
  ]);
  const working = att.filter((a) => a.status === "in_progress").length;
  return (
    <div className="space-y-3">
      <div className="card p-4">
        <p className="text-xs text-slate-500">Supervisor home</p>
        <p className="text-lg font-semibold text-slate-900">{name}</p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-blue-50 p-2"><p className="text-base font-semibold text-blue-700">{working}/{reps.length}</p><p className="text-[10px] text-blue-500">Working now</p></div>
          <div className="rounded-lg bg-amber-50 p-2"><p className="text-base font-semibold text-amber-700">{pending}</p><p className="text-[10px] text-amber-600">Approvals</p></div>
          <div className="rounded-lg bg-rose-50 p-2"><p className="text-base font-semibold text-rose-700">{tasks}</p><p className="text-[10px] text-rose-500">Overdue tasks</p></div>
        </div>
      </div>
      <div className="card divide-y divide-slate-100 p-2">
        {reps.map((r) => {
          const a = att.find((x) => x.userId === r.id);
          const v = visits.filter((x) => x.salespersonId === r.id);
          const o = orders.find((x) => x.salespersonId === r.id);
          return (
            <Link key={r.id} href={`/supervisor/scorecards/${r.id}`} className="flex items-center justify-between px-2 py-2.5">
              <div>
                <p className="text-sm font-medium text-slate-900">{r.name}</p>
                <p className="text-[11px] text-slate-500">{a ? (a.status === "completed" ? "Day ended" : a.startVariance === "late" ? "Working (late start)" : "Working") : "Not started"} · {v.length} visits · {o?._count ?? 0} orders</p>
              </div>
              <span className="text-xs font-medium text-slate-700">{formatCurrency(o?._sum.total ?? 0)}</span>
            </Link>
          );
        })}
        {reps.length === 0 && <p className="px-2 py-3 text-xs text-slate-400">No representatives.</p>}
      </div>
      <div className="card p-3 text-xs">
        <Link href="/supervisor/approvals" className="flex justify-between py-1 text-slate-700"><span>✔ Approvals waiting</span><span>{pending}</span></Link>
        <Link href="/supervisor/requests" className="flex justify-between py-1 text-slate-700"><span>🗓 Leave requests waiting</span><span>{requests}</span></Link>
        <Link href="/supervisor/coverage" className="flex justify-between py-1 text-slate-700"><span>📍 Coverage &amp; call monitoring</span><span>→</span></Link>
        <Link href="/supervisor/tasks" className="flex justify-between py-1 text-slate-700"><span>📋 Assign a task</span><span>→</span></Link>
        <Link href="/sfa/key-accounts" className="flex justify-between py-1 text-slate-700"><span>💼 Key accounts &amp; activities</span><span>→</span></Link>
      </div>
    </div>
  );
}
