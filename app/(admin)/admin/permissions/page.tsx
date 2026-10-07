import { prisma } from "@/lib/prisma";
import Banner from "@/components/Banner";
import { savePermissions } from "@/app/actions/platform-actions";
import { DEFAULT_MATRIX, GROUP_ACCESS, LEVELS, PERMISSION_MODULES, type Level } from "@/lib/rbac";
import { ROLES, type RoleId } from "@/lib/constants";

const LEVEL_LABEL: Record<Level, string> = { none: "No access", view: "View", edit: "View + edit", approve: "Edit + approve" };

export default async function PermissionsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  const rows = await prisma.rolePermission.findMany();
  const level = (role: RoleId, module: string): Level =>
    (rows.find((r) => r.role === role && r.module === module)?.level as Level | undefined) ?? DEFAULT_MATRIX[role][module as keyof (typeof DEFAULT_MATRIX)["admin"]];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Roles & Permissions</h2>
        <p className="mt-1 text-sm text-slate-500">
          One permission system for the DMS and the SFA app. Access is granted to roles — never to individual users — and checked on the server for every action,
          so hiding a button is never the only control. Sensitive capabilities (approve, post, reverse, export) are separate levels so the person who raises a
          transaction need not be the one who approves it. Changes apply on the next request, without redeployment, and are audited.
        </p>
      </div>
      <Banner error={error} notice={notice} />

      <form action={savePermissions} className="space-y-3">
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Module</th>
                {ROLES.map((r) => (
                  <th key={r.id} className="th">{r.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {PERMISSION_MODULES.map((m) => (
                <tr key={m.id}>
                  <td className="td font-medium text-slate-900">{m.label}</td>
                  {ROLES.map((r) => (
                    <td key={r.id} className="td">
                      {r.id === "admin" ? (
                        <span className="text-xs text-slate-400">{LEVEL_LABEL[level("admin", m.id)]} (fixed)</span>
                      ) : (
                        <select name={`${r.id}__${m.id}`} defaultValue={level(r.id, m.id)} className="input py-1 text-xs">
                          {LEVELS.map((l) => (
                            <option key={l} value={l}>{LEVEL_LABEL[l]}</option>
                          ))}
                        </select>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn-primary" type="submit">Save permission matrix</button>
      </form>

      <div className="card p-5">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Application areas each role can open</h3>
        <ul className="space-y-1 text-sm text-slate-700">
          {Object.entries(GROUP_ACCESS).map(([group, roles]) => (
            <li key={group}>
              <span className="font-medium capitalize">{group === "sfa" ? "Field sales (mobile)" : group}</span>:{" "}
              {roles.map((r) => ROLES.find((x) => x.id === r)?.label).join(", ")}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-500">Branch roles see only their own branch; a multi-branch user (regional manager) is given several branches without becoming head office.</p>
      </div>
    </div>
  );
}
