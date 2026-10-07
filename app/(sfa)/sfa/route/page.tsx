import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import OutletMap from "@/components/OutletMap";
import { distanceM, formatDistance } from "@/lib/geo";
import { dayStart } from "@/lib/van";
import { SKIP_REASONS } from "@/lib/field-constants";
import { skipStop } from "@/app/actions/sfa-field-actions";
import { ChevronRight } from "lucide-react";

const WEEKDAY = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const STATE_STYLE: Record<string, string> = {
  visited: "bg-emerald-100 text-emerald-700",
  in_progress: "bg-blue-100 text-blue-700",
  skipped: "bg-amber-100 text-amber-800",
  missed: "bg-rose-100 text-rose-700",
  planned: "bg-slate-100 text-slate-500",
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

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Today&apos;s Beat Plan</h2>
        <p className="text-xs text-slate-500">{rep?.route?.name ?? "No route assigned"} · {rows.length} stops today ({today}) · {counts.visited} visited · {counts.skipped} skipped · {counts.planned} to go{counts.missed ? ` · ${counts.missed} missed` : ""}</p>
      </div>
      <Banner error={error} notice={notice} />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Link href="/sfa/route?view=list" className={`rounded-full px-3 py-1 ${view === "list" ? "bg-blue-600 text-white" : "bg-slate-100"}`}>List</Link>
        <Link href="/sfa/route?view=map" className={`rounded-full px-3 py-1 ${view === "map" ? "bg-blue-600 text-white" : "bg-slate-100"}`}>Map</Link>
        <span className="text-slate-300">|</span>
        <Link href={`/sfa/route?view=${view}&sort=sequence`} className={sort === "sequence" ? "font-semibold text-blue-600" : "text-slate-500"}>Plan order</Link>
        <Link href={`/sfa/route?view=${view}&sort=distance`} className={sort === "distance" ? "font-semibold text-blue-600" : "text-slate-500"}>Nearest first</Link>
        <Link href="/sfa/nearby" className="ml-auto text-blue-600 underline">Add unplanned visit</Link>
      </div>
      {sort === "distance" && !me && <p className="text-[11px] text-amber-700">Start your day to use your position for distance sorting.</p>}

      {view === "map" && <OutletMap me={me ?? undefined} pins={rows.map((r) => ({ id: r.outletId, name: r.outlet.name, lat: r.outlet.lat, lng: r.outlet.lng, state: r.state === "visited" ? "visited" : r.state === "skipped" ? "skipped" : "planned", label: String(r.sequence) }))} />}

      <div className="card divide-y divide-slate-100 p-2">
        {rows.map((s) => (
          <div key={s.id} className="px-2 py-2.5">
            <Link href={`/sfa/outlets/${s.outletId}`} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${STATE_STYLE[s.state]}`}>{s.sequence}</span>
                <div>
                  <p className="text-sm font-medium text-slate-900">{s.outlet.name}</p>
                  <p className="text-xs text-slate-500">{s.outlet.subChannel}{s.dist != null ? ` · ${formatDistance(s.dist)}` : ""}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${STATE_STYLE[s.state]}`}>{s.state.replace("_", " ")}</span>
                <ChevronRight size={16} className="text-slate-300" />
              </div>
            </Link>
            {s.state === "skipped" && <p className="ml-9 mt-0.5 text-[11px] text-amber-700">Skipped: {s.skipReason}</p>}
            {s.state === "planned" && !dayEnded && (
              <form action={skipStop} className="ml-9 mt-1 flex gap-1">
                <input type="hidden" name="outletId" value={s.outletId} />
                <select name="reason" className="input w-40 py-0.5 text-[11px]" defaultValue="" required>
                  <option value="" disabled>Skip because…</option>
                  {SKIP_REASONS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
                <button className="text-[11px] text-slate-500 underline" type="submit">Skip</button>
              </form>
            )}
          </div>
        ))}
        {rows.length === 0 && <p className="px-2 py-4 text-sm text-slate-400">No stops planned for today.</p>}
      </div>

      {unplanned.length > 0 && (
        <div className="card p-3">
          <p className="text-xs font-semibold text-slate-900">Unplanned visits today</p>
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
