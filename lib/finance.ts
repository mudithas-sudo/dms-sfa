import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { getAllSettings, num } from "@/lib/settings";
import type { ARLedgerEntry } from "@prisma/client";

// Receivables rules shared by the supervisor finance screens, the DMS order checks and the SFA collection flow.
//
// Ledger sign convention: invoices, debit notes and upward adjustments increase what the customer owes;
// payments, credit notes, write-offs and downward adjustments reduce it. A payment is only effective once it has
// cleared — a post-dated or uncleared cheque stays "pending" and does not reduce the balance — and a reversed or
// bounced entry never counts.

export { PAYMENT_MODES } from "@/lib/payment-modes";
import { PAYMENT_MODES } from "@/lib/payment-modes";

export const CREDIT_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  on_watch: "On watch",
  on_hold: "On hold",
  blocked: "Blocked",
};

type Entry = Pick<ARLedgerEntry, "type" | "amount" | "recStatus" | "paymentStatus" | "invoiceId" | "unappliedAmount" | "method">;

export function isEffectivePayment(e: Pick<ARLedgerEntry, "recStatus" | "paymentStatus">) {
  return e.recStatus !== "reversed" && e.paymentStatus !== "pending" && e.paymentStatus !== "bounced";
}

// Effect of one entry on the customer's total balance.
export function ledgerDelta(e: Entry): number {
  if (e.recStatus === "reversed") return 0;
  switch (e.type) {
    case "invoice":
    case "void_reversal":
    case "adjustment":
      return e.amount;
    case "debit_note":
      return Math.abs(e.amount);
    case "credit_note":
    case "write_off":
      return -Math.abs(e.amount);
    case "payment":
      return isEffectivePayment(e) ? -e.amount : 0;
    default:
      return 0; // payment_application (moves an existing credit to an invoice) and reversal markers
  }
}

// What is still owed on one invoice. `pending` also counts cheques not yet cleared (use it when allocating,
// so the same invoice cannot be promised to two payments).
export function invoiceBalance(invoice: { amount: number; arLedgerEntries: Entry[] }, opts: { includePending?: boolean } = {}): number {
  let bal = invoice.amount;
  for (const e of invoice.arLedgerEntries) {
    if (e.recStatus === "reversed") continue;
    if (e.type === "payment") {
      if (e.paymentStatus === "bounced") continue;
      if (e.paymentStatus === "pending" && !opts.includePending) continue;
      bal -= e.amount;
    } else if (e.type === "payment_application") bal -= e.amount;
    else if (e.type === "credit_note" || e.type === "write_off") bal -= Math.abs(e.amount);
    else if (e.type === "debit_note") bal += Math.abs(e.amount);
    else if (e.type === "adjustment") bal += e.amount;
  }
  return Math.round(bal * 100) / 100;
}

export async function outletBalance(outletId: string): Promise<number> {
  const entries = await prisma.aRLedgerEntry.findMany({ where: { outletId } });
  return Math.round(entries.reduce((s, e) => s + ledgerDelta(e), 0) * 100) / 100;
}

export async function recomputeInvoiceStatus(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { arLedgerEntries: true } });
  if (!invoice || invoice.status === "voided") return;
  const bal = invoiceBalance(invoice);
  const status = bal <= 0 ? "paid" : bal < invoice.amount ? "partially_paid" : invoice.dueDate < new Date() ? "overdue" : "unpaid";
  if (status !== invoice.status) await prisma.invoice.update({ where: { id: invoiceId }, data: { status } });
}

export async function nextDocNumber(prefix: string, model: "financialDocument" | "creditNote" | "claim") {
  const count = model === "financialDocument" ? await prisma.financialDocument.count() : model === "creditNote" ? await prisma.creditNote.count() : await prisma.claim.count();
  const pad = model === "financialDocument" ? 5 : 4;
  return `${prefix}-${String(count + 1).padStart(pad, "0")}`;
}

export interface ChequeInput {
  number: string;
  bank: string;
  branch?: string;
  date: Date;
}

