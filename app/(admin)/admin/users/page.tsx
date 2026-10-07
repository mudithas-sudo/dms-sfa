import { prisma } from "@/lib/prisma";
import Banner from "@/components/Banner";
import StatusBadge from "@/components/StatusBadge";
import { createUserAccount, updateUserAccount, bulkCreateUsers, resetMfa } from "@/app/actions/platform-actions";
import { getAllSettings } from "@/lib/settings";
import { ROLES, roleLabel } from "@/lib/constants";

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  const [users, branches, settings] = await Promise.all([
    prisma.user.findMany({ orderBy: [{ role: "asc" }, { name: "asc" }], include: { branch: true } }),
    prisma.branch.findMany({ orderBy: { name: "asc" } }),
    getAllSettings(),
  ]);
  const privileged = settings["mfa.privilegedRoles"].split(",");
  const branchName = new Map(branches.map((b) => [b.id, b.name]));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">User & Role Management</h2>
        <p className="mt-1 text-xs text-slate-500">
          Create accounts individually or in bulk, assign a role and the branch (or branches) each user&apos;s access covers. A role change takes effect at the user&apos;s next
          sign-in and is recorded in the change history. Privileged roles must enrol in multi-factor authentication.
        </p>
      </div>
      <Banner error={error} notice={notice} />

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">User</th>
              <th className="th">Role</th>
              <th className="th">Branch scope</th>
              <th className="th">MFA</th>
              <th className="th">Status</th>
              <th className="th">Edit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => {
              const extra = (u.branchScope ?? "").split(",").filter(Boolean).map((id) => branchName.get(id)).filter(Boolean);
              const needsMfa = privileged.includes(u.role);
              return (
                <tr key={u.id} className={u.active ? "" : "bg-slate-50 text-slate-400"}>
                  <td className="td font-medium text-slate-900">
                    {u.name}
                    <div className="text-xs font-normal text-slate-400">{u.email ?? u.employeeCode ?? ""}</div>
                  </td>
                  <td className="td">{roleLabel(u.role)}</td>
                  <td className="td text-xs">
                    {u.role === "admin" || u.role === "management" ? "All branches (head office)" : [u.branch?.name, ...extra].filter(Boolean).join(", ") || "—"}
                    {extra.length > 0 && <span className="ml-1 rounded bg-blue-50 px-1 text-blue-700">multi-branch</span>}
                  </td>
                  <td className="td text-xs">
                    {needsMfa ? (
                      u.mfaEnrolled ? (
                        <span className="text-emerald-700">Enrolled</span>
                      ) : (
                        <span className="font-medium text-amber-700">Required — not enrolled</span>
                      )
                    ) : (
                      <span className="text-slate-400">Not required</span>
                    )}
                    {needsMfa && u.mfaEnrolled && (
                      <form action={resetMfa} className="inline">
                        <input type="hidden" name="id" value={u.id} />
                        <button className="ml-2 text-blue-600 hover:underline" type="submit">Reset</button>
                      </form>
                    )}
                  </td>
                  <td className="td">
                    <StatusBadge status={u.active ? "active" : "inactive"} />
                  </td>
                  <td className="td">
                    <details>
                      <summary className="cursor-pointer text-xs text-blue-600">Edit</summary>
                      <form action={updateUserAccount} className="mt-2 grid w-64 gap-1.5">
                        <input type="hidden" name="id" value={u.id} />
                        <select name="role" defaultValue={u.role} className="input py-1 text-xs">
                          {ROLES.map((r) => (
                            <option key={r.id} value={r.id}>{r.label}</option>
                          ))}
                        </select>
                        <select name="branchId" defaultValue={u.branchId ?? ""} className="input py-1 text-xs">
                          <option value="">No primary branch</option>
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                        </select>
                        <fieldset className="rounded border border-slate-200 p-1.5">
                          <legend className="px-1 text-[10px] text-slate-500">Additional branches (regional manager)</legend>
                          {branches.map((b) => (
                            <label key={b.id} className="flex items-center gap-1 text-xs">
                              <input type="checkbox" name="branchScope" value={b.id} defaultChecked={(u.branchScope ?? "").split(",").includes(b.id)} /> {b.name}
                            </label>
                          ))}
                        </fieldset>
                        <select name="active" defaultValue={u.active ? "active" : "inactive"} className="input py-1 text-xs">
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                        <button className="btn-secondary px-2 py-1 text-xs" type="submit">Save</button>
                      </form>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">New user</h3>
          <form action={createUserAccount} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input className="input" name="name" placeholder="Full name" required />
              <input className="input" name="employeeCode" placeholder="Employee code" />
            </div>
            <input className="input" name="email" type="email" placeholder="Email (corporate identity)" />
            <div className="grid grid-cols-2 gap-3">
              <select className="input" name="role" defaultValue="branch_ops">
                {ROLES.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
              <select className="input" name="branchId" defaultValue="">
                <option value="">Branch (not for head office)</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <button className="btn-primary" type="submit">Create user</button>
          </form>
        </div>
        <div className="card p-5">
          <h3 className="mb-1 text-sm font-semibold text-slate-900">Bulk create</h3>
          <p className="mb-2 text-xs text-slate-500">One user per line: name, role, branch code, email, employee code. Roles: admin, branch_ops, supervisor, sales_rep, management.</p>
          <form action={bulkCreateUsers} className="space-y-3">
            <textarea className="input font-mono text-xs" name="csv" rows={4} placeholder={"Ana Cruz, sales_rep, MNL-01, ana@fnb.ph, E-1042\nBen Lim, branch_ops, CEB-01, ben@fnb.ph, E-1043"} />
            <button className="btn-secondary" type="submit">Create users</button>
          </form>
        </div>
      </div>
    </div>
  );
}
