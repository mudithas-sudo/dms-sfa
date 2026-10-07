import Link from "next/link";
import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import Banner from "@/components/Banner";
import { createRoute } from "@/app/actions/admin-actions";
import { VISIT_DAYS } from "@/lib/masterdata";

export default async function RoutesPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  const [routes, territories] = await Promise.all([
    prisma.route.findMany({
      orderBy: { name: "asc" },
      include: { territory: true, reps: { select: { name: true } }, _count: { select: { stops: true } } },
    }),
    prisma.territory.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">Territory & Route Master</h2>
        <Link href="/admin/territories" className="text-sm text-blue-600 hover:underline">Manage Territories</Link>
      </div>
      <Banner error={error} notice={notice} />

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Route</th>
              <th className="th">Territory</th>
              <th className="th">Visit day · frequency</th>
              <th className="th">Beat-plan stops</th>
              <th className="th">Assigned representative</th>
              <th className="th">Status</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {routes.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="td font-medium text-slate-900">
                  {r.name} {r.code && <span className="font-mono text-xs text-slate-400">{r.code}</span>}
                </td>
                <td className="td text-slate-500">{r.territory?.name ?? "—"}</td>
                <td className="td">
                  {r.visitDay ? r.visitDay[0].toUpperCase() + r.visitDay.slice(1) : "—"} · {r.frequency}
                </td>
                <td className="td">{r._count.stops}</td>
                <td className="td">{r.reps.length ? r.reps.map((u) => u.name).join(", ") : <span className="text-amber-600">None assigned</span>}</td>
                <td className="td">
                  <StatusBadge status={r.status} />
                </td>
                <td className="td text-right">
                  <Link href={`/admin/routes/${r.id}`} className="text-blue-600 hover:underline">Edit / beat plan</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card max-w-xl p-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">New Route</h3>
        <form action={createRoute} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input className="input" name="name" placeholder="e.g. Route F" required />
            <input className="input" name="code" placeholder="Code (optional)" />
          </div>
          <select className="input" name="territoryId" defaultValue="">
            <option value="">No territory</option>
            {territories.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <select className="input" name="visitDay" defaultValue="">
              <option value="">Visit day…</option>
              {VISIT_DAYS.map((d) => (
                <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>
              ))}
            </select>
            <select className="input" name="frequency" defaultValue="weekly">
              <option value="weekly">Weekly</option>
              <option value="fortnightly">Fortnightly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <button type="submit" className="btn-primary w-full">Create</button>
        </form>
      </div>
    </div>
  );
}
