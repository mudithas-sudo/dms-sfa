import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export default async function CoveragePage() {
  const { branchId } = await getSession();
  if (!branchId) return <p className="text-sm text-slate-500">No branch selected.</p>;

  const reps = await prisma.user.findMany({
    where: { branchId, role: "sales_rep" },
    include: { route: { include: { stops: { include: { outlet: true }, orderBy: { sequence: "asc" } } } } },
    orderBy: { name: "asc" },
  });

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const rows = await Promise.all(
    reps.map(async (rep) => {
      const visitsToday = await prisma.fieldVisit.findMany({
        where: { salespersonId: rep.id, checkinAt: { gte: startOfToday } },
      });
      const visitedOutletIds = new Set(visitsToday.map((v) => v.outletId));
      const planned = rep.route?.stops ?? [];
      const missed = planned.filter((s) => !visitedOutletIds.has(s.outletId));
      const coveragePct = planned.length > 0 ? Math.round(((planned.length - missed.length) / planned.length) * 100) : 0;

      return { rep, planned, missed, coveragePct };
    }),
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Coverage & Call Monitoring</h2>
        <p className="text-sm text-slate-500">Planned beat-plan stops vs. today&apos;s actual visits.</p>
      </div>

      <div className="space-y-4">
        {rows.map(({ rep, planned, missed, coveragePct }) => (
          <div key={rep.id} className="card p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">{rep.name}</p>
                <p className="text-xs text-slate-500">{rep.route?.name ?? "No route assigned"} · {planned.length} planned stops</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${coveragePct >= 80 ? "bg-emerald-500" : coveragePct >= 40 ? "bg-amber-500" : "bg-rose-500"}`}
                    style={{ width: `${coveragePct}%` }}
                  />
                </div>
                <span className="text-xs text-slate-500">{coveragePct}%</span>
              </div>
            </div>
            {missed.length > 0 && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <p className="mb-1.5 text-xs font-medium text-rose-600">Missed outlets today ({missed.length})</p>
                <div className="flex flex-wrap gap-1.5">
                  {missed.map((s) => (
                    <span key={s.id} className="badge badge-red">{s.outlet.name}</span>
                  ))}
                </div>
              </div>
            )}
            {planned.length === 0 && <p className="mt-2 text-xs text-slate-400">No beat plan configured for this route.</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