export interface PaymentInput {
  outletId: string;
  method: string;
  amount: number;
  reference?: string;
  cheque?: ChequeInput;
  // explicit allocation; when omitted the oldest invoices are settled first
  allocations?: { invoiceId: string; amount: number }[];
  collectedBy?: string;
  clientRef?: string;
}

export interface PaymentResult {
  reference: string;
  applied: number;
  unapplied: number;
  pending: boolean;
}

// Posts a customer payment: validates the cheque rules, allocates to invoices, keeps any remainder as unapplied credit.
export async function postPayment(input: PaymentInput): Promise<PaymentResult> {
  const { outletId, method, cheque } = input;
  const amount = Math.round(input.amount * 100) / 100;
  if (!(amount > 0)) throw new Error("Enter an amount above zero.");
  if (!PAYMENT_MODES.some((m) => m.id === method)) throw new Error("Choose a payment mode.");

  if (input.clientRef) {
    const seen = await prisma.aRLedgerEntry.findFirst({ where: { clientRef: { startsWith: input.clientRef } } });
    if (seen) return { reference: seen.reference ?? input.clientRef, applied: 0, unapplied: 0, pending: false }; // idempotent replay
  }

  let pending = false;
  if (method === "cheque") {
    if (!cheque || !cheque.number || !cheque.bank || Number.isNaN(cheque.date.getTime())) throw new Error("A cheque needs its number, bank and cheque date.");
    const dup = await prisma.aRLedgerEntry.findFirst({ where: { method: "cheque", chequeNumber: cheque.number, chequeBank: cheque.bank, paymentStatus: { not: "bounced" }, recStatus: { not: "reversed" } } });
    if (dup) throw new Error(`Cheque ${cheque.number} (${cheque.bank}) has already been recorded — a cheque can only be collected once.`);
    pending = cheque.date.getTime() > Date.now() + 86400000 / 2; // post-dated cheques wait until their date
  }
  if (method === "bank_transfer" && !(input.reference ?? "").trim()) throw new Error("A bank transfer needs its reference number.");

  const reference = (input.reference ?? "").trim() || `OR-${Date.now().toString(36).toUpperCase()}`;
  const invoices = await prisma.invoice.findMany({
    where: { outletId, status: { in: ["unpaid", "partially_paid", "overdue"] } },
    include: { arLedgerEntries: true },
    orderBy: { invoiceDate: "asc" },
  });
  const open = invoices.map((i) => ({ invoice: i, left: invoiceBalance(i, { includePending: true }) })).filter((o) => o.left > 0);

  const plan: { invoiceId: string; amount: number }[] = [];
  let remaining = amount;
  if (input.allocations && input.allocations.length > 0) {
    for (const a of input.allocations) {
      const target = open.find((o) => o.invoice.id === a.invoiceId);
      if (!target || a.amount <= 0) continue;
      const take = Math.min(a.amount, target.left, remaining);
      if (take > 0) {
        plan.push({ invoiceId: a.invoiceId, amount: take });
        remaining -= take;
      }
    }
  } else {
    for (const o of open) {
      if (remaining <= 0) break;
      const take = Math.min(o.left, remaining);
      plan.push({ invoiceId: o.invoice.id, amount: take });
      remaining -= take;
    }
  }

  let balance = await outletBalance(outletId);
  const common = {
    outletId,
    type: "payment",
    method,
    reference,
    collectedBy: input.collectedBy,
    chequeNumber: cheque?.number,
    chequeBank: cheque?.bank,
    chequeBranch: cheque?.branch || undefined,
    chequeDate: cheque?.date,
    paymentStatus: method === "cheque" ? (pending ? "pending" : "cleared") : "cleared",
    recStatus: pending ? "unmatched" : "matched",
  };
  let n = 0;
  for (const p of plan) {
    if (!pending) balance -= p.amount;
    await prisma.aRLedgerEntry.create({ data: { ...common, invoiceId: p.invoiceId, amount: p.amount, balance, clientRef: input.clientRef ? `${input.clientRef}#${n++}` : undefined } });
    await recomputeInvoiceStatus(p.invoiceId);
  }
  remaining = Math.round(remaining * 100) / 100;
  if (remaining > 0) {
    if (!pending) balance -= remaining;
    await prisma.aRLedgerEntry.create({ data: { ...common, amount: remaining, balance, unappliedAmount: remaining, clientRef: input.clientRef ? `${input.clientRef}#${n++}` : undefined } });
  }
  const applied = Math.round((amount - remaining) * 100) / 100;
  await logAudit("ARLedgerEntry", reference, "payment", `Recorded ${method.replace("_", " ")} payment of ₱${amount.toLocaleString()} (${reference})${pending ? " — pending until the cheque date" : ""}`, { after: { outletId, method, amount, applied, unapplied: remaining } });
  await evaluateCredit(outletId, "payment");
  return { reference, applied, unapplied: remaining, pending };
}

