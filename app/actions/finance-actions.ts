"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { assertCan } from "@/lib/rbac";
import { getAllSettings, num } from "@/lib/settings";
import { applyChequeBounce, applyCredit, evaluateCredit, invoiceBalance, nextDocNumber, outletBalance, createCreditNote, postPayment, recomputeInvoiceStatus } from "@/lib/finance";

function go(path: string, kind: "error" | "notice", message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function actorName() {
  const { userId } = await getSession();
  return userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? "User" : "User";
}

const PAY = "/supervisor/payment-reconciliation";

// Supervisor-side payment entry: allocate a lump sum to chosen invoices, record cheque details, keep any
// remainder as unapplied credit.
export async function recordPayment(formData: FormData) {
  await assertCan("finance", "edit");
  const outletId = str(formData, "outletId");
  const back = `${PAY}?outlet=${outletId}`;
  const method = str(formData, "method");
  const amount = Number(str(formData, "amount"));
  const picked = formData.getAll("invoiceId").map(String);
  const allocations = picked.map((invoiceId) => ({ invoiceId, amount: Number(str(formData, `amount_${invoiceId}`)) })).filter((a) => a.amount > 0);
  try {
    const { userId } = await getSession();
    const result = await postPayment({
      outletId,
      method,
      amount,
      reference: str(formData, "reference"),
      cheque: method === "cheque" ? { number: str(formData, "chequeNumber"), bank: str(formData, "chequeBank"), branch: str(formData, "chequeBranch"), date: new Date(str(formData, "chequeDate")) } : undefined,
      allocations: picked.length ? allocations : undefined,
      collectedBy: userId ?? undefined,
    });
    revalidatePath(PAY);
    revalidatePath("/supervisor/ar-aging");
    go(back, "notice", `${result.reference}: ₱${result.applied.toLocaleString()} applied to invoices${result.unapplied ? `, ₱${result.unapplied.toLocaleString()} kept as unapplied credit` : ""}${result.pending ? " — held as pending until the cheque clears" : ""}.`);
  } catch (e) {
    if (e instanceof Error && !e.message.startsWith("NEXT_")) go(back, "error", e.message);
    throw e;
  }
}

// A cheque clears on or after its date: only then does it reduce what the customer owes.
export async function clearCheque(formData: FormData) {
  await assertCan("finance", "edit");
  const outletId = str(formData, "outletId");
  const reference = str(formData, "reference");
  const back = `${PAY}?outlet=${outletId}`;
  const entries = await prisma.aRLedgerEntry.findMany({ where: { outletId, reference, method: "cheque", type: "payment", paymentStatus: "pending" } });
  if (entries.length === 0) go(back, "error", "That cheque is not pending.");
  const chequeDate = entries[0].chequeDate;
  if (chequeDate && chequeDate.getTime() > Date.now() + 86400000) go(back, "error", `This is a post-dated cheque — it can only be cleared on or after ${chequeDate.toLocaleDateString("en-PH")}.`);
  let balance = await outletBalance(outletId);
  for (const e of entries) {
    balance -= e.amount;
    await prisma.aRLedgerEntry.update({ where: { id: e.id }, data: { paymentStatus: "cleared", recStatus: "cleared", balance } });
    if (e.invoiceId) await recomputeInvoiceStatus(e.invoiceId);
  }
  await logAudit("ARLedgerEntry", entries[0].id, "clear", `Cheque ${entries[0].chequeNumber} (${entries[0].chequeBank}) cleared — ₱${entries.reduce((s, e) => s + e.amount, 0).toLocaleString()} now reduces the balance`);
  await evaluateCredit(outletId, "cheque cleared");
  revalidatePath(PAY);
  go(back, "notice", "Cheque cleared and applied to the customer's balance.");
}

// A pending cheque that bounces never touched the balance, so it is marked bounced at once; a cleared cheque that
// bounces needs a supervisor-approved reversal like any other correction to a posted payment.
export async function bounceCheque(formData: FormData) {
  await assertCan("finance", "edit");
  const outletId = str(formData, "outletId");
  const reference = str(formData, "reference");
  const reason = str(formData, "reason") || "Returned by the bank";
  const back = `${PAY}?outlet=${outletId}`;
  const entries = await prisma.aRLedgerEntry.findMany({ where: { outletId, reference, method: "cheque", type: "payment", recStatus: { not: "reversed" } } });
  if (entries.length === 0) go(back, "error", "That cheque has no open entries.");
  if (entries.every((e) => e.paymentStatus === "pending")) {
    await applyChequeBounce(outletId, reference, reason);
    revalidatePath(PAY);
    go(back, "notice", "Cheque marked as bounced. The customer is now on watch.");
  }
  const dup = await prisma.approvalRequest.count({ where: { type: "cheque_bounce", refId: reference, outletId, status: "pending" } });
  if (!dup) {
    const total = entries.reduce((s, e) => s + e.amount, 0);
    const bounceBranch = (await prisma.outlet.findUnique({ where: { id: outletId }, select: { branchId: true } }))?.branchId ?? null;
    await prisma.approvalRequest.create({ data: { type: "cheque_bounce", refId: reference, outletId, branchId: bounceBranch, requestedBy: await actorName(), amount: total, reason: `Cheque ${entries[0].chequeNumber} (${entries[0].chequeBank}) bounced after clearing — ${reason}`, payload: JSON.stringify({ reference, reason }) } });
    await notify({ role: "supervisor", title: "Bounced cheque needs reversal approval", body: `${reference} · ₱${total.toLocaleString()}`, link: "/supervisor/approvals", kind: "approval" });
  }
  revalidatePath(PAY);
  go(back, "notice", "Reversal requested — it takes effect once approved.");
}

export async function applyUnapplied(formData: FormData) {
  await assertCan("finance", "edit");
  const outletId = str(formData, "outletId");
  const back = `${PAY}?outlet=${outletId}`;
  try {
    const taken = await applyCredit(str(formData, "entryId"), str(formData, "invoiceId"), Number(str(formData, "amount")));
    revalidatePath(PAY);
    go(back, "notice", `₱${taken.toLocaleString()} of credit applied to the invoice.`);
  } catch (e) {
    if (e instanceof Error && !e.message.startsWith("NEXT_")) go(back, "error", e.message);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Customer credit control
// ---------------------------------------------------------------------------

const CREDIT = "/supervisor/credit";

export async function setCreditStatus(formData: FormData) {
  await assertCan("finance", "approve");
  const outletId = str(formData, "outletId");
  const status = str(formData, "status");
  const reason = str(formData, "reason");
  if (!["active", "on_watch", "on_hold", "blocked"].includes(status)) go(CREDIT, "error", "Choose a credit status.");
  const outlet = await prisma.outlet.findUniqueOrThrow({ where: { id: outletId } });
  if (outlet.creditStatus === status) go(CREDIT, "error", "The customer already has that status.");
  if (!reason) go(CREDIT, "error", status === "active" ? "Say why the hold is being released." : "Give a reason for the change.");
  const { role } = await getSession();
  if (status === "blocked" && role !== "admin" && role !== "supervisor") go(CREDIT, "error", "Only a supervisor or head office can block a customer.");
  await prisma.outlet.update({ where: { id: outletId }, data: { creditStatus: status, blockedReason: status === "active" ? null : reason } });
  await logAudit("Outlet", outletId, "credit_status", `${outlet.name}: credit status ${outlet.creditStatus.replace("_", " ")} → ${status.replace("_", " ")} — ${reason}`, { before: { creditStatus: outlet.creditStatus }, after: { creditStatus: status } });
  if (status === "on_hold" || status === "blocked") {
    await notify({ role: "sales_rep", branchId: outlet.branchId, title: `${outlet.name} ${status === "blocked" ? "blocked" : "on credit hold"}`, body: `New orders are held. ${reason}`, link: `/sfa/outlets/${outlet.id}`, kind: "alert" });
  }
  revalidatePath(CREDIT);
  go(CREDIT, "notice", `${outlet.name} is now ${status.replace("_", " ")}.`);
}

// Checks every customer against the overdue thresholds, moves those past them and raises alerts.
export async function runOverdueCheck() {
  await assertCan("finance", "edit");
  const { branchId } = await getSession();
  const outlets = await prisma.outlet.findMany({ where: { status: "active", ...(branchId ? { branchId } : {}) }, select: { id: true, creditStatus: true } });
  let moved = 0;
  for (const o of outlets) {
    const before = o.creditStatus;
    const flags = await evaluateCredit(o.id, "overdue check");
    if (flags.exceedsThreshold && before === "active") moved++;
  }
  revalidatePath(CREDIT);
  go(CREDIT, "notice", moved ? `${moved} customer(s) crossed the overdue threshold and were moved — see the alerts.` : "No customer crossed the overdue threshold.");
}

// ---------------------------------------------------------------------------
// Debit notes, adjustments, write-offs and credit notes
// ---------------------------------------------------------------------------

const DOCS = "/supervisor/finance-documents";
const DOC_PREFIX: Record<string, string> = { debit_note: "DN", adjustment: "ADJ", write_off: "WO" };

export async function requestFinancialDocument(formData: FormData) {
  await assertCan("finance", "edit");
  const type = str(formData, "type");
  const outletId = str(formData, "outletId");
  const invoiceId = str(formData, "invoiceId") || null;
  const amount = Math.round(Number(str(formData, "amount")) * 100) / 100;
  const reason = str(formData, "reason");
  const direction = str(formData, "direction") === "decrease" ? "decrease" : "increase";
  if (!DOC_PREFIX[type]) go(DOCS, "error", "Choose the document type.");
  if (!outletId || !(amount > 0)) go(DOCS, "error", "Choose the customer and enter an amount above zero.");
  if (reason.length < 5) go(DOCS, "error", "A reason is required — write what the document is for.");
  const outlet = await prisma.outlet.findUniqueOrThrow({ where: { id: outletId } });
  if (invoiceId) {
    const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { arLedgerEntries: true } });
    if (!inv || inv.outletId !== outletId) go(DOCS, "error", "That invoice does not belong to the customer.");
    if (inv.status === "voided") go(DOCS, "error", "That invoice has been voided.");
    if ((type === "write_off" || (type === "adjustment" && direction === "decrease")) && amount > invoiceBalance(inv) + 0.005) go(DOCS, "error", `The amount is more than the invoice balance of ₱${invoiceBalance(inv).toLocaleString()}.`);
  } else if (type === "write_off") {
    go(DOCS, "error", "A write-off must be tied to an invoice.");
  }
  const s = await getAllSettings();
  const me = await actorName();
  const doc = await prisma.financialDocument.create({
    data: { docNumber: await nextDocNumber(DOC_PREFIX[type], "financialDocument"), type, outletId, invoiceId, amount, direction: type === "adjustment" ? direction : "increase", reason, requestedBy: me },
  });
  const headOffice = type === "write_off" || amount > num(s, "finance.docSupervisorLimit");
  await prisma.approvalRequest.create({
    data: { type: "fin_doc", refId: doc.id, outletId, branchId: outlet.branchId, requestedBy: me, amount, reason: `${doc.docNumber} — ${type.replace("_", " ")}${type === "adjustment" ? ` (${direction})` : ""} for ${outlet.name}: ${reason}${headOffice ? " · needs head office finance approval" : ""}` },
  });
  await logAudit("FinancialDocument", doc.id, "create", `Requested ${doc.docNumber} (${type.replace("_", " ")}) of ₱${amount.toLocaleString()} for ${outlet.name} — ${reason}`);
  await notify({ role: headOffice ? "admin" : "supervisor", branchId: headOffice ? null : outlet.branchId, title: `${doc.docNumber} awaiting approval`, body: `${type.replace("_", " ")} ₱${amount.toLocaleString()} · ${outlet.name}`, link: "/supervisor/approvals", kind: "approval" });
  revalidatePath(DOCS);
  go(DOCS, "notice", `${doc.docNumber} submitted for approval${headOffice ? " (head office finance)" : ""}. It posts to the ledger only once approved.`);
}

// A credit note outside a market return (price error, goodwill, rebate settlement).
export async function requestCreditNote(formData: FormData) {
  await assertCan("finance", "edit");
  const outletId = str(formData, "outletId");
  const invoiceId = str(formData, "invoiceId") || null;
  const amount = Math.round(Number(str(formData, "amount")) * 100) / 100;
  const reason = str(formData, "reason");
  if (!outletId || !(amount > 0)) go(DOCS, "error", "Choose the customer and enter an amount above zero.");
  if (reason.length < 5) go(DOCS, "error", "A reason is required.");
  await createCreditNote({ outletId, invoiceId, amount, reason });
  revalidatePath(DOCS);
  go(DOCS, "notice", "Credit note raised.");
}
