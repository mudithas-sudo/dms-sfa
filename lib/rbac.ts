import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import type { RoleId } from "@/lib/constants";

// One permission system for the DMS and the SFA application. Access is granted to
// roles (never to individual users). Levels are cumulative: view < edit < approve.

export const LEVELS = ["none", "view", "edit", "approve"] as const;
export type Level = (typeof LEVELS)[number];

export const PERMISSION_MODULES = [
  { id: "master_data", label: "Master data" },
  { id: "purchasing", label: "Purchasing & receiving" },
  { id: "inventory", label: "Warehouse inventory" },
  { id: "sales", label: "Sales & order processing" },
  { id: "van", label: "Van inventory" },
  { id: "promotions", label: "Promotions & claims" },
  { id: "finance", label: "Finance & receivables" },
  { id: "reports", label: "Dashboards & reports" },
  { id: "export", label: "Report export" },
  { id: "users", label: "User & role management" },
] as const;

export type ModuleId = (typeof PERMISSION_MODULES)[number]["id"];

export const DEFAULT_MATRIX: Record<RoleId, Record<ModuleId, Level>> = {
  admin: { master_data: "approve", purchasing: "approve", inventory: "approve", sales: "approve", van: "approve", promotions: "approve", finance: "approve", reports: "approve", export: "approve", users: "approve" },
  branch_ops: { master_data: "view", purchasing: "approve", inventory: "approve", sales: "view", van: "approve", promotions: "none", finance: "none", reports: "view", export: "edit", users: "none" },
  supervisor: { master_data: "view", purchasing: "view", inventory: "approve", sales: "approve", van: "approve", promotions: "approve", finance: "approve", reports: "view", export: "edit", users: "none" },
  sales_rep: { master_data: "view", purchasing: "none", inventory: "none", sales: "edit", van: "edit", promotions: "view", finance: "edit", reports: "view", export: "none", users: "none" },
  management: { master_data: "view", purchasing: "view", inventory: "view", sales: "view", van: "view", promotions: "view", finance: "view", reports: "view", export: "edit", users: "none" },
};

// Which application areas a role may open. Head office administrators can open everything.
export const GROUP_ACCESS: Record<string, RoleId[]> = {
  admin: ["admin"],
  branch: ["admin", "branch_ops", "supervisor"],
  supervisor: ["admin", "supervisor"],
  sfa: ["admin", "supervisor", "sales_rep"],
  management: ["admin", "management"],
};

export function groupAllowed(role: string, group: keyof typeof GROUP_ACCESS): boolean {
  return GROUP_ACCESS[group].includes(role as RoleId);
}

function rank(l: Level) {
  return LEVELS.indexOf(l);
}

export async function permissionFor(role: string, module: ModuleId): Promise<Level> {
  const row = await prisma.rolePermission.findUnique({ where: { role_module: { role, module } } });
  if (row) return row.level as Level;
  return DEFAULT_MATRIX[role as RoleId]?.[module] ?? "none";
}

export async function can(module: ModuleId, level: Level): Promise<boolean> {
  const { role } = await getSession();
  return rank(await permissionFor(role, module)) >= rank(level);
}

// Server-side check used by actions: hiding a button is never the only control.
export async function assertCan(module: ModuleId, level: Level) {
  if (!(await can(module, level))) redirect(`/forbidden?module=${module}&need=${level}`);
}