// Move unapplied credit (an overpayment or a credit note) onto an open invoice.
export async function applyCredit(entryId: string, invoiceId: string, amount: number): Promise<number> {
  const entry = await prisma.aRLedgerEntry.findUniqueOrThrow({ where: { id: entryId } });
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { arLedgerEntries: true } });
  if (entry.outletId !== invoice.outletId) throw new Error("The credit and the invoice belong to different customers.");
  if (entry.recStatus === "reversed" || !isEffectivePayment(entry)) throw new Error("That credit is not available.");
  const take = Math.min(amount, entry.unappliedAmount, invoiceBalance(invoice, { includePending: true }));
  if (take <= 0) throw new Error("Nothing to apply — check the amount, the unapplied credit and the invoice balance.");
  const balance = await outletBalance(entry.outletId);
  await prisma.aRLedgerEntry.create({
    data: { outletId: entry.outletId, invoiceId, type: "payment_application", method: entry.method, amount: take, balance, reference: `APPLY-${entry.reference ?? entry.id.slice(-6)}`, recStatus: "matched", paymentStatus: "cleared" },
  });
  await prisma.aRLedgerEntry.update({ where: { id: entry.id }, data: { unappliedAmount: { decrement: take } } });
  await recomputeInvoiceStatus(invoiceId);
  await logAudit("ARLedgerEntry", entry.id, "apply_credit", `Applied ₱${take.toLocaleString()} of unapplied credit to ${invoice.invoiceNumber}`);
  return take;
}

export interface CreditFlags {
  status: string;
  overdueAmount: number;
  oldestOverdueDays: number;
  exceedsThreshold: boolean;
}

// Compares a customer's overdue position with the configured thresholds and moves a customer that has crossed
// them on watch (or on hold) — once, with an alert. A supervisor releases it again from the credit screen.
export async function evaluateCredit(outletId: string, source = "check"): Promise<CreditFlags> {
  const s = await getAllSettings();
  const outlet = await prisma.outlet.findUniqueOrThrow({ where: { id: outletId } });
  const invoices = await prisma.invoice.findMany({ where: { outletId, status: { in: ["unpaid", "partially_paid", "overdue"] } }, include: { arLedgerEntries: true } });
  const now = new Date();
  let overdueAmount = 0;
  let oldest = 0;
  for (const i of invoices) {
    const bal = invoiceBalance(i);
    if (i.dueDate < now && bal > 0) {
      overdueAmount += bal;
      oldest = Math.max(oldest, Math.floor((now.getTime() - i.dueDate.getTime()) / 86400000));
    }
  }
  const exceeds = overdueAmount >= num(s, "credit.overdueAmount") || (overdueAmount > 0 && oldest >= num(s, "credit.overdueDays"));
  const mode = s["credit.autoAction"] ?? "on_watch";
  if (exceeds && mode !== "off" && outlet.creditStatus === "active" && outlet.status === "active") {
    const next = mode === "on_hold" ? "on_hold" : "on_watch";
    await prisma.outlet.update({ where: { id: outletId }, data: { creditStatus: next } });
    await logAudit("Outlet", outletId, "credit_status", `Credit status moved to ${next.replace("_", " ")} automatically — overdue ₱${overdueAmount.toLocaleString()} (${oldest} days) crossed the threshold (${source})`, { before: { creditStatus: outlet.creditStatus }, after: { creditStatus: next } });
    await notify({ role: "supervisor", branchId: outlet.branchId, title: `${outlet.name} ${next === "on_hold" ? "placed on hold" : "is on watch"}`, body: `Overdue ₱${overdueAmount.toLocaleString()} · oldest ${oldest} days`, link: "/supervisor/credit", kind: "alert" });
  }
  return { status: outlet.creditStatus, overdueAmount, oldestOverdueDays: oldest, exceedsThreshold: exceeds };
}

