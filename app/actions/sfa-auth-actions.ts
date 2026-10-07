"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { ROLE_COOKIE, BRANCH_COOKIE, USER_COOKIE } from "@/lib/constants";

const COOKIE_OPTS = { path: "/", maxAge: 60 * 60 * 24 * 30 };
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

function go(path: string, kind: "error" | "notice", message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
}

// Simulated secure sign-in for the field app: the device must be registered and approved for this user, the PIN
// must match, and repeated wrong PINs lock the account for a while. (The demo PIN comes from the setting
// "sfa.demoPin"; a real deployment authenticates through the company identity provider.)
export async function pinSignIn(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  const pin = String(formData.get("pin") ?? "").trim();
  const back = "/sfa/login";
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== "sales_rep") go(back, "error", "Choose a representative.");
  if (!user.active) go(back, "error", "This account is inactive. Contact your supervisor.");
  if (user.lockedUntil && user.lockedUntil > new Date()) go(back, "error", `Too many wrong PINs — the account is locked until ${user.lockedUntil.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}. A supervisor can unlock it.`);

  const device = await prisma.deviceRegistration.findUnique({ where: { userId } });
  if (!device || device.status !== "approved") {
    await logAudit("Security", userId, "signin_blocked", `${user.name}: sign-in refused — device ${device ? device.status : "not registered"}`, undefined, { userId });
    go(back, "error", device ? `This device is ${device.status}. Ask an administrator to approve it.` : "This device is not registered to you. Ask an administrator to register it.");
  }
  const setting = await prisma.appSetting.findUnique({ where: { key: "sfa.demoPin" } });
  const expected = setting?.value ?? "1234";
  if (pin !== expected) {
    const failures = user.pinFailures + 1;
    const lock = failures >= MAX_FAILURES;
    await prisma.user.update({ where: { id: userId }, data: { pinFailures: lock ? 0 : failures, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60000) : null } });
    await logAudit("Security", userId, "signin_failed", `${user.name}: wrong PIN (${failures}/${MAX_FAILURES})${lock ? " — account locked" : ""}`, undefined, { userId });
    go(back, "error", lock ? `Too many wrong PINs — the account is locked for ${LOCK_MINUTES} minutes.` : `Wrong PIN. ${MAX_FAILURES - failures} attempt(s) left before the account locks.`);
  }
  await prisma.user.update({ where: { id: userId }, data: { pinFailures: 0, lockedUntil: null } });
  const store = await cookies();
  store.set(ROLE_COOKIE, "sales_rep", COOKIE_OPTS);
  store.set(USER_COOKIE, user.id, COOKIE_OPTS);
  if (user.branchId) store.set(BRANCH_COOKIE, user.branchId, COOKIE_OPTS);
  await logAudit("Security", userId, "signin", `${user.name} signed in to the field app on ${device.deviceModel}`, undefined, { userId, branchId: user.branchId });
  redirect("/sfa");
}

export async function unlockUser(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) redirect("/admin/devices");
  await prisma.user.update({ where: { id: userId }, data: { pinFailures: 0, lockedUntil: null } });
  await logAudit("Security", userId, "unlock", `Unlocked ${user.name}'s field-app account`);
  redirect("/admin/devices?notice=" + encodeURIComponent(`${user.name} unlocked.`));
}
