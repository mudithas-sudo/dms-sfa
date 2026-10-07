import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import OutletMap from "@/components/OutletMap";
import { distanceM, formatDistance } from "@/lib/geo";
import { dayStart } from "@/lib/van";
import { invoiceBalance } from "@/lib/finance";
import { MapPin } from "lucide-react";

const RADII = [500, 1000, 2000, 5000, 20000];

export default async function NearbyOutletsPage({ searchParams }: { searchParams: Promise<{ radius?: string; channel?: string; filter?: string; view?: string }> }) {
  const { userId, branchId } = await getSession();
  if (!userId || !branchId) return <p className="text-sm text-slate-500">No rep selected.</p>;
  const { radius = "5000", channel = "", filter = "", view = "list" } = await searchParams;

  const [attendance, lastVisit, outlets, channels, todays] = await Promise.all([
    prisma.attendance.findFirst({ where: { userId, dayDate: { gte: dayStart() } } }),
    prisma.fieldVisit.findFirst({ where: { salespersonId: userId }, orderBy: { checkinAt: "desc" } }),
    prisma.outlet.findMany({ where: { branchId, status: "active", ...(channel ? { channelId: channel } : {}) } }),
    prisma.channel.findMany({ orderBy: { name: "asc" } }),
    prisma.fieldVisit.findMany({ where: { salespersonId: userId, checkinAt: { gte: dayStart() } }, select: { outletId: true } }),
  ]);
  const me = attendance?.startLat != null && attendance.startLng != null ? { lat: attendance.startLat, lng: attendance.startLng } : lastVisit ? { lat: lastVisit.checkinLat, lng: lastVisit.checkinLng } : { lat: 14.5995, lng: 120.9842 };
  const visited = new Set(todays.map((t) => t.outletId));
  const inv = filter === "balance" ? await prisma.invoice.findMany({ where: { outletId: { in: outlets.map((o) => o.id) }, status: { in: ["unpaid", "partially_paid", "overdue"] } }, include: { arLedgerEntries: true } }) : [];
  const owing = new Set(inv.filter((i) => invoiceBalance(i) > 0).map((i) => i.outletId));

  const list = outlets
    .map((o) => ({ ...o, d: distanceM(me.lat, me.lng, o.lat, o.lng) }))
    .filter((o) => o.d <= Number(radius))
    .filter((o) => (filter === "unvisited" ? !visited.has(o.id) : filter === "balance" ? owing.has(o.id) : true))
    .sort((a, b) => a.d - b.d)
    .slice(0, 30);
  const q = (extra: Record<string, string>) => new URLSearchParams({ radius, channel, filter, view, ...extra }).toString();

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Nearby Outlets</h2>
        <p className="text-xs text-slate-500">Distances are from {attendance?.startLat != null ? "where you started your day" : lastVisit ? "your last check-in" : "the branch"}. Tap an outlet to visit it — one outside today&apos;s route is recorded as unplanned.</p>
      </div>
      <form method="get" className="card grid grid-cols-2 gap-2 p-3">
        <input type="hidden" name="view" value={view} />
        <div>
          <label className="label">Radius</label>
          <select className="input py-1 text-xs" name="radius" defaultValue={radius}>
            {RADII.map((r) => (
              <option key={r} value={r}>{formatDistance(r)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Channel</label>
          <select className="input py-1 text-xs" name="channel" defaultValue={channel}>
            <option value="">All</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Show</label>
          <select className="input py-1 text-xs" name="filter" defaultValue={filter}>
            <option value="">All</option>
            <option value="unvisited">Not visited today</option>
            <option value="balance">With an open balance</option>
          </select>
        </div>
        <div className="flex items-end"><button className="btn-secondary w-full py-1.5 text-xs" type="submit">Apply</button></div>
      </form>
      <div className="flex gap-2 text-xs">
        <Link href={`/sfa/nearby?${q({ view: "list" })}`} className={`inline-flex min-h-[40px] items-center rounded-full px-4 ${view === "list" ? "bg-blue-600 text-white" : "bg-slate-100"}`}>List</Link>
        <Link href={`/sfa/nearby?${q({ view: "map" })}`} className={`inline-flex min-h-[40px] items-center rounded-full px-4 ${view === "map" ? "bg-blue-600 text-white" : "bg-slate-100"}`}>Map</Link>
        <span className="ml-auto text-slate-400">{list.length} found</span>
      </div>
      {view === "map" && <OutletMap me={me} pins={list.map((o, i) => ({ id: o.id, name: o.name, lat: o.lat, lng: o.lng, state: visited.has(o.id) ? "visited" : "other", label: String(i + 1) }))} />}
      <div className="card divide-y divide-slate-100 p-2">
        {list.map((o) => (
          <Link key={o.id} href={`/sfa/outlets/${o.id}`} className="flex items-center justify-between px-2 py-3">
            <div className="flex items-center gap-3">
              <MapPin size={16} className={visited.has(o.id) ? "text-emerald-500" : "text-slate-300"} />
              <div>
                <p className="text-sm font-medium text-slate-900">{o.name}</p>
                <p className="text-xs text-slate-500">{o.subChannel}{visited.has(o.id) ? " · visited today" : ""}</p>
              </div>
            </div>
            <span className="text-xs font-medium text-slate-500">{formatDistance(o.d)}</span>
          </Link>
        ))}
        {list.length === 0 && <p className="px-2 py-4 text-sm text-slate-400">No outlets match — widen the radius.</p>}
      </div>
    </div>
  );
}
