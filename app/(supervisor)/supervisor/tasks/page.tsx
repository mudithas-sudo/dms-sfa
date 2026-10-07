import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import { formatDate } from "@/lib/format";
import { TASK_STATUS_LABEL } from "@/lib/field-constants";
import { cancelTask, createTask } from "@/app/actions/supervisor-field-actions";

const TONE: Record<string, string> = { pending: "badge-amber", acknowledged: "badge-amber", in_progress: "badge-amber", completed: "badge-green", not_completed: "badge-red", cancelled: "badge-red", overdue: "badge-red" };

export default async function SupervisorTasksPage({ searchParams }: { searchParams: Promise<{ status?: string; error?: string; notice?: string }> }) {
  const { branchId } = await getSession();
  const { status, error, notice } = await searchParams;
  const reps = await prisma.user.findMany({ where: { role: "sales_rep", active: true, ...(branchId ? { branchId } : {}) }, orderBy: { name: "asc" } });
  const outlets = await prisma.outlet.findMany({ where: { status: "active", ...(branchId ? { branchId } : {}) }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const tasks = await prisma.task.findMany({ where: { assignedToId: { in: reps.map((r) => r.id) } }, orderBy: { createdAt: "desc" }, take: 80, include: { assignedTo: true, outlet: true } });
  const now = new Date();
  const eff = (t: (typeof tasks)[number]) => (["pending", "acknowledged", "in_progress"].includes(t.status) && t.dueDate && t.dueDate < now ? "overdue" : t.status);
  const shown = tasks.filter((t) => !status || eff(t) === status);
  const counts: Record<string, number> = {};
  for (const t of tasks) counts[eff(t)] = (counts[eff(t)] ?? 0) + 1;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Task Assignment &amp; Tracking</h2>
        <p className="text-xs text-slate-500">Assign work to representatives, follow it from acknowledgement to completion and see what is overdue or could not be done.</p>
      </div>
      <Banner error={error} notice={notice} />

      <div className="flex flex-wrap gap-1.5">
        {["", "pending", "acknowledged", "in_progress", "completed", "not_completed", "overdue", "cancelled"].map((f) => (
          <a key={f} href={f ? `/supervisor/tasks?status=${f}` : "/supervisor/tasks"} className={`rounded-full px-3 py-1 text-xs ${(status ?? "") === f ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>
            {f ? `${TASK_STATUS_LABEL[f] ?? "Overdue"} (${counts[f] ?? 0})` : "All"}
          </a>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Task</th><th className="th">Representative</th><th className="th">Customer</th><th className="th">Due</th><th className="th">Status</th><th className="th">Outcome</th><th className="th"></th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((t) => {
              const e = eff(t);
              return (
                <tr key={t.id}>
                  <td className="td"><span className="font-medium text-slate-900">{t.title}</span>{t.requiresPhoto && <span className="ml-1 text-[10px] text-slate-400">📷 photo</span>}<p className="text-[11px] text-slate-500">{t.priority} priority</p></td>
                  <td className="td">{t.assignedTo.name}</td>
                  <td className="td text-xs">{t.outlet?.name ?? "—"}</td>
                  <td className="td text-xs">{t.dueDate ? formatDate(t.dueDate) : "—"}</td>
                  <td className="td"><span className={`badge ${TONE[e]}`}>{e === "overdue" ? "Overdue" : TASK_STATUS_LABEL[e]}</span></td>
                  <td className="td text-xs text-slate-500">{t.notCompletedReason ? `Not done: ${t.notCompletedReason}` : t.notes ?? "—"}</td>
                  <td className="td text-right">
                    {!["completed", "cancelled"].includes(t.status) && (
                      <form action={cancelTask}><input type="hidden" name="id" value={t.id} /><button className="text-xs text-rose-600 hover:underline" type="submit">Cancel</button></form>
                    )}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && <tr><td className="td text-slate-400" colSpan={7}>No tasks in this view.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card max-w-2xl p-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Assign a task</h3>
        <form action={createTask} className="space-y-3">
          <input className="input" name="title" placeholder="Task title *" required />
          <textarea className="input" name="description" rows={2} placeholder="Instructions" />
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="outletId">Customer (optional)</label>
              <select className="input" id="outletId" name="outletId" defaultValue=""><option value="">—</option>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
            </div>
            <div><label className="label" htmlFor="dueDate">Due date</label><input className="input" id="dueDate" name="dueDate" type="date" /></div>
            <div>
              <label className="label" htmlFor="priority">Priority</label>
              <select className="input" id="priority" name="priority" defaultValue="normal"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select>
            </div>
          </div>
          <div>
            <p className="label">Assign to *</p>
            <div className="flex flex-wrap gap-3">
              {reps.map((r) => (
                <label key={r.id} className="flex items-center gap-1.5 text-sm text-slate-700"><input type="checkbox" name="assignedToId" value={r.id} className="h-4 w-4 rounded border-slate-300" /> {r.name}</label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" name="requiresPhoto" /> A photo is required to complete this task</label>
          <button type="submit" className="btn-primary">Assign task</button>
        </form>
      </div>
    </div>
  );
}
