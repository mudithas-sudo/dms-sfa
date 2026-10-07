import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/format";

function formatSnapshot(json: string | null) {
  if (!json) return null;
  try {
    const obj = JSON.parse(json);
    return Object.entries(obj)
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join(", ");
  } catch {
    return json;
  }
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; userId?: string; from?: string; to?: string }>;
}) {
  const { entity, userId, from, to } = await searchParams;

  const [logs, entities, users] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        ...(entity ? { entity } : {}),
        ...(userId ? { userId } : {}),
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(`${to}T23:59:59`) } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      include: { user: true },
      take: 150,
    }),
    prisma.auditLog.findMany({ distinct: ["entity"], select: { entity: true }, orderBy: { entity: "asc" } }),
    prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">Audit Log</h2>

      <form className="card flex flex-wrap gap-3 p-4" method="get">
        <select name="entity" defaultValue={entity ?? ""} className="input max-w-[180px]">
          <option value="">All Entities</option>
          {entities.map((e) => (
            <option key={e.entity} value={e.entity}>{e.entity}</option>
          ))}
        </select>
        <select name="userId" defaultValue={userId ?? ""} className="input max-w-[200px]">
          <option value="">All Users</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
        <input className="input max-w-[160px]" type="date" name="from" defaultValue={from ?? ""} />
        <input className="input max-w-[160px]" type="date" name="to" defaultValue={to ?? ""} />
        <button type="submit" className="btn-secondary">Filter</button>
        <a className="btn-secondary" href={`/api/audit/export?format=csv&entity=${entity ?? ""}&userId=${userId ?? ""}&from=${from ?? ""}&to=${to ?? ""}`}>Export CSV</a>
        <a className="btn-secondary" href={`/api/audit/export?format=excel&entity=${entity ?? ""}&userId=${userId ?? ""}&from=${from ?? ""}&to=${to ?? ""}`}>Export Excel</a>
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">When</th>
              <th className="th">User</th>
              <th className="th">Entity</th>
              <th className="th">Action</th>
              <th className="th">Summary</th>
              <th className="th">Before → After</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logs.map((l) => {
              const before = formatSnapshot(l.beforeData);
              const after = formatSnapshot(l.afterData);
              return (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="td whitespace-nowrap text-xs text-slate-500">{formatDateTime(l.createdAt)}</td>
                  <td className="td">{l.user.name}</td>
                  <td className="td">{l.entity}</td>
                  <td className="td capitalize">{l.action}</td>
                  <td className="td">{l.summary}</td>
                  <td className="td text-xs text-slate-500">
                    {before || after ? (
                      <span>
                        {before && <span className="text-rose-600">{before}</span>}
                        {before && after && " → "}
                        {after && <span className="text-emerald-600">{after}</span>}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
            {logs.length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={6}>No audit activity matches these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
