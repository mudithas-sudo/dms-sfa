"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { assertCan } from "@/lib/rbac";
import { ensureReferenceDefaults } from "@/lib/reference";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const BACK = "/admin/reference-data";
function go(kind: "error" | "notice", message: string): never {
  redirect(`${BACK}?${kind}=${encodeURIComponent(message)}`);
}

export async function addReferenceItem(formData: FormData) {
  await assertCan("master_data", "edit");
  await ensureReferenceDefaults();
  const kind = str(formData, "kind");
  const label = str(formData, "label");
  if (!["payment_term", "bank", "tax_rate"].includes(kind)) go("error", "Unknown reference list.");
  if (!label) go("error", "Give the entry a name.");
  let code = str(formData, "code").toLowerCase().replace(/[^a-z0-9_]/g, "_");
  let value: number | null = null;
  if (kind === "payment_term") {
    const days = Math.floor(Number(str(formData, "value")));
    if (!Number.isFinite(days) || days < 0 || days > 365) go("error", "Enter the number of credit days (0 for cash).");
    value = days;
    code = days === 0 ? "cash" : `credit_${days}`; // the code carries the days, which is how due dates are calculated
  } else if (kind === "tax_rate") {
    const pct = Number(str(formData, "value"));
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) go("error", "Enter the tax rate as a percentage between 0 and 100.");
    value = pct;
    if (!code) go("error", "Give the tax code (e.g. VAT12).");
  } else {
    code = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);
  }
  const exists = await prisma.referenceItem.findUnique({ where: { kind_code: { kind, code } } });
  if (exists) go("error", `"${exists.label}" already exists in this list.`);
  const item = await prisma.referenceItem.create({ data: { kind, code, label, value } });
  await logAudit("ReferenceItem", item.id, "create", `Added ${kind.replace("_", " ")} "${label}"${value !== null ? ` (${value})` : ""}`, { after: item });
  revalidatePath(BACK);
  go("notice", `"${label}" added.`);
}

export async function toggleReferenceItem(formData: FormData) {
  await assertCan("master_data", "edit");
  const id = str(formData, "id");
  const item = await prisma.referenceItem.findUniqueOrThrow({ where: { id } });
  if (item.isDefault && item.status === "active") go("error", "Choose another default tax rate before switching this one off.");
  const next = item.status === "active" ? "inactive" : "active";
  if (item.kind === "payment_term" && next === "inactive") {
    const using = await prisma.outlet.count({ where: { paymentTerms: item.code, status: "active" } });
    if (using) go("error", `${using} active customer(s) use "${item.label}" — move them to another term first.`);
  }
  await prisma.referenceItem.update({ where: { id }, data: { status: next } });
  await logAudit("ReferenceItem", id, next === "active" ? "activate" : "deactivate", `${item.label} ${next === "active" ? "re-activated" : "switched off"}`);
  revalidatePath(BACK);
  go("notice", `"${item.label}" is now ${next}.`);
}

export async function setDefaultTaxRate(formData: FormData) {
  await assertCan("master_data", "approve");
  const id = str(formData, "id");
  const item = await prisma.referenceItem.findUniqueOrThrow({ where: { id } });
  if (item.status !== "active") go("error", "Activate the tax rate first.");
  await prisma.referenceItem.updateMany({ where: { kind: "tax_rate" }, data: { isDefault: false } });
  await prisma.referenceItem.update({ where: { id }, data: { isDefault: true } });
  await logAudit("ReferenceItem", id, "set_default", `${item.label} (${item.value}%) is now the tax rate on new invoices; issued invoices keep their tax`);
  revalidatePath(BACK);
  go("notice", `${item.label} (${item.value}%) now applies to new invoices. Issued invoices keep the tax they were issued with.`);
}
