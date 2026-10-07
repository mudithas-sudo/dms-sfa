"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { notify } from "@/lib/notify";
import { assertCan } from "@/lib/rbac";
import { transmitOne } from "@/lib/einvoice";

const PAGE = "/supervisor/einvoicing";

export async function transmitInvoice(formData: FormData) {
  await assertCan("finance", "edit");
  const id = String(formData.get("id"));
  const back = String(formData.get("back") || PAGE);
  const r = await transmitOne(id);
  revalidatePath(PAGE);
  revalidatePath(back);
  redirect(`${back}${back.includes("?") ? "&" : "?"}${r.ok ? "notice" : "error"}=${encodeURIComponent(r.message)}`);
}

// Sends every issued invoice that has not been accepted yet.
export async function transmitPending() {
  await assertCan("finance", "edit");
  const { branchId } = await getSession();
  const list = await prisma.invoice.findMany({ where: { status: { not: "voided" }, einvoiceStatus: { in: ["not_sent", "rejected"] }, ...(branchId ? { branchId } : {}) }, orderBy: { invoiceDate: "asc" }, take: 40, select: { id: true } });
  let ok = 0;
  let bad = 0;
  for (const i of list) {
    if ((await transmitOne(i.id)).ok) ok++;
    else bad++;
  }
  if (bad) await notify({ role: "supervisor", branchId, title: "E-invoices rejected", body: `${bad} invoice(s) were rejected — fix and resend.`, link: PAGE, kind: "alert" });
  revalidatePath(PAGE);
  redirect(`${PAGE}?${bad ? "error" : "notice"}=${encodeURIComponent(`${ok} e-invoice(s) accepted${bad ? `, ${bad} rejected — see the reason in the list` : ""}.`)}`);
}
