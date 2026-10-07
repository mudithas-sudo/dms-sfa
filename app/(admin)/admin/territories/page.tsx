import Link from "next/link";
import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import Banner from "@/components/Banner";
import { createTerritory, updateTerritory } from "@/app/actions/admin-actions";

export default async function TerritoriesPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  const territories = await prisma.territory.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { routes: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Link href="/admin/routes" className="hover:underline">Territory & Route Master</Link>
        <span>/</span>
        <span className="text-slate-900">Territories</span>
      </div>
      <h2 className="text-base font-semibold text-slate-900">Territories</h2>
      <p className="text-sm text-slate-500">A territory is a geographic or organizational grouping of outlets. Routes are set up within a territory.</p>
      <Banner error={error} notice={notice} />

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Name</th>
              <th className="th">Code</th>
              <th className="th">Routes</th>
              <th className="th">Status</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {territories.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50">
                <td className="td font-medium text-slate-900">{t.name}</td>
                <td className="td text-xs text-slate-500">{t.code ?? "—"}</td>
                <td className="td">{t._count.routes}</td>
                <td className="td">
                  <StatusBadge status={t.status} />
                </td>
                <td className="td text-right">
                  <form action={updateTerritory} className="inline-flex items-center gap-2">
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="name" value={t.name} />
                    <input type="hidden" name="status" value={t.status === "active" ? "inactive" : "active"} />
                    <button type="submit" className="text-xs text-blue-600 hover:underline">
                      {t.status === "active" ? "Deactivate" : "Activate"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {territories.length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={5}>No territories yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card max-w-md p-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">New Territory</h3>
        <form action={createTerritory} className="space-y-3">
          <input className="input" name="name" placeholder="e.g. North Luzon" required />
          <input className="input" name="code" placeholder="e.g. NLZ (optional, unique)" />
          <button type="submit" className="btn-primary w-full">Create</button>
        </form>
      </div>
    </div>
  );
}