// Ageing buckets from the configured boundaries, e.g. "30,60,90" → Current, 1–30, 31–60, 61–90, 90+.
export function ageingBounds(raw: string | undefined): number[] {
  const parsed = (raw ?? "30,60,90").split(",").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  return parsed.length > 0 ? parsed : [30, 60, 90];
}

export function bucketLabels(bounds: number[]): string[] {
  const out = ["Current"];
  bounds.forEach((b, i) => out.push(`${i === 0 ? 1 : bounds[i - 1] + 1}–${b} days`));
  out.push(`${bounds[bounds.length - 1]}+ days`);
  return out;
}

export function bucketIndex(daysPastDue: number, bounds: number[]): number {
  if (daysPastDue <= 0) return 0;
  const i = bounds.findIndex((b) => daysPastDue <= b);
  return i === -1 ? bounds.length + 1 : i + 1;
}

// A cheque that bounced: every payment entry it paid is reversed (the originals stay in the ledger), the invoices
// reopen and the customer goes on watch. Used directly for an uncleared cheque and, once approved, for a cleared one.
export async function applyChequeBounce(outletId: string, reference: string, reason: string) {
  const entries = await prisma.aRLedgerEntry.findMany({ where: { outletId, reference, method: "cheque", type: "payment", recStatus: { not: "reversed" } } });
  if (entries.length === 0) throw new Error("That cheque has no open payment entries.");
  const wasCleared = entries.some((e) => e.paymentStatus !== "pending");
  let balance = await outletBalance(outletId);
  for (const e of entries) {
    if (e.paymentStatus !== "pending") {
      balance += e.amount;
      await prisma.aRLedgerEntry.create({ data: { outletId, invoiceId: e.invoiceId, type: "reversal", amount: e.amount, balance, reference: `BOUNCE-${reference}`, recStatus: "matched" } });
    }
    await prisma.aRLedgerEntry.update({ where: { id: e.id }, data: { recStatus: "reversed", paymentStatus: "bounced", unappliedAmount: 0 } });
    if (e.invoiceId) await recomputeInvoiceStatus(e.invoiceId);
  }
  const total = entries.reduce((s, e) => s + e.amount, 0);
  const outlet = await prisma.outlet.findUniqueOrThrow({ where: { id: outletId } });
  await logAudit("ARLedgerEntry", entries[0].id, "bounce", `Cheque ${entries[0].chequeNumber ?? reference} (${entries[0].chequeBank ?? "bank"}) bounced — ₱${total.toLocaleString()} reversed${wasCleared ? "" : " before clearing"}: ${reason}`, { after: { reference, total } });
  if (outlet.creditStatus === "active") {
    await prisma.outlet.update({ where: { id: outletId }, data: { creditStatus: "on_watch" } });
    await logAudit("Outlet", outletId, "credit_status", `Credit status moved to on watch after a bounced cheque (${reference})`, { before: { creditStatus: "active" }, after: { creditStatus: "on_watch" } });
  }
  await notify({ role: "supervisor", branchId: outlet.branchId, title: `Bounced cheque — ${outlet.name}`, body: `${reference} · ₱${total.toLocaleString()} reversed. ${reason}`, link: "/supervisor/payment-reconciliation", kind: "alert" });
  return total;
}

