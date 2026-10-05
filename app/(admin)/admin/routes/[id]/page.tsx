import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { addRouteStop, removeRouteStop } from "@/app/actions/admin-actions";

export default async function RouteBeatPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const route = await prisma.route.findUnique({ where: { id } });
  if (!route) notFound();

  const [stops, allOutlets] = await Promise.all([
    prisma.routeStop.findMany({ where: { routeId: id }, orderBy: { sequence: "asc" }, include: { outlet: true } }),
    prisma.outlet.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
  ]);

  const stopOutletIds = new Set(stops.map((s) => s.outletId));
  const availableOutlets = allOutlets.filter((o) => !stopOutletIds.has(o.id));

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/admin/routes" className="hover:underline">Routes</Link>
        <span>/</span>
        <span className="text-slate-900">{route.name}</span>
      </div>

      <div className="card p-6">
        <h2 className="mb-4 text-base font-semibold text-slate-900">Beat Plan — {route.name}</h2>
        <ol className="space-y-2">
          {stops.map((s) => (
            <li key={s.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
              <div className="flex items-center gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">
                  {s.sequence}
                </span>
                <div>
                  <p className="text-sm font-medium text-slate-900">{s.outlet.name}</p>
                  <p className="text-xs text-slate-500">{s.outlet.subChannel}</p>
                </div>
              </div>
              <form action={removeRouteStop}>
                <input type="hidden" name="stopId" value={s.id} />
                <input type="hidden" name="routeId" value={route.id} />
                <button type="submit" className="text-xs text-rose-600 hover:underline">Remove</button>
              </form>
            </li>
          ))}
          {stops.length === 0 && <p className="text-sm text-slate-400">No stops in this beat plan yet.</p>}
        </ol>

        <form action={addRouteStop} className="mt-5 flex gap-2 border-t border-slate-100 pt-4">
          <input type="hidden" name="routeId" value={route.id} />
          <select name="outletId" className="input" required>
            <option value="">Add outlet to end of plan…</option>
            {availableOutlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <button type="submit" className="btn-primary shrink-0">Add Stop</button>
        </form>
      </div>
    </div>
  );
}
