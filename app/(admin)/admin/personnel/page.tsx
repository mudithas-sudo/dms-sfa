import { prisma } from "@/lib/prisma";
import { roleLabel } from "@/lib/constants";
import StatusBadge from "@/components/StatusBadge";
import Banner from "@/components/Banner";
import { updatePersonnel, createPersonnel } from "@/app/actions/admin-actions";

export default async function PersonnelPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  const [users, routes, branches, vans] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: ["branch_ops", "supervisor", "sales_rep"] } },
      orderBy: [{ branchId: "asc" }, { role: "asc" }, { name: "asc" }],
      include: { branch: true, route: true, supervisor: true },
    }),
    prisma.route.findMany({ orderBy: { name: "asc" } }),
    prisma.branch.findMany({ orderBy: { name: "asc" } }),
    prisma.van.findMany({ select: { code: true, assignedUserId: true } }),
  ]);
  const vanOf = new Map(vans.filter((v) => v.assignedUserId).map((v) => [v.assignedUserId as string, v.code]));

  const supervisors = users.filter((u) => u.role === "supervisor");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Sales Personnel Master</h2>
        <p className="mt-1 text-xs text-slate-500">
          Every sales representative is linked to a branch and a reporting supervisor. Reassignments take effect on the representative&apos;s device at the next
          synchronization and are recorded in the change history. People are deactivated, never deleted; a person with open van stock or uncollected cash cannot be deactivated.
        </p>
      </div>
      <Banner error={error} notice={notice} />

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Code</th>
              <th className="th">Name</th>
              <th className="th">Role</th>
              <th className="th">Branch</th>
              <th className="th">Route</th>
              <th className="th">Supervisor</th>
              <th className="th">Van</th>
              <th className="th">Status</th>
              <th className="th">Edit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => {
              const branchSupervisors = supervisors.filter((s) => s.branchId === u.branchId);
              return (
                <tr key={u.id} className={u.active ? "" : "bg-slate-50 text-slate-400"}>
                  <td className="td font-mono text-xs">{u.employeeCode ?? "—"}</td>
                  <td className="td font-medium text-slate-900">
                    {u.name}
                    <div className="text-xs font-normal text-slate-400">{u.phone ?? ""} {u.email ?? ""}</div>
                  </td>
                  <td className="td">{roleLabel(u.role)}</td>
                  <td className="td">{u.branch?.name ?? "—"}</td>
                  <td className="td">{u.route?.name ?? "—"}</td>
                  <td className="td">{u.supervisor?.name ?? "—"}</td>
                  <td className="td">{vanOf.get(u.id) ?? "—"}</td>
                  <td className="td">
                    <StatusBadge status={u.active ? "active" : "inactive"} />
                  </td>
                  <td className="td">
                    <details>
                      <summary className="cursor-pointer text-xs text-blue-600">Edit</summary>
                      <form action={updatePersonnel} className="mt-2 grid w-72 gap-1.5">
                        <input type="hidden" name="userId" value={u.id} />
                        <input className="input py-1 text-xs" name="employeeCode" defaultValue={u.employeeCode ?? ""} placeholder="Employee code" />
                        <input className="input py-1 text-xs" name="phone" defaultValue={u.phone ?? ""} placeholder="Mobile" />
                        <input className="input py-1 text-xs" name="email" defaultValue={u.email ?? ""} placeholder="Email" />
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
                        <select name="active" defaultValue={u.active ? "active" : "inactive"} className="input py-1 text-xs">
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                        <input className="input py-1 text-xs" name="effectiveFrom" type="date" title="Effective from (for a status change)" />
                        <button type="submit" className="btn-secondary px-2 py-1 text-xs">Save</button>
                      </form>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card max-w-lg p-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">New Personnel</h3>
        <form action={createPersonnel} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input className="input" name="name" placeholder="Full name" required />
            <input className="input" name="employeeCode" placeholder="Employee code (unique)" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input className="input" name="phone" placeholder="Mobile number" />
            <input className="input" name="email" type="email" placeholder="Email" />
          </div>
          <select className="input" name="role" defaultValue="sales_rep">
            <option value="branch_ops">Branch / Warehouse Operations</option>
            <option value="supervisor">Sales & Finance Supervisor</option>
            <option value="sales_rep">Field Sales Representative</option>
          </select>
          <div className="grid grid-cols-2 gap-3">
            <select className="input" name="branchId" defaultValue="">
              <option value="">No branch yet</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <select className="input" name="supervisorId" defaultValue="">
              <option value="">Supervisor (required for reps)</option>
              {supervisors.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <select className="input" name="routeId" defaultValue="">
            <option value="">No route</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <button type="submit" className="btn-primary w-full">Create</button>
        </form>
      </div>
    </div>
  );
}
