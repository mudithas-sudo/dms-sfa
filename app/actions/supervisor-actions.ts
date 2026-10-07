"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { assertCan } from "@/lib/rbac";
import { getAllSettings, num } from "@/lib/settings";
import { applyReclass } from "@/app/actions/inventory-actions";
import { completeHeldOrder, performOrderCancellation } from "@/app/actions/sales-actions";

import { addToLot } from "@/lib/stock";
import { completeVanSale } from "@/lib/vansale";
import { applyChequeBounce, createCreditNote, invoiceBalance, outletBalance, postCreditNote, postFinancialDocument, recomputeInvoiceStatus } from "@/lib/finance";

async function currentUserName(fallback: string) {
  const { userId } = await getSession();
  return userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? fallback : fallback;
}

function fail(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
}

const HOLD_TYPES = ["credit_limit_exception", "stock_shortage", "overdue_balance", "duplicate_order", "discount_override"];

// Put a voided order's stock back where it came from — the allocated warehouse lot or the rep's van.
async function restoreStockForVoid(orderId: string, approver: string) {
  const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
  if (!["delivered", "partially_delivered", "invoiced"].includes(order.status)) return;
  const lineIds = order.lines.map((l) => l.id);
  const dispatched = await prisma.orderAllocation.count({ where: { salesOrderLineId: { in: lineIds }, status: "dispatched" } });
  if (dispatched > 0) {
    for (const line of order.lines) {
      // only what actually left the warehouse and was kept by the customer comes back
      const delivered = order.status === "invoiced" ? (line.qtyPicked ?? line.qty) : line.qtyDelivered ?? 0;
      let left = delivered;
      const allocs = await prisma.orderAllocation.findMany({ where: { salesOrderLineId: line.id, status: "dispatched" }, orderBy: { createdAt: "asc" } });
      for (const a of allocs) {
        if (left <= 0) break;
        const back = Math.min(a.qty, left);
        const src = await prisma.stockBalance.findFirst({ where: { warehouseId: a.warehouseId, productId: a.productId, lotNumber: a.lotNumber } });
        await addToLot({ locationType: "warehouse", warehouseId: a.warehouseId }, a.productId, a.lotNumber, src?.expiryDate ?? null, "good", back, { type: "void_restore", refType: "SalesOrder", refId: orderId, refNumber: order.orderNumber, userName: approver, note: "Order voided" });
        left -= back;
      }
    }
    return;
  }
  const legacyBackend = order.lines.some((l) => l.reservedLotNumber);
  if (legacyBackend) {
    const warehouse = await prisma.warehouse.findFirst({ where: { branchId: order.branchId } });
    for (const line of order.lines) {
      const back = line.qtyDelivered ?? 0;
      if (!warehouse || !line.reservedLotNumber || back <= 0) continue;
      const row = await prisma.stockBalance.findFirst({ where: { warehouseId: warehouse.id, productId: line.productId, lotNumber: line.reservedLotNumber } });
      if (row) await addToLot({ locationType: "warehouse", warehouseId: warehouse.id }, line.productId, line.reservedLotNumber, row.expiryDate, "good", back, { type: "void_restore", refType: "SalesOrder", refId: orderId, refNumber: order.orderNumber, userName: approver });
    }
    return;
  }
  const rep = await prisma.user.findUnique({ where: { id: order.salespersonId } });
  const vans = await prisma.van.findMany({ where: { branchId: order.branchId } });
  const van = vans.find((v) => v.assignedUserId === rep?.id) ?? vans.find((v) => v.driverName === rep?.name);
  if (van) {
    for (const line of order.lines) {
      const row = await prisma.stockBalance.findFirst({ where: { locationType: "van", vanId: van.id, productId: line.productId }, orderBy: { qtyGood: "desc" } });
      if (row) await prisma.stockBalance.update({ where: { id: row.id }, data: { qtyGood: row.qtyGood + line.qty } });
    }
  }
}

