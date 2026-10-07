import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import PhotoCapture from "@/components/PhotoCapture";
import { formatDate } from "@/lib/format";
import { TASK_STATUS_LABEL } from "@/lib/field-constants";
import { acknowledgeTask, completeTask, notCompleteTask, startTask } from "@/app/actions/sfa-workforce-actions";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { userId } = await getSession();
  if (!userId) return <p className="text-sm text-slate-500">No rep selected.</p>;
  const { error, notice } = await searchParams;

  const tasks = await prisma.task.findMany({ where: { assignedToId: userId }, orderBy: [{ dueDate: "asc" }], include: { outlet: true, assignedBy: true } });
  const now = new Date();
  const open = tasks.filter((t) => ["pending", "acknowledged", "in_progress"].includes(t.status));
  const closed = tasks.filter((t) => !open.includes(t));

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">My Tasks</h2>
      <Banner error={error} notice={notice} />
      <div className="space-y-2">
        {open.map((t) => {
          const overdue = t.dueDate && t.dueDate < now;
          return (
            <div key={t.id} className={`card p-3 ${overdue ? "border-rose-200" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-slate-900">{t.title}</p>
                <span className={`badge ${overdue ? "badge-red" : t.status === "pending" ? "badge-amber" : "badge-green"}`}>{overdue ? "Overdue" : TASK_STATUS_LABEL[t.status]}</span>
              </div>
              {t.description && <p className="mt-0.5 text-xs text-slate-500">{t.description}</p>}
              <p className="mt-1 text-[11px] text-slate-400">{t.outlet && `${t.outlet.name} · `}From {t.assignedBy.name} · {t.priority} priority{t.dueDate && ` · due ${formatDate(t.dueDate)}`}{t.requiresPhoto ? " · photo required" : ""}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {t.status === "pending" && <form action={acknowledgeTask}><input type="hidden" name="id" value={t.id} /><button className="btn-secondary px-3 py-1 text-xs" type="submit">Acknowledge</button></form>}
                {t.status !== "in_progress" && <form action={startTask}><input type="hidden" name="id" value={t.id} /><button className="btn-secondary px-3 py-1 text-xs" type="submit">Start</button></form>}
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-medium text-blue-600">Complete or report</summary>
                <form action={completeTask} className="mt-2 space-y-2">
                  <input type="hidden" name="id" value={t.id} />
                  <input className="input" name="notes" placeholder="Result / notes" />
                  {t.requiresPhoto && <PhotoCapture max={2} label="Photo proof" required />}
                  <button className="btn-primary w-full py-1.5 text-xs" type="submit">Mark complete</button>
                </form>
                <form action={notCompleteTask} className="mt-2 flex gap-2">
                  <input type="hidden" name="id" value={t.id} />
                  <input className="input flex-1" name="reason" placeholder="Why it can't be done" />
                  <button className="btn-secondary px-3 py-1 text-xs" type="submit">Not done</button>
                </form>
              </details>
            </div>
          );
        })}
        {open.length === 0 && <p className="card p-4 text-sm text-slate-400">No open tasks.</p>}
      </div>
      {closed.length > 0 && (
        <div className="card divide-y divide-slate-100 p-2">
          <p className="px-2 pt-1 text-xs font-semibold text-slate-700">Closed</p>
          {closed.slice(0, 12).map((t) => (
            <div key={t.id} className="flex items-center justify-between px-2 py-2 text-xs">
              <span className={t.status === "completed" ? "text-slate-500 line-through" : "text-slate-600"}>{t.title}{t.notCompletedReason ? ` — ${t.notCompletedReason}` : ""}</span>
              <span className="text-slate-400">{TASK_STATUS_LABEL[t.status]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