// Posts an approved credit note to the ledger. A note tied to an invoice reduces that invoice; otherwise it stays
// as unapplied credit the supervisor can apply later.
export async function postCreditNote(creditNoteId: string, approvedBy: string | null) {
  const note = await prisma.creditNote.findUniqueOrThrow({ where: { id: creditNoteId } });
  if (note.status === "applied") return;
  const balance = (await outletBalance(note.outletId)) - note.amount;
  await prisma.aRLedgerEntry.create({
    data: { outletId: note.outletId, invoiceId: note.invoiceId, type: "credit_note", amount: -note.amount, balance, reference: note.noteNumber, unappliedAmount: note.invoiceId ? 0 : note.amount },
  });
  await prisma.creditNote.update({ where: { id: creditNoteId }, data: { status: "applied", approvedBy } });
  if (note.invoiceId) await recomputeInvoiceStatus(note.invoiceId);
  await logAudit("CreditNote", creditNoteId, "apply", `Credit note ${note.noteNumber} of ₱${note.amount.toLocaleString()} posted to the ledger`);
}

// Posts an approved debit note / adjustment / write-off.
export async function postFinancialDocument(docId: string, approvedBy: string, decisionNote?: string) {
  const doc = await prisma.financialDocument.findUniqueOrThrow({ where: { id: docId } });
  if (doc.status === "posted") return;
  const signed = doc.type === "debit_note" ? doc.amount : doc.type === "write_off" ? -doc.amount : doc.direction === "decrease" ? -doc.amount : doc.amount;
  const balance = (await outletBalance(doc.outletId)) + signed;
  await prisma.aRLedgerEntry.create({ data: { outletId: doc.outletId, invoiceId: doc.invoiceId, type: doc.type, amount: signed, balance, reference: doc.docNumber } });
  await prisma.financialDocument.update({ where: { id: docId }, data: { status: "posted", approvedBy, decisionNote: decisionNote || null, decidedAt: new Date() } });
  if (doc.invoiceId) await recomputeInvoiceStatus(doc.invoiceId);
  await logAudit("FinancialDocument", docId, "post", `${doc.docNumber} (${doc.type.replace("_", " ")}) of ₱${doc.amount.toLocaleString()} posted to the customer ledger`);
}

async function currentUserName() {
  const { userId } = await getSession();
  return userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? "User" : "User";
}

// Shared by market returns and manual credit notes: within the supervisor's limit the note is issued straight
// away; above it, it waits for head office approval.
export async function createCreditNote(input: { outletId: string; invoiceId: string | null; amount: number; reason: string }) {
  const s = await getAllSettings();
  const me = await currentUserName();
  const outlet = await prisma.outlet.findUniqueOrThrow({ where: { id: input.outletId } });
  const { role } = await getSession();
  const needsApproval = input.amount > num(s, "creditNote.supervisorLimit") && role !== "admin";
  const note = await prisma.creditNote.create({
    data: { noteNumber: await nextDocNumber("CN", "creditNote"), outletId: input.outletId, invoiceId: input.invoiceId, amount: input.amount, reason: input.reason, issuedBy: me, status: needsApproval ? "pending_approval" : "approved" },
  });
  await logAudit("CreditNote", note.id, "create", `Credit note ${note.noteNumber} of ₱${input.amount.toLocaleString()} for ${outlet.name} — ${input.reason}`);
  if (needsApproval) {
    await prisma.approvalRequest.create({
      data: { type: "credit_note", refId: note.id, outletId: input.outletId, branchId: outlet.branchId, requestedBy: me, amount: input.amount, reason: `${note.noteNumber} for ${outlet.name}: ${input.reason} · above the supervisor limit of ₱${num(s, "creditNote.supervisorLimit").toLocaleString()}` },
    });
    await notify({ role: "admin", title: `${note.noteNumber} awaiting approval`, body: `Credit note ₱${input.amount.toLocaleString()} · ${outlet.name}`, link: "/supervisor/approvals", kind: "approval" });
  } else {
    await postCreditNote(note.id, me);
  }
  return { note, needsApproval };
}
