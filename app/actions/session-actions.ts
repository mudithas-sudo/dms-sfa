"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { ROLES, ROLE_COOKIE, BRANCH_COOKIE, USER_COOKIE, type RoleId } from "@/lib/constants";

const COOKIE_OPTS = { path: "/", maxAge: 60 * 60 * 24 * 30 };

// One-click switch used by the "Start here" page: become this person and open this screen.
export async function switchPersona(formData: FormData) {
  const role = String(formData.get("role") ?? "") as RoleId;
  const roleDef = ROLES.find((r) => r.id === role);
  if (!roleDef) redirect("/start");
  const user = await prisma.user.findUnique({ where: { id: String(formData.get("userId") ?? "") } });
  const next = String(formData.get("next") ?? "");
  const store = await cookies();
  store.set(ROLE_COOKIE, role, COOKIE_OPTS);
  if (user) {
    store.set(USER_COOKIE, user.id, COOKIE_OPTS);
    if (user.branchId) store.set(BRANCH_COOKIE, user.branchId, COOKIE_OPTS);
    await logAudit("Security", user.id, "signin", `${user.name} signed in as ${roleDef.label}`, undefined, { userId: user.id, branchId: user.branchId });
  }
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : roleDef.homePath);
}
