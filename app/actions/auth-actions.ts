"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { getSetting } from "@/lib/settings";
import { ROLES, ROLE_COOKIE, BRANCH_COOKIE, USER_COOKIE, type RoleId } from "@/lib/constants";

const COOKIE_OPTS = { path: "/", maxAge: 60 * 60 * 24 * 30 };
// Prototype sign-in: every demo account shares one password (a "demo.password" app setting overrides it).
const DEMO_PASSWORD_FALLBACK = "demo1234";

function back(message: string, email: string, next: string): never {
  const q = new URLSearchParams({ error: message, email, ...(next ? { next } : {}) });
  redirect(`/login?${q.toString()}`);
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");
  if (!email || !password) back("Enter your email and password.", email, next);

  const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  const expected = (await getSetting("demo.password")) || DEMO_PASSWORD_FALLBACK;
  if (!user || password !== expected) back("That email and password do not match a demo account.", email, next);
  if (!user.active) back("This account is inactive. Ask an administrator to reactivate it.", email, next);

  const roleDef = ROLES.find((r) => r.id === (user.role as RoleId));
  if (!roleDef) back("This account has no role in the platform.", email, next);

  const store = await cookies();
  store.set(ROLE_COOKIE, user.role, COOKIE_OPTS);
  store.set(USER_COOKIE, user.id, COOKIE_OPTS);
  if (user.branchId) store.set(BRANCH_COOKIE, user.branchId, COOKIE_OPTS);
  else store.delete(BRANCH_COOKIE);
  await logAudit("Security", user.id, "signin", `${user.name} signed in with email as ${roleDef.label}`, undefined, { userId: user.id, branchId: user.branchId });

  // go back to the screen that asked for sign-in, if it belongs to this person's area
  const area = roleDef.homePath.split("/")[1];
  redirect(next.startsWith(`/${area}`) || (next.startsWith("/branch") && user.role === "supervisor") ? next : roleDef.homePath);
}

export async function signOut() {
  const store = await cookies();
  for (const name of [ROLE_COOKIE, USER_COOKIE, BRANCH_COOKIE]) store.delete(name);
  redirect("/login");
}
