import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import OutletMap from "@/components/OutletMap";
import { distanceM, formatDistance } from "@/lib/geo";
import { dayStart } from "@/lib/van";
import { SKIP_REASONS } from "@/lib/field-constants";
import { skipStop } from "@/app/actions/sfa-field-actions";
import { ChevronRight, Check, Navigation } from "lucide-react";
import { ProgressTrack } from "@/components/Tracking";

const WEEKDAY = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const STATE_STYLE: Record<string, string> = {
  visited: "bg-emerald-50 text-emerald-700",
  in_progress: "bg-blue-50 text-blue-700",
  skipped: "bg-amber-50 text-amber-700",
  missed: "bg-rose-50 text-rose-600",
  planned: "bg-slate-100 text-slate-500",
};
const DOT_STYLE: Record<string, string> = {
  visited: "bg-emerald-500 text-white",
  in_progress: "bg-blue-600 text-white",
  skipped: "bg-amber-500 text-white",
  missed: "bg-rose-500 text-white",
  planned: "bg-white text-slate-500 ring-2 ring-inset ring-slate-200",
};

export default async function RoutePlanPage({ searchParams }: { searchParams: Promise<{ view?: string; sort?: string; error?: string; notice?: string }> }) {
  const { userId } = await getSession();
  if (!userId) return <p className="text-sm text-slate-500">No rep selected.</p>;
  const { view = "list", sort = "sequence", error, notice } = await searchParams;

  const rep = await prisma.user.findUnique({ where: { id: userId }, include: { route: { include: { stops: { include: { outlet: true }, orderBy: { sequence: "asc" } } } } } });
  const start = dayStart();
  const [visits, attendance] = await Promise.all([
    prisma.fieldVisit.findMany({ where: { salespersonId: userId, checkinAt: { gte: start } } }),
    prisma.attendance.findFirst({ where: { userId, dayDate: { gte: start } } }),
  ]);
  const today = WEEKDAY[new Date().getDay()];
  const dayEnded = attendance?.status === "completed";
  const me = attendance?.startLat != null && attendance.startLng != null ? { lat: attendance.startLat, lng: attendance.startLng } : null;

  const allStops = rep?.route?.stops ?? [];
  const rows = allStops
    .filter((s) => !s.outlet.visitDay || s.outlet.visitDay === today)
    .map((s) => {
      const v = visits.filter((x) => x.outletId === s.outletId);
      const state = v.some((x) => x.status === "in_progress") ? "in_progress" : v.some((x) => x.status === "completed") ? "visited" : v.some((x) => x.status === "skipped") ? "skipped" : dayEnded ? "missed" : "planned";
      return { ...s, state, skipReason: v.find((x) => x.status === "skipped")?.skipReason, dist: me ? distanceM(me.lat, me.lng, s.outlet.lat, s.outlet.lng) : null };
    });
  if (sort === "distance" && me) rows.sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0));
  const unplanned = visits.filter((v) => v.visitType === "unplanned" && v.status !== "skipped");
  const counts = { visited: rows.filter((r) => r.state === "visited").length, skipped: rows.filter((r) => r.state === "skipped").length, planned: rows.filter((r) => r.state === "planned" || r.state === "in_progress").length, missed: rows.filter((r) => r.state === "missed").length };

  const total = rows.length;
  const doneCount = counts.visited + counts.skipped;
  const at = total ? doneCount / total : 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Today&apos;s Beat Plan</h2>
        <p className="text-xs text-slate-500">{rep?.route?.name ?? "No route assigned"} · {rows.length} stops today ({today}) · {counts.visited} visited · {counts.skipped} skipped · {counts.planned} to go{counts.missed ? ` · ${counts.missed} missed` : ""}</p>
      </div>
      <Banner error={error} notice={notice} />

      <div className="card pb-4 pt-3">
        <div className="flex items-center justify-between px-4">
          <p className="text-sm font-bold text-slate-900">{doneCount} of {total} stops done</p>
          <span className="badge badge-blue">{Math.round(at * 100)}%</span>
        </div>
        <ProgressTrack at={at} doneThrough={doneCount >= total && total > 0 ? 1 : 0} steps={[{ label: "Start of day" }, { label: "End of day" }]} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="segmented">
          <Link href="/sfa/route?view=list" aria-current={view === "list"} data-active={view === "list"}>List</Link>
          <Link href="/sfa/route?view=map" aria-current={view === "map"} data-active={view === "map"}>Map</Link>
        </div>
        <div className="segmented">
          <Link href={`/sfa/route?view=${view}&sort=sequence`} aria-current={sort === "sequence"} data-active={sort === "sequence"}>Plan order</Link>
          <Link href={`/sfa/route?view=${view}&sort=distance`} aria-current={sort === "distance"} data-active={sort === "distance"}>Nearest first</Link>
        </div>
        <Link href="/sfa/nearby" className="btn-secondary min-h-[36px] px-4 py-1.5 text-xs"><Navigation size={13} />Add unplanned visit</Link>
      </div>
      {sort === "distance" && !me && <p className="text-xs text-amber-700">Start your day to use your position for distance sorting.</p>}

      {view === "map" && <OutletMap route me={me ?? undefined} pins={rows.map((r) => ({ id: r.outletId, name: r.outlet.name, lat: r.outlet.lat, lng: r.outlet.lng, state: r.state === "visited" ? "visited" : r.state === "skipped" ? "skipped" : "planned", label: String(r.sequence) }))} />}

      <ol className="space-y-0">
        {rows.map((s, idx) => (
          <li key={s.id} className="relative flex gap-3 pb-3">
            {idx < rows.length - 1 && <span className="absolute left-[15px] top-8 h-[calc(100%-1.25rem)] w-0.5 rounded-full bg-slate-200" aria-hidden="true" />}
            <span className={`z-10 mt-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${DOT_STYLE[s.state]}`}>
              {s.state === "visited" ? <Check size={15} strokeWidth={3} /> : s.sequence}
            </span>
            <div className="card min-w-0 flex-1 p-3">
              <Link href={`/sfa/outlets/${s.outletId}`} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">{s.outlet.name}</p>
                  <p className="truncate text-xs text-slate-500">{s.outlet.subChannel}{s.dist != null ? ` · ${formatDistance(s.dist)}` : ""}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${STATE_STYLE[s.state]}`}>{s.state.replace("_", " ")}</span>
                  <ChevronRight size={16} className="text-slate-300" />
                </div>
              </Link>
              {s.state === "skipped" && <p className="mt-1.5 text-xs text-amber-700">Skipped: {s.skipReason}</p>}
              {s.state === "planned" && !dayEnded && (
                <form action={skipStop} className="mt-2 flex gap-2">
                  <input type="hidden" name="outletId" value={s.outletId} />
                  <select name="reason" className="input min-w-0 flex-1 py-1 text-xs" defaultValue="" required>
                    <option value="" disabled>Skip because…</option>
                    {SKIP_REASONS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                  <button className="btn-secondary px-4 py-1 text-xs" type="submit">Skip</button>
                </form>
              )}
            </div>
          </li>
        ))}
        {rows.length === 0 && <p className="card p-4 text-sm text-slate-400">No stops planned for today.</p>}
      </ol>

      {unplanned.length > 0 && (
        <div className="card p-4">
          <p className="text-sm font-bold text-slate-900">Unplanned visits today</p>
          <ul className="mt-1 text-xs text-slate-600">
            {unplanned.map((v) => (
              <li key={v.id}>{v.outletId.slice(-6)} — {v.status.replace("_", " ")}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
