import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { dayStart } from "@/lib/van";
import { formatDateTime } from "@/lib/format";
import { getAllSettings, num } from "@/lib/settings";

export default async function CoveragePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { branchId } = await getSession();
  const { date } = await searchParams;
  const day = date ? dayStart(new Date(date)) : dayStart();
  const next = new Date(day.getTime() + 86400000);
  const weekday = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][day.getDay()];
  const s = await getAllSettings();
  const minMin = num(s, "visit.minDurationMin");

  const reps = await prisma.user.findMany({
    where: { role: "sales_rep", active: true, ...(branchId ? { branchId } : {}) },
    include: { route: { include: { stops: { include: { outlet: true }, orderBy: { sequence: "asc" } } } } },
    orderBy: { name: "asc" },
  });
  const visits = await prisma.fieldVisit.findMany({ where: { salespersonId: { in: reps.map((r) => r.id) }, checkinAt: { gte: day, lt: next } }, include: { outlet: true }, orderBy: { checkinAt: "asc" } });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Coverage &amp; Call Monitoring</h2>
          <p className="text-sm text-slate-500">Planned stops against actual calls, with duration, location and exception flags.</p>
        </div>
        <form method="get" className="flex items-end gap-2"><div><label className="label" htmlFor="date">Day</label><input className="input" id="date" type="date" name="date" defaultValue={date ?? ""} /></div><button className="btn-secondary" type="submit">Show</button></form>
      </div>

      <div className="space-y-4">
        {reps.map((rep) => {
          const mine = visits.filter((v) => v.salespersonId === rep.id);
          const planned = (rep.route?.stops ?? []).filter((s2) => !s2.outlet.visitDay || s2.outlet.visitDay === weekday);
          const visited = new Set(mine.filter((v) => v.status !== "skipped").map((v) => v.outletId));
          const skipped = mine.filter((v) => v.status === "skipped");
          const missed = planned.filter((p) => !visited.has(p.outletId) && !skipped.some((k) => k.outletId === p.outletId));
          const pct = planned.length ? Math.round((planned.filter((p) => visited.has(p.outletId)).length / planned.length) * 100) : 0;
          return (
            <div key={rep.id} className="card p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{rep.name}</p>
                  <p className="text-xs text-slate-500">{rep.route?.name ?? "No route"} · {planned.length} stops planned for {weekday} · {mine.length} call(s)</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${pct >= 80 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${pct}%` }} /></div>
                  <span className="text-xs text-slate-500">{pct}%</span>
                </div>
              </div>
              {mine.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-slate-500"><th className="py-1 font-normal">Customer</th><th className="font-normal">Type</th><th className="font-normal">Check-in</th><th className="font-normal">Duration</th><th className="font-normal">Distance</th><th className="font-normal">Outcome</th><th className="font-normal">Flags</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {mine.map((v) => {
                        const mins = v.checkoutAt ? Math.round((v.checkoutAt.getTime() - v.checkinAt.getTime()) / 60000) : null;
                        const flags = [v.outOfTolerance && "location variance", v.mockLocation && "mock location", mins !== null && v.status === "completed" && mins < minMin && "short call", v.visitType === "unplanned" && "unplanned", v.status === "in_progress" && "still open", v.complaint && "complaint", v.followUp && "follow-up"].filter(Boolean) as string[];
                        return (
                          <tr key={v.id}>
                            <td className="py-1.5 font-medium text-slate-900">{v.outlet.name}</td><td className="capitalize">{v.visitType}</td><td>{formatDateTime(v.checkinAt).split(",").pop()}</td>
                            <td>{mins === null ? "—" : `${mins} min`}</td><td>{v.distanceM != null ? `${v.distanceM} m` : "—"}</td>
                            <td>{v.status === "skipped" ? `Skipped — ${v.skipReason}` : (v.outcome ?? "—").replace(/_/g, " ")}{v.noOrderReason ? ` (${v.noOrderReason})` : ""}</td>
                            <td className="text-amber-700">{flags.join(" · ") || "—"}{v.overrideReason ? ` — "${v.overrideReason}"` : ""}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {missed.length > 0 && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <p className="mb-1.5 text-xs font-medium text-rose-600">Not visited ({missed.length})</p>
                  <div className="flex flex-wrap gap-1.5">{missed.map((m) => <span key={m.id} className="badge badge-red">{m.outlet.name}</span>)}</div>
                </div>
              )}
              {planned.length === 0 && <p className="mt-2 text-xs text-slate-400">No stops planned for this day.</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
