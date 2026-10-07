"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { SETTING_DEFS, getAllSettings } from "@/lib/settings";
import { assertCan, DEFAULT_MATRIX, LEVELS, PERMISSION_MODULES, type Level } from "@/lib/rbac";
import { ROLES } from "@/lib/constants";

function fail(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
}
function ok(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(message)}`);
}
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const strOrNull = (f: FormData, k: string) => str(f, k) || null;

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export async function markAllNotificationsRead() {
  const { role, userId } = await getSession();
  await prisma.notification.updateMany({
    where: { readAt: null, OR: [...(userId ? [{ userId }] : []), { role, userId: null }] },
    data: { readAt: new Date() },
  });
  revalidatePath("/notifications");
  redirect("/notifications");
}

// ---------------------------------------------------------------------------
// Configuration (thresholds, modes, policies) — changed without a software release
// ---------------------------------------------------------------------------

export async function saveSettings(formData: FormData) {
  await assertCan("users", "edit");
  const { userId } = await getSession();
  const before = await getAllSettings();
  const changes: Record<string, { from: string; to: string }> = {};
  for (const def of SETTING_DEFS) {
    const raw = formData.get(def.key);
    if (raw === null) continue;
    const value = String(raw).trim();
    if (def.type === "number" && (value === "" || Number.isNaN(Number(value)))) fail("/admin/settings", `"${def.label}" must be a number.`);
    if (def.key === "nearExpiry.overrides") {
      try {
        JSON.parse(value || "{}");
      } catch {
        fail("/admin/settings", "Near-expiry overrides must be valid JSON.");
      }
    }
    if (value !== before[def.key]) {
      changes[def.key] = { from: before[def.key], to: value };
      await prisma.appSetting.upsert({ where: { key: def.key }, update: { value, updatedBy: userId }, create: { key: def.key, value, updatedBy: userId } });
    }
  }
  const n = Object.keys(changes).length;
  if (n) await logAudit("Settings", "platform", "update", `Changed ${n} configuration setting(s): ${Object.keys(changes).join(", ")}`, { before: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.from])), after: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.to])) });
  revalidatePath("/admin/settings");
  ok("/admin/settings", n ? `${n} setting(s) saved — they apply immediately, no release needed.` : "No changes.");
}

// Switch on a simulated interface outage: the next N gateway messages fail.
export async function setSimulatedOutage(formData: FormData) {
  await assertCan("users", "edit");
  const count = Math.max(0, Math.min(20, Number(str(formData, "count")) || 0));
  await prisma.appSetting.upsert({ where: { key: "integration.failNext" }, update: { value: String(count) }, create: { key: "integration.failNext", value: String(count) } });
  await logAudit("Integration", "gateway", "configure", count ? `Simulated outage: next ${count} gateway message(s) will fail` : "Simulated outage switched off");
  revalidatePath("/admin/integrations");
  redirect("/admin/integrations");
}

// ---------------------------------------------------------------------------
// Roles & permissions — one matrix for the DMS and the SFA app, enforced on the server
// ---------------------------------------------------------------------------

export async function savePermissions(formData: FormData) {
  await assertCan("users", "approve");
  const changes: string[] = [];
  for (const role of ROLES.map((r) => r.id)) {
    if (role === "admin") continue; // the head-office administrator role is not editable
    for (const m of PERMISSION_MODULES) {
      const raw = str(formData, `${role}__${m.id}`) as Level;
      if (!LEVELS.includes(raw)) continue;
      const row = await prisma.rolePermission.findUnique({ where: { role_module: { role, module: m.id } } });
      const current = row?.level ?? DEFAULT_MATRIX[role][m.id];
      if (raw !== current) {
        await prisma.rolePermission.upsert({ where: { role_module: { role, module: m.id } }, update: { level: raw }, create: { role, module: m.id, level: raw } });
        changes.push(`${role}/${m.id}: ${current} → ${raw}`);
      }
    }
  }
  if (changes.length) await logAudit("Role", "matrix", "update", `Changed ${changes.length} role permission(s)`, { after: changes });
  revalidatePath("/admin/permissions");
  ok("/admin/permissions", changes.length ? `${changes.length} permission(s) changed — effective on the next request, no redeployment.` : "No changes.");
}

// ---------------------------------------------------------------------------
// Users (accounts, roles, branch scope) and multi-factor enrolment
// ---------------------------------------------------------------------------

const VALID_ROLES = ROLES.map((r) => r.id as string);

export async function createUserAccount(formData: FormData) {
  await assertCan("users", "edit");
  const name = str(formData, "name");
  const role = str(formData, "role");
  if (!name || !VALID_ROLES.includes(role)) fail("/admin/users", "A name and a valid role are required.");
  const global = role === "admin" || role === "management";
  const branchId = global ? null : strOrNull(formData, "branchId");
  if (!global && !branchId) fail("/admin/users", "Branch roles must be assigned a branch.");
  const employeeCode = strOrNull(formData, "employeeCode");
  if (employeeCode && (await prisma.user.findUnique({ where: { employeeCode } }))) fail("/admin/users", `Employee code ${employeeCode} is already used.`);
  const user = await prisma.user.create({
    data: {
      name, role, branchId, employeeCode, email: strOrNull(formData, "email"),
      branchScope: formData.getAll("branchScope").map(String).filter(Boolean).join(",") || null,
    },
  });
  await logAudit("User", user.id, "create", `Created user account "${name}" with role ${role}`, { after: user });
  revalidatePath("/admin/users");
  ok("/admin/users", `${name} created. Privileged roles must complete MFA enrolment at first sign-in.`);
}

export async function updateUserAccount(formData: FormData) {
  await assertCan("users", "edit");
  const id = str(formData, "id");
  const before = await prisma.user.findUniqueOrThrow({ where: { id } });
  const role = str(formData, "role") || before.role;
  const global = role === "admin" || role === "management";
  const active = str(formData, "active") !== "inactive";
  const after = await prisma.user.update({
    where: { id },
    data: {
      role,
      branchId: global ? null : strOrNull(formData, "branchId") ?? before.branchId,
      branchScope: formData.getAll("branchScope").map(String).filter(Boolean).join(",") || null,
      active,
      mfaEnrolled: role !== before.role ? false : before.mfaEnrolled,
    },
  });
  const action = role !== before.role ? "role_change" : active !== before.active ? (active ? "activate" : "deactivate") : "scope_change";
  await logAudit("User", id, action, `Updated account "${before.name}"${role !== before.role ? ` — role ${before.role} → ${role} (effective at next sign-in)` : ""}`, {
    before: { role: before.role, branchId: before.branchId, branchScope: before.branchScope, active: before.active },
    after: { role: after.role, branchId: after.branchId, branchScope: after.branchScope, active: after.active },
  });
  revalidatePath("/admin/users");
  ok("/admin/users", `${before.name} updated.`);
}

// Bulk creation: one user per line — name, role, branch code, email, employee code.
export async function bulkCreateUsers(formData: FormData) {
  await assertCan("users", "edit");
  const text = str(formData, "csv");
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) fail("/admin/users", "Paste at least one line: name, role, branch code, email, employee code.");
  const branches = await prisma.branch.findMany();
  let created = 0;
  const problems: string[] = [];
  for (const [i, line] of lines.entries()) {
    const [name, role, branchCode, email, employeeCode] = line.split(",").map((s) => s.trim());
    if (!name || !VALID_ROLES.includes(role)) {
      problems.push(`line ${i + 1}: needs a name and a valid role (${VALID_ROLES.join(", ")})`);
      continue;
    }
    const global = role === "admin" || role === "management";
    const branch = branches.find((b) => b.code === branchCode || b.name === branchCode);
    if (!global && !branch) {
      problems.push(`line ${i + 1}: unknown branch "${branchCode}"`);
      continue;
    }
    if (employeeCode && (await prisma.user.findUnique({ where: { employeeCode } }))) {
      problems.push(`line ${i + 1}: employee code ${employeeCode} already used`);
      continue;
    }
    const user = await prisma.user.create({ data: { name, role, branchId: global ? null : branch!.id, email: email || null, employeeCode: employeeCode || null } });
    await logAudit("User", user.id, "create", `Bulk-created user "${name}" (${role})`, { after: user });
    created += 1;
  }
  revalidatePath("/admin/users");
  const msg = `${created} user(s) created${problems.length ? `; skipped ${problems.length}: ${problems.join("; ")}` : ""}.`;
  if (created === 0) fail("/admin/users", msg);
  ok("/admin/users", msg);
}

// Resetting a second factor is a controlled administrator action and is audited.
export async function resetMfa(formData: FormData) {
  await assertCan("users", "approve");
  const id = str(formData, "id");
  const user = await prisma.user.findUniqueOrThrow({ where: { id } });
  await prisma.user.update({ where: { id }, data: { mfaEnrolled: false } });
  await logAudit("User", id, "mfa_reset", `Reset multi-factor enrolment for "${user.name}" after identity verification`, { before: { mfaEnrolled: true }, after: { mfaEnrolled: false } });
  revalidatePath("/admin/users");
  ok("/admin/users", `MFA reset for ${user.name}. They must enrol again at next sign-in.`);
}

export async function saveMfaPolicy(formData: FormData) {
  await assertCan("users", "approve");
  const roles = formData.getAll("roles").map(String).filter((r) => VALID_ROLES.includes(r));
  const before = (await getAllSettings())["mfa.privilegedRoles"];
  const value = roles.join(",");
  await prisma.appSetting.upsert({ where: { key: "mfa.privilegedRoles" }, update: { value }, create: { key: "mfa.privilegedRoles", value } });
  await logAudit("Settings", "mfa", "update", `Changed roles that must use multi-factor authentication`, { before: { roles: before }, after: { roles: value } });
  revalidatePath("/admin/security");
  ok("/admin/security", "MFA policy saved.");
}

// ---------------------------------------------------------------------------
// Devices and printers (SFA governance)
// ---------------------------------------------------------------------------

export async function decideDevice(formData: FormData) {
  await assertCan("users", "edit");
  const id = str(formData, "id");
  const status = str(formData, "status"); // approved | revoked
  const device = await prisma.deviceRegistration.findUniqueOrThrow({ where: { id } });
  await prisma.deviceRegistration.update({ where: { id }, data: { status } });
  const user = await prisma.user.findUnique({ where: { id: device.userId } });
  await logAudit("Device", id, status, `${status === "approved" ? "Approved" : "Revoked"} device ${device.deviceModel} for ${user?.name ?? "user"}`, { before: { status: device.status }, after: { status } });
  revalidatePath("/admin/devices");
  redirect("/admin/devices");
}

export async function addApprovedHardware(formData: FormData) {
  await assertCan("users", "edit");
  const kind = str(formData, "kind");
  const model = str(formData, "model");
  if (!model || !["device", "printer"].includes(kind)) fail("/admin/devices", "Enter a model name.");
  const row = await prisma.approvedHardware.create({ data: { kind, model } });
  await logAudit("Hardware", row.id, "create", `Added approved ${kind} model "${model}"`, { after: row });
  revalidatePath("/admin/devices");
  redirect("/admin/devices");
}

export async function retireHardware(formData: FormData) {
  await assertCan("users", "edit");
  const id = str(formData, "id");
  const status = str(formData, "status");
  const row = await prisma.approvedHardware.update({ where: { id }, data: { status } });
  await logAudit("Hardware", id, status === "retired" ? "retire" : "restore", `${status === "retired" ? "Retired" : "Restored"} approved ${row.kind} model "${row.model}"`);
  revalidatePath("/admin/devices");
  redirect("/admin/devices");
}

// An administrator clears a device's stuck items after correcting the cause.
export async function resolveDeviceErrors(formData: FormData) {
  await assertCan("users", "edit");
  const id = str(formData, "id");
  const device = await prisma.deviceRegistration.findUniqueOrThrow({ where: { id } });
  await prisma.deviceRegistration.update({ where: { id }, data: { errorItems: 0, lastError: null } });
  await logAudit("Device", id, "resolve", `Resolved ${device.errorItems} errored sync item(s) on ${device.deviceModel}`, { before: { errorItems: device.errorItems }, after: { errorItems: 0 } });
  revalidatePath("/admin/devices");
  redirect("/admin/devices");
}

// ---------------------------------------------------------------------------
// Integration gateway: error queue, reconciliation and BI feed
// ---------------------------------------------------------------------------

export async function resolveIntegrationMessage(formData: FormData) {
  await assertCan("users", "edit");
  const { userId } = await getSession();
  const id = str(formData, "id");
  const action = str(formData, "action"); // resend | discard
  const msg = await prisma.integrationMessage.findUniqueOrThrow({ where: { id } });
  const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;

  if (action === "discard") {
    const reason = str(formData, "reason");
    if (!reason) fail("/admin/integrations", "A reason is required to discard a message.");
    await prisma.integrationMessage.update({ where: { id }, data: { status: "discarded", resolvedAt: new Date(), resolvedBy: user?.name, resolution: reason } });
    await logAudit("IntegrationMessage", id, "discard", `Discarded ${msg.connector} message ${msg.reference} — ${reason}`);
  } else {
    const failNow = Number((await prisma.appSetting.findUnique({ where: { key: "integration.failNext" } }))?.value ?? 0);
    if (failNow > 0) {
      await prisma.appSetting.update({ where: { key: "integration.failNext" }, data: { value: String(failNow - 1) } });
      await prisma.integrationMessage.update({ where: { id }, data: { retryCount: { increment: 1 }, status: "error" } });
      fail("/admin/integrations", `Resend of ${msg.reference} failed again — the endpoint is still unavailable (simulated).`);
    }
    await prisma.integrationMessage.update({
      where: { id },
      data: { status: "resolved", retryCount: { increment: 1 }, resolvedAt: new Date(), resolvedBy: user?.name, resolution: str(formData, "correction") || "Resent successfully", error: null },
    });
    await logAudit("IntegrationMessage", id, "resend", `Corrected and resent ${msg.connector} message ${msg.reference}`);
  }
  revalidatePath("/admin/integrations");
  redirect("/admin/integrations");
}

export async function runBiExtract(formData: FormData) {
  await assertCan("reports", "edit");
  const dataset = str(formData, "dataset");
  const revoked = await prisma.appSetting.findUnique({ where: { key: `bi.consumer.${dataset}` } });
  if (revoked?.value === "revoked") fail("/admin/integrations", `The BI consumer credential for "${dataset}" is revoked — the extract was refused.`);
  const counts: Record<string, () => Promise<number>> = {
    sales: () => prisma.salesOrderLine.count(),
    inventory: () => prisma.stockBalance.count(),
    purchasing: () => prisma.purchaseOrderLine.count(),
    claims: () => prisma.claim.count(),
    receivables: () => prisma.aRLedgerEntry.count(),
    master_data: async () => (await prisma.outlet.count()) + (await prisma.product.count()),
  };
  const rowCount = await (counts[dataset] ?? (async () => 0))();
  const extract = await prisma.biExtract.create({ data: { dataset, consumer: "Company F and B BI environment", rowCount, status: "success" } });
  await logAudit("BiExtract", extract.id, "extract", `BI feed: ${dataset} extract delivered (${rowCount} rows)`);
  revalidatePath("/admin/integrations");
  redirect("/admin/integrations");
}

export async function toggleBiConsumer(formData: FormData) {
  await assertCan("users", "edit");
  const dataset = str(formData, "dataset");
  const to = str(formData, "to"); // active | revoked
  await prisma.appSetting.upsert({ where: { key: `bi.consumer.${dataset}` }, update: { value: to }, create: { key: `bi.consumer.${dataset}`, value: to } });
  await logAudit("Integration", dataset, to === "revoked" ? "revoke" : "grant", `${to === "revoked" ? "Revoked" : "Granted"} BI consumer credentials for dataset "${dataset}"`);
  revalidatePath("/admin/integrations");
  redirect("/admin/integrations");
}

// ---------------------------------------------------------------------------
// MFA enrolment at first sign-in for privileged roles (simulated authenticator: code 123456)
// ---------------------------------------------------------------------------

export async function enrolMfa(formData: FormData) {
  const { userId, role } = await getSession();
  const back = str(formData, "back") || "/";
  if (!userId) fail(back, "Select a user first.");
  if (str(formData, "code") !== "123456") fail(back, "That code was not accepted. In this demo the authenticator code is 123456.");
  const user = await prisma.user.update({ where: { id: userId }, data: { mfaEnrolled: true } });
  await logAudit("Security", userId, "mfa_enrol", `${user.name} enrolled a second factor (authenticator app) for role ${role}`, undefined, { userId });
  revalidatePath("/", "layout");
  redirect(back);
}
