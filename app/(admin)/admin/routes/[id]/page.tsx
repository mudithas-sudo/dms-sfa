import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { addRouteStop, removeRouteStop, moveRouteStop, updateRoute, splitRoute } from "@/app/actions/admin-actions";
import Banner from "@/components/Banner";
import StatusBadge from "@/components/StatusBadge";
import { VISIT_DAYS } from "@/lib/masterdata";

export default async function RouteBeatPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { id } = await params;
  const { error, notice } = await searchParams;
  const route = await prisma.route.findUnique({ where: { id }, include: { reps: { select: { name: true } } } });
  if (!route) notFound();

  const [stops, allOutlets, territories] = await Promise.all([
    prisma.routeStop.findMany({ where: { routeId: id }, orderBy: { sequence: "asc" }, include: { outlet: { include: { route: true } } } }),
    prisma.outlet.findMany({ where: { status: "active" }, orderBy: { name: "asc" }, include: { route: true } }),
    prisma.territory.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
  ]);

  const stopOutletIds = new Set(stops.map((s) => s.outletId));
  const availableOutlets = allOutlets.filter((o) => !stopOutletIds.has(o.id));

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/admin/routes" className="hover:underline">Routes</Link>
        <span>/</span>
        <span className="text-slate-900">{route.name}</span>
      </div>
      <Banner error={error} notice={notice} />

      <div className="card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Route details</h2>
          <StatusBadge status={route.status} />
        </div>
        <form action={updateRoute} className="grid grid-cols-2 gap-3">
          <input type="hidden" name="id" value={route.id} />
          <div>
            <label className="label">Route name</label>
            <input className="input" name="name" defaultValue={route.name} required />
          </div>
          <div>
            <label className="label">Code</label>
            <input className="input" name="code" defaultValue={route.code ?? ""} />
          </div>
          <div>
            <label className="label">Territory</label>
            <select className="input" name="territoryId" defaultValue={route.territoryId ?? ""}>
              <option value="">No territory</option>
              {territories.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Assigned representative</label>
            <input className="input" readOnly value={route.reps.map((u) => u.name).join(", ") || "None — assign in Sales Personnel"} />
          </div>
          <div>
            <label className="label">Visit day</label>
            <select className="input" name="visitDay" defaultValue={route.visitDay ?? ""}>
              <option value="">—</option>
              {VISIT_DAYS.map((d) => (
                <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Frequency</label>
            <select className="input" name="frequency" defaultValue={route.frequency}>
              <option value="weekly">Weekly</option>
              <option value="fortnightly">Fortnightly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" name="status" defaultValue={route.status}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div className="flex items-end">
            <button className="btn-primary" type="submit">Save route</button>
          </div>
        </form>
        <p className="mt-2 text-xs text-slate-500">A route cannot be made inactive while outlets are still assigned to it. Changes reach representatives at the next synchronization.</p>
      </div>

      <div className="card p-6">
        <h2 className="mb-4 text-base font-semibold text-slate-900">Beat plan — {route.name}</h2>
        <ol className="space-y-2">
          {stops.map((s, i) => (
            <li key={s.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
              <div className="flex items-center gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">{s.sequence}</span>
                <div>
                  <p className="text-sm font-medium text-slate-900">{s.outlet.name}</p>
                  <p className="text-xs text-slate-500">
                    {s.outlet.code ?? ""} · {s.outlet.subChannel}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <form action={moveRouteStop}>
                  <input type="hidden" name="stopId" value={s.id} />
                  <input type="hidden" name="routeId" value={route.id} />
                  <input type="hidden" name="dir" value="up" />
                  <button type="submit" disabled={i === 0} className="text-slate-500 hover:text-slate-900 disabled:opacity-30">▲</button>
                </form>
                <form action={moveRouteStop}>
                  <input type="hidden" name="stopId" value={s.id} />
                  <input type="hidden" name="routeId" value={route.id} />
                  <input type="hidden" name="dir" value="down" />
                  <button type="submit" disabled={i === stops.length - 1} className="text-slate-500 hover:text-slate-900 disabled:opacity-30">▼</button>
                </form>
                <form action={removeRouteStop}>
                  <input type="hidden" name="stopId" value={s.id} />
                  <input type="hidden" name="routeId" value={route.id} />
                  <button type="submit" className="text-rose-600 hover:underline">Remove</button>
                </form>
              </div>
            </li>
          ))}
          {stops.length === 0 && <p className="text-sm text-slate-400">No stops in this beat plan yet.</p>}
        </ol>

        <form action={addRouteStop} className="mt-5 flex gap-2 border-t border-slate-100 pt-4">
          <input type="hidden" name="routeId" value={route.id} />
          <select name="outletId" className="input" required>
            <option value="">Add outlet to end of plan…</option>
            {availableOutlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.route ? ` (currently ${o.route.name} — will be moved)` : ""}
              </option>
            ))}
          </select>
          <button type="submit" className="btn-primary shrink-0">Add stop</button>
        </form>
      </div>

      {stops.length > 1 && (
        <div className="card p-6">
          <h3 className="mb-1 text-sm font-semibold text-slate-900">Split this route</h3>
          <p className="mb-3 text-xs text-slate-500">When a territory grows, move some outlets to a new route. Both routes keep a contiguous beat plan.</p>
          <form action={splitRoute} className="space-y-3">
            <input type="hidden" name="routeId" value={route.id} />
            <input className="input max-w-sm" name="newName" placeholder="Name of the new route" required />
            <div className="grid grid-cols-2 gap-1.5">
              {stops.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" name="outletIds" value={s.outletId} /> {s.outlet.name}
                </label>
              ))}
            </div>
            <button className="btn-secondary" type="submit">Split selected outlets into new route</button>
          </form>
        </div>
      )}
    </div>
  );
}
