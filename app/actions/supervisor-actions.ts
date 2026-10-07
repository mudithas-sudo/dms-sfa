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
import { dueDateFor, nextInvoiceNumber, outletPosition } from "@/lib/orders";
import { addToLot } from "@/lib/stock";

async function currentUserName(fallback: string) {
  const { userId } = await getSession();
  return userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? fallback : fallback;
}

function fail(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
}

const HOLD_TYPES = ["credit_limit_exception", "stock_shortage", "overdue_balance", "duplicate_order", "discount_override"];

// An SFA van-sale held for an exception completes straight after approval: van stock falls, invoice and delivery are issued.
async function completeVanSale(orderId: string) {
  const order = await prisma.salesOrder.findUnique({ where: { id: orderId }, include: { lines: true, outlet: true } });
  if (!order || !["draft", "on_hold"].includes(order.status)) return;
  const rep = await prisma.user.findUnique({ where: { id: order.salespersonId } });
  const vans = await prisma.van.findMany({ where: { branchId: order.branchId } });
  const van = vans.find((v) => v.assignedUserId === rep?.id) ?? vans.find((v) => v.driverName === rep?.name);
  if (van) {
    for (const line of order.lines) {
      const row = await prisma.stockBalance.findFirst({ where: { locationType: "van", vanId: van.id, productId: line.productId }, orderBy: { qtyGood: "desc" } });
      if (row) await prisma.stockBalance.update({ where: { id: row.id }, data: { qtyGood: Math.max(0, row.qtyGood - line.qty) } });
    }
  }
  const pos = await outletPosition(order.outletId);
  const { seq, number } = await nextInvoiceNumber(order.branchId);
  const invoice = await prisma.invoice.create({
    data: { invoiceNumber: number, branchSeq: seq, salesOrderId: order.id, outletId: order.outletId, branchId: order.branchId, dueDate: dueDateFor(order.paymentTerms ?? order.outlet.paymentTerms), amount: order.total, status: "unpaid" },
  });
  for (const line of order.lines) {
    await prisma.invoiceLine.create({ data: { invoiceId: invoice.id, productId: line.productId, qty: line.qty, unitPrice: line.unitPrice, lineTotal: line.lineTotal } });
  }
  const drCount = await prisma.deliveryReceipt.count();
  await prisma.deliveryReceipt.create({ data: { drNumber: `DR-${String(drCount + 1).padStart(6, "0")}`, invoiceId: invoice.id, receivedBy: `${order.outlet.name} staff`, status: "delivered" } });
  await prisma.aRLedgerEntry.create({ data: { outletId: order.outletId, invoiceId: invoice.id, type: "invoice", amount: order.total, balance: pos.outstanding + order.total, reference: invoice.invoiceNumber } });
  await prisma.salesOrder.update({ where: { id: order.id }, data: { status: "delivered", creditHoldReason: null } });
  await logAudit("SalesOrder", order.id, "release", `Completed ${order.orderNumber} after the exception was approved`);
}

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
  if ((request.type === "order_void" || request.type === "order_cancel") && request.amount > num(s, "cancel.supervisorMaxValue") && role !== "admin")
    fail(back, `This ${request.type === "order_void" ? "void" : "cancellation"} exceeds the supervisor's authority (₱${num(s, "cancel.supervisorMaxValue").toLocaleString()}) — head office must approve it.`);
  if (request.type === "discount_override" && request.amount > num(s, "discount.supervisorMaxPct") && role !== "admin")
    fail(back, `A ${request.amount}% discount is above the supervisor limit of ${num(s, "discount.supervisorMaxPct")}% — a sales manager at head office must approve it.`);
  if (request.type === "credit_limit_exception" && request.amount > num(s, "credit.supervisorMaxExcess") && role !== "admin")
    fail(back, `The excess of ₱${request.amount.toLocaleString()} is above the supervisor's credit authority — escalate to the finance / credit approver at head office.`);

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
        if (stillPending === 0) await completeVanSale(order.id);
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
        const net = invoice.arLedgerEntries.reduce((sum, e) => sum + (e.type === "invoice" ? e.amount : e.type === "payment" ? -e.amount : e.type === "adjustment" ? e.amount : 0), 0);
        const lastBalance = invoice.arLedgerEntries.at(-1)?.balance ?? invoice.amount;
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
        const invoice = await prisma.invoice.findUnique({ where: { id: entry.invoiceId }, include: { arLedgerEntries: true } });
        if (invoice) {
          const paidNow = invoice.arLedgerEntries.filter((e) => e.type === "payment" && e.id !== entry.id && e.recStatus !== "reversed").reduce((sum, e) => sum + e.amount, 0);
          await prisma.invoice.update({ where: { id: invoice.id }, data: { status: paidNow <= 0 ? "unpaid" : paidNow < invoice.amount ? "partially_paid" : "paid" } });
        }
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

  revalidatePath("/supervisor/approvals");
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