export async function decideApproval(formData: FormData) {
  await assertCan("sales", "approve");
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision")); // approved | rejected
  const decisionNote = String(formData.get("decisionNote") ?? "");
  const decider = await currentUserName("Supervisor");
  const { role } = await getSession();
  const back = "/supervisor/approvals";

  const request = await prisma.approvalRequest.findUniqueOrThrow({ where: { id } });
  // A decision is final — a replayed submit must not void an order or post a reversal twice.
  if (request.status !== "pending") return;
  if (decider === request.requestedBy && role !== "admin") fail(back, "You raised this request, so another approver must decide it.");

  // Authority levels: bigger amounts escalate to head office.
  const s = await getAllSettings();
  const hoTypes = ((await prisma.appSetting.findUnique({ where: { key: "approval.headOfficeTypes" } }))?.value ?? "").split(",").filter(Boolean);
  if (role !== "admin" && (hoTypes.includes(request.type) || request.level >= 2)) fail(back, request.level >= 2 ? "This request was escalated to head office — an administrator must decide it." : "This kind of request is decided by head office only.");
  if ((request.type === "order_void" || request.type === "order_cancel") && request.amount > num(s, "cancel.supervisorMaxValue") && role !== "admin")
    fail(back, `This ${request.type === "order_void" ? "void" : "cancellation"} exceeds the supervisor's authority (₱${num(s, "cancel.supervisorMaxValue").toLocaleString()}) — head office must approve it.`);
  if (request.type === "discount_override" && request.amount > num(s, "discount.supervisorMaxPct") && role !== "admin")
    fail(back, `A ${request.amount}% discount is above the supervisor limit of ${num(s, "discount.supervisorMaxPct")}% — a sales manager at head office must approve it.`);
  if (request.type === "credit_limit_exception" && request.amount > num(s, "credit.supervisorMaxExcess") && role !== "admin")
    fail(back, `The excess of ₱${request.amount.toLocaleString()} is above the supervisor's credit authority — escalate to the finance / credit approver at head office.`);

  if (request.type === "fin_doc") {
    const doc = request.refId ? await prisma.financialDocument.findUnique({ where: { id: request.refId } }) : null;
    if (doc && (doc.type === "write_off" || doc.amount > num(s, "finance.docSupervisorLimit")) && role !== "admin")
      fail(back, `${doc.type === "write_off" ? "A write-off" : "This amount"} needs head office finance approval — it is beyond the supervisor's authority.`);
  }
  if (request.type === "credit_note" && request.amount > num(s, "creditNote.supervisorLimit") && role !== "admin")
    fail(back, `A credit note of ₱${request.amount.toLocaleString()} is above the supervisor limit of ₱${num(s, "creditNote.supervisorLimit").toLocaleString()} — head office must approve it.`);
  if (request.type === "claim_exception" && request.amount > num(s, "finance.docSupervisorLimit") && role !== "admin")
    fail(back, "This claim exception is above the supervisor's authority — head office must approve it.");

  await prisma.approvalRequest.update({ where: { id }, data: { status: decision, decidedBy: decider, decisionNote, decidedAt: new Date() } });
  await logAudit("ApprovalRequest", id, decision === "approved" ? "approve" : "reject", `${decision === "approved" ? "Approved" : "Rejected"} ${request.type.replace(/_/g, " ")} — ${request.reason.slice(0, 120)}${decisionNote ? ` (${decisionNote})` : ""}`, { before: { status: "pending" }, after: { status: decision } });

  // --- held orders (credit, stock, overdue, duplicate, discount override)
  if (HOLD_TYPES.includes(request.type) && request.salesOrderId) {
    const order = await prisma.salesOrder.findUnique({ where: { id: request.salesOrderId } });
    if (order && ["draft", "on_hold"].includes(order.status)) {
      if (decision === "rejected") {
        await prisma.approvalRequest.updateMany({ where: { salesOrderId: order.id, status: "pending" }, data: { status: "rejected", decidedBy: decider, decisionNote: "Order stopped", decidedAt: new Date() } });
        await performOrderCancellation(order.id, `Rejected by ${decider}${decisionNote ? ` — ${decisionNote}` : ""}`, decider);
        await notify({ userId: order.salespersonId, title: "Order rejected", body: `${order.orderNumber} was rejected${decisionNote ? `: ${decisionNote}` : ""}`, kind: "alert" });
      } else if (order.orderType === "van_sale") {
        const stillPending = await prisma.approvalRequest.count({ where: { salesOrderId: order.id, status: "pending" } });
        if (stillPending === 0) {
          try {
            await completeVanSale(order.id, decider);
          } catch (e) {
            fail(back, e instanceof Error ? e.message : "The van sale could not be completed.");
          }
        }
        await notify({ userId: order.salespersonId, title: "Order approved", body: `${order.orderNumber} was approved and completed`, kind: "info" });
      } else {
        await completeHeldOrder(order.id);
        await notify({ userId: order.salespersonId, title: "Order approved", body: `${order.orderNumber} was released from hold`, kind: "info" });
      }
    }
  }

  // --- cancellation of an allocated / picked order
  if (request.type === "order_cancel" && request.salesOrderId) {
    if (decision === "approved") await performOrderCancellation(request.salesOrderId, request.reason, decider);
  }

  // --- void of an invoiced order: stock and receivable are both reversed
  if (request.type === "order_void" && decision === "approved" && request.salesOrderId) {
    const order = await prisma.salesOrder.findUnique({ where: { id: request.salesOrderId }, include: { invoices: { include: { arLedgerEntries: true } } } });
    if (order && order.status !== "voided") {
      await restoreStockForVoid(order.id, decider);
      await prisma.salesOrder.update({ where: { id: order.id }, data: { status: "voided", voidReason: request.reason } });
      for (const invoice of order.invoices) {
        if (invoice.status === "voided") continue;
        await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "voided" } });
        const net = invoiceBalance(invoice);
        const lastBalance = await outletBalance(order.outletId);
        await prisma.aRLedgerEntry.create({ data: { outletId: order.outletId, invoiceId: invoice.id, type: "void_reversal", amount: -net, balance: lastBalance - net, reference: `VOID-${invoice.invoiceNumber}` } });
      }
      await logAudit("SalesOrder", order.id, "void", `Voided ${order.orderNumber} — ${request.reason}`, { before: { status: order.status }, after: { status: "voided" } });
    }
  }

  // --- AR reversal: an offsetting entry; the original stays in the ledger
  if (request.type === "ar_reversal" && decision === "approved" && request.arLedgerEntryId) {
    const entry = await prisma.aRLedgerEntry.findUnique({ where: { id: request.arLedgerEntryId } });
    if (entry) {
      await prisma.aRLedgerEntry.create({
        data: { outletId: entry.outletId, invoiceId: entry.invoiceId, type: "reversal", amount: -entry.amount, balance: entry.balance + entry.amount, reference: `REV-${entry.reference ?? entry.id}`, recStatus: "matched" },
      });
      await prisma.aRLedgerEntry.update({ where: { id: entry.id }, data: { recStatus: "reversed", paymentStatus: entry.method === "cheque" ? "bounced" : entry.paymentStatus } });
      if (entry.invoiceId && entry.type === "payment") {
        await recomputeInvoiceStatus(entry.invoiceId);
      }
      await logAudit("ARLedgerEntry", entry.id, "reverse", `Reversed ${entry.type} of ₱${entry.amount.toLocaleString()} — ${request.reason}`, { before: { type: entry.type, amount: entry.amount }, after: { type: "reversal", amount: -entry.amount } });
    }
  }

  // --- standing customer discount applies only once approved
  if (request.type === "fixed_discount" && request.refId) {
    const approved = decision === "approved";
    await prisma.pricingRule.update({
      where: { id: request.refId },
      data: { approvalStatus: approved ? "active" : "rejected", status: approved ? "active" : "expired", approvedBy: approved ? decider : null },
    });
    await logAudit("PricingRule", request.refId, approved ? "approve" : "reject", `${approved ? "Approved" : "Rejected"} standing customer discount`, { after: { approvalStatus: approved ? "active" : "rejected" } });
  }

  // --- bad stock back to good: approving performs the move
  if (request.type === "stock_reclass" && request.refId && decision === "approved") {
    const p = JSON.parse(request.payload ?? "{}") as { qty: number; from: "damaged" | "expired" | "quarantine"; to: "good"; reason: string };
    await applyReclass(request.refId, p.qty, p.from, p.to, `${p.reason} (approved by ${decider})`, decider);
  }

  // --- debit note / adjustment / write-off: posts to the ledger only once approved
  if (request.type === "fin_doc" && request.refId) {
    if (decision === "approved") await postFinancialDocument(request.refId, decider, decisionNote);
    else await prisma.financialDocument.update({ where: { id: request.refId }, data: { status: "rejected", approvedBy: decider, decisionNote: decisionNote || null, decidedAt: new Date() } });
    await notify({ role: "supervisor", branchId: request.branchId, title: `Financial document ${decision}`, body: request.reason.slice(0, 120), link: "/supervisor/finance-documents", kind: "info" });
  }

  // --- credit note above the supervisor's limit
  if (request.type === "credit_note" && request.refId) {
    if (decision === "approved") await postCreditNote(request.refId, decider);
    else {
      await prisma.creditNote.update({ where: { id: request.refId }, data: { status: "rejected", approvedBy: decider, decisionNote: decisionNote || null } });
      await prisma.marketReturn.updateMany({ where: { creditNoteId: request.refId }, data: { status: "pending", creditNoteId: null } });
    }
  }

  // --- promotion claim above the eligible amount
  if (request.type === "claim_exception" && request.refId) {
    const claim = await prisma.claim.findUnique({ where: { id: request.refId } });
    if (claim && claim.status === "draft") {
      if (decision === "approved") {
        await prisma.claim.update({ where: { id: claim.id }, data: { exceptionApproved: true } });
        await prisma.claimStatusHistory.create({ data: { claimId: claim.id, status: "draft", changedBy: decider, reason: `Exception approved${decisionNote ? `: ${decisionNote}` : ""} — ready to submit` } });
      } else {
        await prisma.claim.update({ where: { id: claim.id }, data: { status: "rejected" } });
        await prisma.claimStatusHistory.create({ data: { claimId: claim.id, status: "rejected", changedBy: decider, reason: `Exception declined${decisionNote ? `: ${decisionNote}` : ""}` } });
      }
      await notify({ userId: claim.submittedById, title: `Claim exception ${decision}`, body: claim.claimNumber, link: `/supervisor/claims/${claim.id}`, kind: decision === "approved" ? "info" : "alert" });
    }
  }

  // --- field exceptions raised by the SFA app
  if (request.type === "return_outside_policy" && request.refId && decision === "rejected") {
    await prisma.marketReturn.update({ where: { id: request.refId }, data: { status: "rejected" } });
  }
  if (request.type === "return_outside_policy" || request.type === "out_of_route_visit") {
    const rep = await prisma.user.findFirst({ where: { name: request.requestedBy } });
    if (rep) await notify({ userId: rep.id, title: `${request.type === "out_of_route_visit" ? "Out-of-route visit" : "Return exception"} ${decision}`, body: decisionNote || request.reason.slice(0, 100), link: "/sfa", kind: decision === "approved" ? "info" : "alert" });
  }

  // --- cheque that bounced after clearing: reverse the payments
  if (request.type === "cheque_bounce" && request.refId && request.outletId && decision === "approved") {
    const p = JSON.parse(request.payload ?? "{}") as { reason?: string };
    await applyChequeBounce(request.outletId, request.refId, p.reason ?? "Returned by the bank");
  }

  revalidatePath("/supervisor/approvals");
  revalidatePath("/supervisor/finance-documents");
  revalidatePath("/supervisor/claims");
  revalidatePath("/supervisor/credit");
  revalidatePath("/supervisor/payment-reconciliation");
  revalidatePath("/supervisor/ar-aging");
  revalidatePath("/supervisor/orders");
  revalidatePath("/branch/picklists");
  redirect(back);
}

