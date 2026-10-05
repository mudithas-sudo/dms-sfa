import { prisma } from "@/lib/prisma";
import { roleLabel } from "@/lib/constants";
import { updatePersonnelAssignment, createPersonnel } from "@/app/actions/admin-actions";

export default async function PersonnelPage() {
  const [users, routes, branches] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: ["branch_ops", "supervisor", "sales_rep"] } },
      orderBy: [{ branchId: "asc" }, { role: "asc" }, { name: "asc" }],
      include: { branch: true, route: true, supervisor: true },
    }),
    prisma.route.findMany({ orderBy: { name: "asc" } }),
    prisma.branch.findMany({ orderBy: { name: "asc" } }),
  ]);

  const supervisorsByBranch = new Map<string, typeof users>();
  for (const u of users) {
    if (u.role !== "supervisor" || !u.branchId) continue;
    supervisorsByBranch.set(u.branchId, [...(supervisorsByBranch.get(u.branchId) ?? []), u]);
  }

  return (
    <div className="space-y-6">
      <h2 className="text-base font-semibold text-slate-900">Sales Personnel Master</h2>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Name</th>
              <th className="th">Role</th>
              <th className="th">Branch</th>
              <th className="th">Route</th>
              <th className="th">Supervisor</th>
              <th className="th">Reassign</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => {
              const branchSupervisors = u.branchId ? (supervisorsByBranch.get(u.branchId) ?? []) : [];
              return (
                <tr key={u.id}>
                  <td className="td font-medium text-slate-900">{u.name}</td>
                  <td className="td">{roleLabel(u.role)}</td>
                  <td className="td">{u.branch?.name ?? "—"}</td>
                  <td className="td">{u.route?.name ?? "—"}</td>
                  <td className="td">{u.supervisor?.name ?? "—"}</td>
                  <td className="td">
                    <form action={updatePersonnelAssignment} className="flex flex-wrap gap-1.5">
                      <input type="hidden" name="userId" value={u.id} />
                      <select name="branchId" defaultValue={u.branchId ?? ""} className="input py-1 text-xs">
                        <option value="">No branch</option>
                        {branches.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                      {u.role === "sales_rep" && (
                        <select name="routeId" defaultValue={u.routeId ?? ""} className="input py-1 text-xs">
                          <option value="">No route</option>
                          {routes.map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      )}
                      {u.role !== "supervisor" && (
                        <select name="supervisorId" defaultValue={u.supervisorId ?? ""} className="input py-1 text-xs">
                          <option value="">No supervisor</option>
                          {branchSupervisors.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      )}
                      <button type="submit" className="btn-secondary px-2 py-1 text-xs">Save</button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card max-w-md p-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">New Personnel</h3>
        <form action={createPersonnel} className="space-y-3">
          <input className="input" name="name" placeholder="Full name" required />
          <select className="input" name="role" defaultValue="sales_rep">
            <option value="branch_ops">Branch / Warehouse Operations</option>
            <option value="supervisor">Sales & Finance Supervisor</option>
            <option value="sales_rep">Field Sales Representative</option>
          </select>
          <select className="input" name="branchId" defaultValue="">
            <option value="">No branch yet</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <button type="submit" className="btn-primary w-full">Create</button>
        </form>
      </div>
    </div>
  );
}
