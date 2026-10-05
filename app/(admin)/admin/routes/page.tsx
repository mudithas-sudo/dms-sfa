import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createRoute } from "@/app/actions/admin-actions";

export default async function RoutesPage() {
  const [routes, territories] = await Promise.all([
    prisma.route.findMany({
      orderBy: { name: "asc" },
      include: { territory: true, _count: { select: { stops: true, reps: true } } },
    }),
    prisma.territory.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">Territory & Route Master</h2>
        <Link href="/admin/territories" className="text-sm text-blue-600 hover:underline">Manage Territories</Link>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Route</th>
              <th className="th">Territory</th>
              <th className="th">Beat-Plan Stops</th>
              <th className="th">Assigned Reps</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {routes.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="td font-medium text-slate-900">{r.name}</td>
                <td className="td text-slate-500">{r.territory?.name ?? "—"}</td>
                <td className="td">{r._count.stops}</td>
                <td className="td">{r._count.reps}</td>
                <td className="td text-right">
                  <Link href={`/admin/routes/${r.id}`} className="text-blue-600 hover:underline">Edit Beat Plan</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card max-w-md p-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">New Route</h3>
        <form action={createRoute} className="space-y-3">
          <input className="input" name="name" placeholder="e.g. Route F" required />
          <select className="input" name="territoryId" defaultValue="">
            <option value="">No territory</option>
            {territories.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button type="submit" className="btn-primary w-full">Create</button>
        </form>
      </div>
    </div>
  );
}