// A posted payment or credit note is locked like any other financial document — correcting it
// means a supervisor-approved reversal, never quietly editing the figure.
export async function requestArReversal(formData: FormData) {
  const arLedgerEntryId = String(formData.get("arLedgerEntryId"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return;
  const entry = await prisma.aRLedgerEntry.findUniqueOrThrow({ where: { id: arLedgerEntryId } });
  const requester = await currentUserName("Supervisor");
  await prisma.approvalRequest.create({ data: { type: "ar_reversal", arLedgerEntryId, requestedBy: requester, amount: entry.amount, reason, status: "pending", outletId: entry.outletId } });
  await logAudit("ARLedgerEntry", arLedgerEntryId, "reverse_request", `Requested reversal of ${entry.type} ₱${entry.amount.toLocaleString()} — ${reason}`);
  revalidatePath("/supervisor/payment-reconciliation");
  redirect("/supervisor/approvals?reversal=submitted");
}

// Void request on an already-invoiced order: once invoiced the order is locked; a void needs approval.
export async function requestOrderVoid(formData: FormData) {
  await assertCan("sales", "edit");
  const salesOrderId = String(formData.get("salesOrderId"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return;
  const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: salesOrderId } });
  const requester = await currentUserName("Supervisor");
  const dup = await prisma.approvalRequest.count({ where: { salesOrderId, type: "order_void", status: "pending" } });
  if (!dup) {
    await prisma.approvalRequest.create({ data: { type: "order_void", salesOrderId, requestedBy: requester, amount: order.total, reason, status: "pending", branchId: order.branchId, outletId: order.outletId } });
    await logAudit("SalesOrder", salesOrderId, "void_request", `Requested void of ${order.orderNumber} — ${reason}`);
    await notify({ role: "supervisor", branchId: order.branchId, title: "Void request awaiting approval", body: `${order.orderNumber}: ${reason}`, link: "/supervisor/approvals", kind: "approval" });
  }
  revalidatePath("/supervisor/orders");
  redirect("/supervisor/approvals");
}

// Settling a market return raises a credit note: within the supervisor's limit it posts at once, above it the
// note waits for head office approval. The amount can be reduced (partial credit) but never raised.
export async function processMarketReturn(formData: FormData) {
  await assertCan("finance", "edit");
  const marketReturnId = String(formData.get("marketReturnId"));
  const marketReturn = await prisma.marketReturn.findUniqueOrThrow({ where: { id: marketReturnId }, include: { product: true } });
  if (marketReturn.status !== "pending") redirect("/supervisor/market-returns");
  if (marketReturn.outsidePolicy) {
    const ok = await prisma.approvalRequest.findFirst({ where: { type: "return_outside_policy", refId: marketReturnId, status: "approved" } });
    if (!ok) redirect(`/supervisor/market-returns?error=${encodeURIComponent("This return is outside the return policy — approve the exception in Approvals before issuing a credit note.")}`);
  }
  const full = marketReturn.product.unitPrice * marketReturn.qty;
  const asked = Number(formData.get("amount") ?? full);
  const amount = Math.min(full, Number.isFinite(asked) && asked > 0 ? asked : full);
  const { note, needsApproval } = await createCreditNote({ outletId: marketReturn.outletId, invoiceId: marketReturn.invoiceId, amount, reason: `Market return: ${marketReturn.reason.replace(/_/g, " ")}${marketReturn.outsidePolicy ? " (outside return policy)" : ""}` });
  await prisma.marketReturn.update({ where: { id: marketReturnId }, data: { status: "processed", creditNoteId: note.id } });
  revalidatePath("/supervisor/market-returns");
  redirect(`/supervisor/market-returns?notice=${encodeURIComponent(needsApproval ? `Credit note ${note.noteNumber} is above your limit and has gone to head office for approval.` : `Credit note ${note.noteNumber} issued.`)}`);
}

// A supervisor who cannot or should not decide a request passes it up to head office.
export async function escalateApproval(formData: FormData) {
  await assertCan("sales", "approve");
  const id = String(formData.get("id"));
  const note = String(formData.get("note") ?? "").trim();
  const req = await prisma.approvalRequest.findUniqueOrThrow({ where: { id } });
  if (req.status !== "pending") redirect("/supervisor/approvals");
  if (req.level >= 2) redirect(`/supervisor/approvals?error=${encodeURIComponent("Already escalated to head office.")}`);
  const by = await currentUserName("Supervisor");
  await prisma.approvalRequest.update({ where: { id }, data: { level: 2, reason: `${req.reason} — escalated by ${by}${note ? `: ${note}` : ""}` } });
  await logAudit("ApprovalRequest", id, "escalate", `Escalated ${req.type.replace(/_/g, " ")} to head office${note ? ` — ${note}` : ""}`);
  await notify({ role: "admin", title: "Escalated approval", body: `${req.type.replace(/_/g, " ")} — ${req.reason.slice(0, 100)}`, link: "/supervisor/approvals", kind: "approval" });
  revalidatePath("/supervisor/approvals");
  redirect(`/supervisor/approvals?notice=${encodeURIComponent("Escalated to head office.")}`);
}
