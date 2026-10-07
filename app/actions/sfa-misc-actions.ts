"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { getAllSettings, num } from "@/lib/settings";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function go(path: string, kind: "error" | "notice", message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
}

async function me() {
  const { userId, branchId } = await getSession();
  const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
  return { user, branchId };
}

// A reprint is always marked COPY and counted; beyond the configured allowance it is refused.
export async function reprintDocument(formData: FormData) {
  const kind = str(formData, "kind"); // invoice | receipt
  const ref = str(formData, "ref");
  const back = str(formData, "back");
  const s = await getAllSettings();
  const entity = kind === "invoice" ? "Invoice" : "Receipt";
  const used = await prisma.auditLog.count({ where: { entity, entityId: ref, action: "reprint" } });
  const max = num(s, "receipt.maxReprints");
  if (used >= max) go(back, "error", `This ${kind} has already been reprinted ${used} time(s) — the limit is ${max}. A supervisor must authorise another copy.`);
  await logAudit(entity, ref, "reprint", `Reprinted ${kind} ${ref} as COPY #${used + 1}`);
  go(`${back}${back.includes("?") ? "&" : "?"}copy=${used + 1}`, "notice", `Reprint #${used + 1} of ${max} allowed — marked as a copy.`);
}

// Marks a successful reference-data download (customers, prices, promotions, stock) on the device record.
export async function refreshReferenceData() {
  const { user } = await me();
  if (user) {
    await prisma.deviceRegistration.updateMany({ where: { userId: user.id }, data: { lastSyncAt: new Date(), pendingItems: 0, lastError: null } });
  }
  revalidatePath("/sfa/sync");
  revalidatePath("/sfa");
  go("/sfa/sync", "notice", "Reference data refreshed — customers, prices, promotions and stock are up to date.");
}

// A rep proposes a correction to customer master data; the supervisor reviews it.
export async function submitChangeRequest(formData: FormData) {
  const { user, branchId } = await me();
  const outletId = str(formData, "outletId");
  const back = `/sfa/outlets/${outletId}`;
  if (!user) go(back, "error", "No active session.");
  const field = str(formData, "field");
  const proposed = str(formData, "proposedValue");
  const reason = str(formData, "reason");
  if (!field || !proposed || !reason) go(`${back}/change-request`, "error", "Choose what to change, enter the new value and give a reason.");
  const outlet = await prisma.outlet.findUniqueOrThrow({ where: { id: outletId } });
  const current: Record<string, string | null> = { address: outlet.address, contact_person: outlet.contactPerson, phone: outlet.phone, visit_day: outlet.visitDay, closed: outlet.status };
  const cr = await prisma.customerChangeRequest.create({ data: { outletId, requestedBy: user.name, field, currentValue: current[field] ?? null, proposedValue: proposed, reason, photoData: str(formData, "photoData") || null } });
  await logAudit("Outlet", outletId, "change_request", `Change request: ${field.replace("_", " ")} → "${proposed}" (${reason})`, { after: cr });
  await notify({ role: "supervisor", branchId: branchId ?? outlet.branchId, title: "Customer change request", body: `${outlet.name}: ${field.replace("_", " ")} → ${proposed}`, link: "/supervisor/change-requests", kind: "approval" });
  go(back, "notice", "Change request sent to your supervisor. The customer record changes only once it is approved.");
}