// Settling a market return issues a credit note, which posts a negative AR ledger entry.
export async function processMarketReturn(formData: FormData) {
  const marketReturnId = String(formData.get("marketReturnId"));
  const issuer = await currentUserName("Supervisor");
  const marketReturn = await prisma.marketReturn.findUniqueOrThrow({ where: { id: marketReturnId }, include: { product: true } });
  const amount = marketReturn.product.unitPrice * marketReturn.qty;
  const noteCount = await prisma.creditNote.count();
  const creditNote = await prisma.creditNote.create({
    data: { noteNumber: `CN-${String(noteCount + 1).padStart(4, "0")}`, outletId: marketReturn.outletId, amount, reason: `Market return: ${marketReturn.reason}`, issuedBy: issuer },
  });
  await prisma.marketReturn.update({ where: { id: marketReturnId }, data: { status: "processed", creditNoteId: creditNote.id } });
  const pos = await outletPosition(marketReturn.outletId);
  await prisma.aRLedgerEntry.create({ data: { outletId: marketReturn.outletId, type: "credit_note", amount: -amount, balance: pos.outstanding - amount, reference: creditNote.noteNumber } });
  revalidatePath("/supervisor/market-returns");
}

export async function decideClaim(formData: FormData) {
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision"));
  const reason = String(formData.get("reason") ?? "");
  const decider = await currentUserName("Supervisor");
  await prisma.claim.update({ where: { id }, data: { status: decision } });
  await prisma.claimStatusHistory.create({ data: { claimId: id, status: decision, changedBy: decider, reason: reason || null } });
  revalidatePath("/supervisor/claims");
  revalidatePath(`/supervisor/claims/${id}`);
}

// Manually match a lump-sum payment against one or more specific invoices.
export async function reconcilePayment(formData: FormData) {
  const outletId = String(formData.get("outletId"));
  const method = String(formData.get("method"));
  const reference = String(formData.get("reference") ?? "");
  const invoiceIds = formData.getAll("invoiceId").map(String);
  const invoices = await prisma.invoice.findMany({ where: { id: { in: invoiceIds } }, include: { arLedgerEntries: true } });
  let runningBalance = (await outletPosition(outletId)).outstanding;
  for (const invoice of invoices) {
    const amount = Number(formData.get(`amount_${invoice.id}`) ?? 0);
    if (amount <= 0) continue;
    const alreadyPaid = invoice.arLedgerEntries.filter((e) => e.type === "payment").reduce((s, e) => s + e.amount, 0);
    const outstanding = invoice.amount - alreadyPaid;
    const applied = Math.min(amount, outstanding);
    runningBalance -= applied;
    await prisma.aRLedgerEntry.create({ data: { outletId, invoiceId: invoice.id, type: "payment", method, amount: applied, balance: runningBalance, reference: reference || undefined } });
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: applied >= outstanding ? "paid" : "partially_paid" } });
  }
  revalidatePath("/supervisor/payment-reconciliation");
  redirect("/supervisor/payment-reconciliation");
}
