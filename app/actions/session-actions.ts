"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { validateBranchId } from "@/lib/session";
import { ROLES, ROLE_COOKIE, BRANCH_COOKIE, USER_COOKIE, type RoleId } from "@/lib/constants";

const COOKIE_OPTS = { path: "/", maxAge: 60 * 60 * 24 * 30 };
const GLOBAL_ROLES: RoleId[] = ["admin", "management"];

async function pickDefaultUser(role: RoleId, branchId: string | null) {
  const isGlobal = GLOBAL_ROLES.includes(role);
  return prisma.user.findFirst({
    where: { role, branchId: isGlobal ? null : branchId },
    orderBy: { name: "asc" },
  });
}

export async function setRole(role: RoleId) {
  const store = await cookies();
  const roleDef = ROLES.find((r) => r.id === role);
  if (!roleDef) return;
  const isGlobal = GLOBAL_ROLES.includes(role);

  let branchId = await validateBranchId(store.get(BRANCH_COOKIE)?.value || null);
  if (!branchId && !isGlobal) {
    const firstBranch = await prisma.branch.findFirst({ orderBy: { name: "asc" } });
    branchId = firstBranch?.id ?? null;
  }

  const user = await pickDefaultUser(role, branchId);
  const resolvedBranch = isGlobal ? branchId : (user?.branchId ?? branchId);

  store.set(ROLE_COOKIE, role, COOKIE_OPTS);
  if (resolvedBranch) store.set(BRANCH_COOKIE, resolvedBranch, COOKIE_OPTS);
  if (user) store.set(USER_COOKIE, user.id, COOKIE_OPTS);

  redirect(roleDef.homePath);
}

export async function setBranch(branchId: string) {
  const store = await cookies();
  const role = (store.get(ROLE_COOKIE)?.value as RoleId) || "admin";
  const roleDef = ROLES.find((r) => r.id === role)!;

  const user = await pickDefaultUser(role, branchId);

  store.set(BRANCH_COOKIE, branchId, COOKIE_OPTS);
  if (user) store.set(USER_COOKIE, user.id, COOKIE_OPTS);

  redirect(roleDef.homePath);
}

export async function setUser(userId: string) {
  const store = await cookies();
  const role = (store.get(ROLE_COOKIE)?.value as RoleId) || "admin";
  const roleDef = ROLES.find((r) => r.id === role)!;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;

  store.set(USER_COOKIE, user.id, COOKIE_OPTS);
  if (user.branchId) store.set(BRANCH_COOKIE, user.branchId, COOKIE_OPTS);

  redirect(roleDef.homePath);
}
