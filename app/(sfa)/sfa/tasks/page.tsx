import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { completeTask } from "@/app/actions/sfa-actions";
import { formatDate } from "@/lib/format";

export default async function TasksPage() {
  const { userId } = await getSession();
  if (!userId) return <p className="text-sm text-slate-500">No rep selected.</p>;

  const tasks = await prisma.task.findMany({
    where: { assignedToId: userId },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }],
    include: { outlet: true, assignedBy: true },
  });

  const pending = tasks.filter((t) => t.status === "pending");
  const completed = tasks.filter((t) => t.status === "completed");

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">My Tasks</h2>

      <div className="card divide-y divide-slate-100 p-2">
        {pending.map((t) => (
          <div key={t.id} className="px-2 py-3">
            <p className="text-sm font-medium text-slate-900">{t.title}</p>
            {t.description && <p className="mt-0.5 text-xs text-slate-500">{t.description}</p>}
            <p className="mt-1 text-xs text-slate-400">
              {t.outlet && `${t.outlet.name} · `}Assigned by {t.assignedBy.name}{t.dueDate && ` · Due ${formatDate(t.dueDate)}`}
            </p>
            <form action={completeTask} className="mt-2">
              <input type="hidden" name="id" value={t.id} />
              <button type="submit" className="btn-secondary py-1 text-xs">Mark Complete</button>
            </form>
          </div>
        ))}
        {pending.length === 0 && <p className="px-2 py-4 text-sm text-slate-400">No pending tasks.</p>}
      </div>

      {completed.length > 0 && (
        <div className="card divide-y divide-slate-100 p-2 opacity-70">
          {completed.map((t) => (
            <div key={t.id} className="px-2 py-2.5">
              <p className="text-sm text-slate-500 line-through">{t.title}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
