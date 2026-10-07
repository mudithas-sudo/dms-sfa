"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { applyReclass } from "@/app/actions/inventory-actions";
import { priceOrder, type PricedLine } from "@/lib/pricing";

async function currentUserName(fallback: string) {
  const { userId } = await getSession();
  return userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? fallback : fallback;
}

async function outletOutstandingBalance(outletId: string): Promise<number> {
  const invoices = await prisma.invoice.findMany({
    where: { outletId, status: { in: ["unpaid", "partially_paid", "overdue"] } },
    include: { arLedgerEntries: true },
  });
  return invoices.reduce((sum, inv) => {
    const paid = inv.arLedgerEntries.filter((e) => e.type === "payment").reduce((s, e) => s + e.amount, 0);
    return sum + (inv.amount - paid);
  }, 0);
}

export async function decideApproval(formData: FormData) {
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision")); // approved | rejected
  const decisionNote = String(formData.get("decisionNote") ?? "");
  const decider = await currentUserName("Supervisor");

  const request = await prisma.approvalRequest.findUniqueOrThrow({ where: { id } });
  // A decision is final — a replayed submit (double-click, browser back)
  // must not void an order or post a reversal a second time.
  if (request.status !== "pending") return;

  await prisma.approvalRequest.update({
    where: { id },
    data: { status: decision, decidedBy: decider, decisionNote, decidedAt: new Date() },
  });

  // Approving an order-void request actually performs the void: mark the
  // order/invoice voided and reverse the AR — the original stays visible,
  // just flagged "Voided", rather than being deleted.
  if (request.type === "order_void" && decision === "approved" && request.salesOrderId) {
    const order = await prisma.salesOrder.findUnique({
      where: { id: request.salesOrderId },
      include: { lines: true, invoices: { include: { arLedgerEntries: true } } },
    });
    if (order && order.status !== "voided") {
      await prisma.salesOrder.update({ where: { id: order.id }, data: { status: "voided", voidReason: request.reason } });

      // Reverse the stock impact too, not just the money: a delivered order's
      // units go back where they came from — the warehouse lot for a backend
      // order (only what was actually delivered), or the rep's van for a
      // field van-sale. An order that never delivered never moved any stock.
      if (order.status === "delivered") {
        const creator = await prisma.user.findUnique({ where: { id: order.salespersonId } });
        if (creator ? creator.role !== "sales_rep" : order.lines.some((l) => l.reservedLotNumber)) {
          const warehouse = await prisma.warehouse.findFirst({ where: { branchId: order.branchId } });
          for (const line of order.lines) {
            const returned = line.qtyDelivered ?? 0;
            if (!warehouse || !line.reservedLotNumber || returned <= 0) continue;
            const row = await prisma.stockBalance.findFirst({
              where: { warehouseId: warehouse.id, productId: line.productId, lotNumber: line.reservedLotNumber },
            });
            if (row) await prisma.stockBalance.update({ where: { id: row.id }, data: { qtyGood: row.qtyGood + returned } });
          }
        } else {
          const rep = await prisma.user.findUnique({ where: { id: order.salespersonId } });
          const vans = await prisma.van.findMany({ where: { branchId: order.branchId } });
          const van = vans.find((v) => v.assignedUserId === rep?.id) ?? vans.find((v) => v.driverName === rep?.name);
          if (van) {
            for (const line of order.lines) {
              const row = await prisma.stockBalance.findFirst({
                where: { locationType: "van", vanId: van.id, productId: line.productId },
                orderBy: { qtyGood: "desc" },
              });
              if (row) await prisma.stockBalance.update({ where: { id: row.id }, data: { qtyGood: row.qtyGood + line.qty } });
            }
          }
        }
      }
      for (const invoice of order.invoices) {
        if (invoice.status === "voided") continue;
        await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "voided" } });
        const paid = invoice.arLedgerEntries.reduce((s, e) => s + (e.type === "invoice" ? e.amount : e.type === "payment" ? -e.amount : 0), 0);
        const lastBalance = invoice.arLedgerEntries.at(-1)?.balance ?? invoice.amount;
        await prisma.aRLedgerEntry.create({
          data: {
            outletId: order.outletId,
            invoiceId: invoice.id,
            type: "void_reversal",
            amount: -paid,
            balance: lastBalance - paid,
            reference: `VOID-${invoice.invoiceNumber}`,
          },
        });
      }
      await prisma.auditLog.create({
        data: {
          entity: "SalesOrder",
          entityId: order.id,
          action: "void",
          userId: (await getSession()).userId ?? "",
          summary: `Voided ${order.orderNumber} — ${request.reason}`,
          beforeData: JSON.stringify({ status: order.status }),
          afterData: JSON.stringify({ status: "voided" }),
        },
      });
    }
  }

  // Approving a credit-limit or stock-shortage exception is what actually
  // lets the held order proceed — without this, the order would sit in
  // "draft" forever even after the exception is approved. A backend order
  // (its lines already carry a reservedLotNumber picked at entry time) just
  // needs the reservation applied and moves to "confirmed" for fulfillment;
  // an SFA van-sale order completes immediately, the same way an
  // auto-approved order does.
  if ((request.type === "credit_limit_exception" || request.type === "stock_shortage") && decision === "approved" && request.salesOrderId) {
    const order = await prisma.salesOrder.findUnique({
      where: { id: request.salesOrderId },
      include: { lines: true, outlet: true },
    });
    if (order && order.status === "draft") {
      // A backend order is identified by who entered it, not by its lot
      // picks — an order held for a stock shortage may have no lot at all.
      const creator = await prisma.user.findUnique({ where: { id: order.salespersonId } });
      const isBackendOrder = creator ? creator.role !== "sales_rep" : order.lines.some((l) => l.reservedLotNumber);

      if (isBackendOrder) {
        const warehouse = await prisma.warehouse.findFirst({ where: { branchId: order.branchId } });
        for (const line of order.lines) {
          if (!line.reservedLotNumber || !warehouse) continue;
          const row = await prisma.stockBalance.findFirst({
            where: { warehouseId: warehouse.id, productId: line.productId, lotNumber: line.reservedLotNumber },
          });
          if (row) await prisma.stockBalance.update({ where: { id: row.id }, data: { qtyReserved: row.qtyReserved + line.qty } });
        }
        await prisma.salesOrder.update({ where: { id: order.id }, data: { status: "confirmed", creditHoldReason: null } });
      } else {
        const rep = await prisma.user.findUnique({ where: { id: order.salespersonId } });
        const vans = rep ? await prisma.van.findMany({ where: { branchId: order.branchId } }) : [];
        const van = vans.find((v) => v.assignedUserId === rep?.id) ?? vans.find((v) => v.driverName === rep?.name);
        if (van) {
          for (const line of order.lines) {
            const vanStock = await prisma.stockBalance.findFirst({
              where: { locationType: "van", vanId: van.id, productId: line.productId },
              orderBy: { qtyGood: "desc" },
            });
            if (vanStock) {
              await prisma.stockBalance.update({ where: { id: vanStock.id }, data: { qtyGood: Math.max(0, vanStock.qtyGood - line.qty) } });
            }
          }
        }

        const invoiceCount = await prisma.invoice.count();
        const invoice = await prisma.invoice.create({
          data: {
            invoiceNumber: `INV-${String(invoiceCount + 1).padStart(6, "0")}`,
            salesOrderId: order.id,
            outletId: order.outletId,
            branchId: order.branchId,
            dueDate: new Date(Date.now() + 30 * 86400000),
            amount: order.total,
            status: "unpaid",
          },
        });
        for (const line of order.lines) {
          await prisma.invoiceLine.create({
            data: { invoiceId: invoice.id, productId: line.productId, qty: line.qty, unitPrice: line.unitPrice, lineTotal: line.lineTotal },
          });
        }

        const drCount = await prisma.deliveryReceipt.count();
        await prisma.deliveryReceipt.create({
          data: { drNumber: `DR-${String(drCount + 1).padStart(6, "0")}`, invoiceId: invoice.id, receivedBy: `${order.outlet.name} staff`, status: "delivered" },
        });

        const outstanding = await outletOutstandingBalance(order.outletId);
        await prisma.aRLedgerEntry.create({
          data: {
            outletId: order.outletId,
            invoiceId: invoice.id,
            type: "invoice",
            amount: order.total,
            balance: outstanding + order.total,
            reference: invoice.invoiceNumber,
          },
        });

        await prisma.salesOrder.update({ where: { id: order.id }, data: { status: "delivered", creditHoldReason: null } });
      }
    }
  }

  // Approving an AR reversal actually posts the reversal: an offsetting
  // ledger entry, and — for a reversed payment — the invoice status rolled
  // back to reflect that the payment no longer applies. The original entry
  // stays in the ledger, just superseded, consistent with no-hard-delete.
  if (request.type === "ar_reversal" && decision === "approved" && request.arLedgerEntryId) {
    const entry = await prisma.aRLedgerEntry.findUnique({ where: { id: request.arLedgerEntryId } });
    if (entry) {
      await prisma.aRLedgerEntry.create({
        data: {
          outletId: entry.outletId,
          invoiceId: entry.invoiceId,
          type: "reversal",
          amount: -entry.amount,
          balance: entry.balance + entry.amount,
          reference: `REV-${entry.reference ?? entry.id}`,
        },
      });

      if (entry.invoiceId && entry.type === "payment") {
        const invoice = await prisma.invoice.findUnique({ where: { id: entry.invoiceId }, include: { arLedgerEntries: true } });
        if (invoice) {
          const paidNow = invoice.arLedgerEntries
            .filter((e) => e.type === "payment" && e.id !== entry.id)
            .reduce((s, e) => s + e.amount, 0);
          await prisma.invoice.update({
            where: { id: invoice.id },
            data: { status: paidNow <= 0 ? "unpaid" : paidNow < invoice.amount ? "partially_paid" : "paid" },
          });
        }
      }

      await prisma.auditLog.create({
        data: {
          entity: "ARLedgerEntry",
          entityId: entry.id,
          action: "reverse",
          userId: (await getSession()).userId ?? "",
          summary: `Reversed ${entry.type} of ₱${entry.amount.toLocaleString()} — ${request.reason}`,
          beforeData: JSON.stringify({ type: entry.type, amount: entry.amount }),
          afterData: JSON.stringify({ type: "reversal", amount: -entry.amount }),
        },
      });
    }
  }

  // Standing customer discount: it applies to orders only once approved.
  if (request.type === "fixed_discount" && request.refId) {
    const approved = decision === "approved";
    await prisma.pricingRule.update({
      where: { id: request.refId },
      data: { approvalStatus: approved ? "active" : "rejected", status: approved ? "active" : "expired", approvedBy: approved ? decider : null },
    });
    await logAudit("PricingRule", request.refId, approved ? "approve" : "reject", `${approved ? "Approved" : "Rejected"} standing customer discount`, { after: { approvalStatus: approved ? "active" : "rejected" } });
  }

  // Moving bad stock back to good needs supervisor approval; approving performs the move.
  if (request.type === "stock_reclass" && request.refId && decision === "approved") {
    const p = JSON.parse(request.payload ?? "{}") as { qty: number; from: "damaged" | "expired" | "quarantine"; to: "good"; reason: string };
    await applyReclass(request.refId, p.qty, p.from, p.to, `${p.reason} (approved by ${decider})`, decider);
  }

  revalidatePath("/supervisor/approvals");
  revalidatePath("/supervisor/payment-reconciliation");
  revalidatePath("/supervisor/ar-aging");
  revalidatePath("/supervisor/orders");
}

// A posted payment or credit note is locked like any other financial
// document — correcting it means a supervisor-approved reversal, not
// quietly editing the figure, consistent with the platform's
// no-hard-delete governance.
export async function requestArReversal(formData: FormData) {
  const arLedgerEntryId = String(formData.get("arLedgerEntryId"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return;

  const entry = await prisma.aRLedgerEntry.findUniqueOrThrow({ where: { id: arLedgerEntryId } });
  const requester = await currentUserName("Supervisor");

  await prisma.approvalRequest.create({
    data: {
      type: "ar_reversal",
      arLedgerEntryId,
      requestedBy: requester,
      amount: entry.amount,
      reason,
      status: "pending",
    },
  });

  revalidatePath("/supervisor/payment-reconciliation");
  redirect("/supervisor/approvals?reversal=submitted");
}

// Supervisor-initiated void request on an already-invoiced order. Once
// invoiced, the order can no longer be edited directly — a void must go
// through approval, matching the "no hard delete" policy.
export async function requestOrderVoid(formData: FormData) {
  const salesOrderId = String(formData.get("salesOrderId"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return;

  const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: salesOrderId } });
  const requester = await currentUserName("Supervisor");

  await prisma.approvalRequest.create({
    data: {
      type: "order_void",
      salesOrderId,
      requestedBy: requester,
      amount: order.total,
      reason,
      status: "pending",
    },
  });

  revalidatePath("/supervisor/orders");
  redirect("/supervisor/approvals");
}

// Settling a market return issues a credit note, which posts a negative AR
// ledger entry — reducing the outlet's balance, visible in DMS AR.
export async function processMarketReturn(formData: FormData) {
  const marketReturnId = String(formData.get("marketReturnId"));
  const issuer = await currentUserName("Supervisor");

  const marketReturn = await prisma.marketReturn.findUniqueOrThrow({ where: { id: marketReturnId }, include: { product: true } });
  const amount = marketReturn.product.unitPrice * marketReturn.qty;

  const noteCount = await prisma.creditNote.count();
  const creditNote = await prisma.creditNote.create({
    data: {
      noteNumber: `CN-${String(noteCount + 1).padStart(4, "0")}`,
      outletId: marketReturn.outletId,
      amount,
      reason: `Market return: ${marketReturn.reason}`,
      issuedBy: issuer,
    },
  });

  await prisma.marketReturn.update({ where: { id: marketReturnId }, data: { status: "processed", creditNoteId: creditNote.id } });

  const invoices = await prisma.invoice.findMany({
    where: { outletId: marketReturn.outletId, status: { in: ["unpaid", "partially_paid", "overdue"] } },
    include: { arLedgerEntries: true },
  });
  const outstanding = invoices.reduce((sum, inv) => {
    const paid = inv.arLedgerEntries.filter((e) => e.type === "payment").reduce((s, e) => s + e.amount, 0);
    return sum + (inv.amount - paid);
  }, 0);

  await prisma.aRLedgerEntry.create({
    data: {
      outletId: marketReturn.outletId,
      type: "credit_note",
      amount: -amount,
      balance: outstanding - amount,
      reference: creditNote.noteNumber,
    },
  });

  revalidatePath("/supervisor/market-returns");
}

export async function decideClaim(formData: FormData) {
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision")); // reviewed | approved | rejected | settled
  const reason = String(formData.get("reason") ?? "");
  const decider = await currentUserName("Supervisor");

  await prisma.claim.update({ where: { id }, data: { status: decision } });
  await prisma.claimStatusHistory.create({
    data: { claimId: id, status: decision, changedBy: decider, reason: reason || null },
  });

  revalidatePath("/supervisor/claims");
  revalidatePath(`/supervisor/claims/${id}`);
}

// Manually match a lump-sum payment against one or more specific invoices,
// rather than the SFA app's automatic oldest-first allocation.
export async function reconcilePayment(formData: FormData) {
  const outletId = String(formData.get("outletId"));
  const method = String(formData.get("method"));
  const reference = String(formData.get("reference") ?? "");
  const invoiceIds = formData.getAll("invoiceId").map(String);

  const invoices = await prisma.invoice.findMany({
    where: { id: { in: invoiceIds } },
    include: { arLedgerEntries: true },
  });

  let runningBalance = 0;
  const outstandingByOutlet = await prisma.invoice.findMany({
    where: { outletId, status: { in: ["unpaid", "partially_paid", "overdue"] } },
    include: { arLedgerEntries: true },
  });
  runningBalance = outstandingByOutlet.reduce((sum, inv) => {
    const paid = inv.arLedgerEntries.filter((e) => e.type === "payment").reduce((s, e) => s + e.amount, 0);
    return sum + (inv.amount - paid);
  }, 0);

  for (const invoice of invoices) {
    const amountRaw = formData.get(`amount_${invoice.id}`);
    const amount = Number(amountRaw ?? 0);
    if (amount <= 0) continue;

    const alreadyPaid = invoice.arLedgerEntries.filter((e) => e.type === "payment").reduce((s, e) => s + e.amount, 0);
    const outstanding = invoice.amount - alreadyPaid;
    const applied = Math.min(amount, outstanding);
    runningBalance -= applied;

    await prisma.aRLedgerEntry.create({
      data: {
        outletId,
        invoiceId: invoice.id,
        type: "payment",
        method,
        amount: applied,
        balance: runningBalance,
        reference: reference || undefined,
      },
    });
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: applied >= outstanding ? "paid" : "partially_paid" },
    });
  }

  revalidatePath("/supervisor/payment-reconciliation");
  redirect("/supervisor/payment-reconciliation");
}

// ---------------------------------------------------------------------------
// Backend order entry (phone / walk-in business, entered directly by branch
// staff) — lands in the same order-processing path as field orders, through
// the identical validation engine, but goes through allocation (a reserved
// FEFO lot per line) and a separate fulfillment step rather than the SFA
// app's instant van-sale delivery.
// ---------------------------------------------------------------------------

export async function createBackendOrder(formData: FormData) {
  const outletId = String(formData.get("outletId"));
  const { branchId, userId } = await getSession();
  if (!branchId || !userId) return;
  const requester = await currentUserName("Supervisor");

  const outlet = await prisma.outlet.findUniqueOrThrow({ where: { id: outletId } });
  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
  if (branch.status === "inactive" || outlet.status === "inactive") return;

  const warehouse = await prisma.warehouse.findFirst({ where: { branchId } });
  if (!warehouse) return;

  const products = await prisma.product.findMany({ where: { status: "active" } });
  const items = products
    .map((p) => ({ productId: p.id, qty: Number(formData.get(`qty_${p.id}`) ?? 0) }))
    .filter((i) => i.qty > 0);
  if (items.length === 0) return;

  // Same pricing/promotion engine as the SFA order path � a backend order
  // and a field order never see different prices for the same customer.
  const priced = await priceOrder(outletId, items);
  const { subtotal, discountTotal, total } = priced;

  // Allocation: pick the FEFO lot (earliest expiry first) with enough
  // available (good minus already-reserved) stock to cover each line.
  const shortages: string[] = [];
  const lineData: (PricedLine & { reservedLotNumber?: string })[] = [];
  for (const line of priced.lines) {
    const stockRows = await prisma.stockBalance.findMany({ where: { warehouseId: warehouse.id, productId: line.productId } });
    const sorted = [...stockRows].sort((a, b) => {
      if (a.expiryDate && b.expiryDate) return a.expiryDate.getTime() - b.expiryDate.getTime();
      if (a.expiryDate) return -1;
      if (b.expiryDate) return 1;
      return 0;
    });
    const pickedLot = sorted.find((r) => r.qtyGood - r.qtyReserved >= line.qty);
    if (!pickedLot) shortages.push(products.find((p) => p.id === line.productId)?.name ?? line.productId);
    lineData.push({ ...line, reservedLotNumber: pickedLot?.lotNumber });
  }

  if (lineData.length === 0) return;
  const outstanding = await outletOutstandingBalance(outletId);
  const exceedsCreditLimit = outstanding + total > outlet.creditLimit;

  const orderCount = await prisma.salesOrder.count();
  const order = await prisma.salesOrder.create({
    data: {
      orderNumber: `SO-${String(orderCount + 1).padStart(6, "0")}`,
      outletId,
      branchId,
      salespersonId: userId,
      status: exceedsCreditLimit || shortages.length > 0 ? "draft" : "confirmed",
      subtotal,
      discountTotal,
      total,
      creditHoldReason: exceedsCreditLimit
        ? `Order total pushes outstanding balance to ₱${(outstanding + total).toLocaleString()}, exceeding credit limit of ₱${outlet.creditLimit.toLocaleString()}`
        : null,
    },
  });

  for (const line of lineData) {
    await prisma.salesOrderLine.create({ data: { salesOrderId: order.id, ...line } });
  }

  if (exceedsCreditLimit) {
    await prisma.approvalRequest.create({
      data: {
        type: "credit_limit_exception",
        salesOrderId: order.id,
        requestedBy: requester,
        amount: outstanding + total - outlet.creditLimit,
        reason: `${outlet.name}: order total ₱${total.toLocaleString()} would exceed credit limit${
          shortages.length > 0 ? ` (also short on stock: ${shortages.join(", ")})` : ""
        }`,
        status: "pending",
      },
    });
    revalidatePath("/supervisor/orders");
    redirect(`/supervisor/orders/${order.id}`);
  }

  if (shortages.length > 0) {
    await prisma.approvalRequest.create({
      data: {
        type: "stock_shortage",
        salesOrderId: order.id,
        requestedBy: requester,
        amount: total,
        reason: `Insufficient available warehouse stock for: ${shortages.join(", ")}`,
        status: "pending",
      },
    });
    revalidatePath("/supervisor/orders");
    redirect(`/supervisor/orders/${order.id}`);
  }

  // Reserve the picked lots so this stock can't also be picked for another
  // order while this one is awaiting fulfillment.
  for (const line of lineData) {
    if (!line.reservedLotNumber) continue;
    const row = await prisma.stockBalance.findFirst({
      where: { warehouseId: warehouse.id, productId: line.productId, lotNumber: line.reservedLotNumber },
    });
    if (row) await prisma.stockBalance.update({ where: { id: row.id }, data: { qtyReserved: row.qtyReserved + line.qty } });
  }

  revalidatePath("/supervisor/orders");
  redirect(`/supervisor/orders/${order.id}`);
}

// Fulfillment records what was actually delivered — which may be less than
// what was ordered. The shortfall stays visible per line rather than the
// order being silently marked "delivered in full".
export async function fulfillOrder(formData: FormData) {
  const orderId = String(formData.get("orderId"));
  const receivedBy = String(formData.get("receivedBy") ?? "").trim() || "Outlet staff";

  const order = await prisma.salesOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: { lines: true },
  });
  if (order.status !== "confirmed") return;

  const warehouse = await prisma.warehouse.findFirst({ where: { branchId: order.branchId } });

  let invoiceAmount = 0;
  let anyShortfall = false;
  const deliveredLines: { productId: string; qty: number; unitPrice: number; lineTotal: number }[] = [];

  for (const line of order.lines) {
    const deliveredRaw = formData.get(`delivered_${line.id}`);
    const qtyDelivered = Math.min(line.qty, Math.max(0, Number(deliveredRaw ?? line.qty)));
    if (qtyDelivered < line.qty) anyShortfall = true;

    await prisma.salesOrderLine.update({ where: { id: line.id }, data: { qtyDelivered } });

    if (line.reservedLotNumber && warehouse) {
      const row = await prisma.stockBalance.findFirst({
        where: { warehouseId: warehouse.id, productId: line.productId, lotNumber: line.reservedLotNumber },
      });
      if (row) {
        await prisma.stockBalance.update({
          where: { id: row.id },
          data: {
            qtyGood: Math.max(0, row.qtyGood - qtyDelivered),
            qtyReserved: Math.max(0, row.qtyReserved - line.qty),
          },
        });
      }
    }

    if (qtyDelivered > 0) {
      const effectiveUnitPrice = line.lineTotal / line.qty;
      const deliveredLineTotal = Math.round(effectiveUnitPrice * qtyDelivered);
      invoiceAmount += deliveredLineTotal;
      deliveredLines.push({ productId: line.productId, qty: qtyDelivered, unitPrice: line.unitPrice, lineTotal: deliveredLineTotal });
    }
  }

  const outstanding = await outletOutstandingBalance(order.outletId);
  const invoiceCount = await prisma.invoice.count();
  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber: `INV-${String(invoiceCount + 1).padStart(6, "0")}`,
      salesOrderId: order.id,
      outletId: order.outletId,
      branchId: order.branchId,
      dueDate: new Date(Date.now() + 30 * 86400000),
      amount: invoiceAmount,
      status: "unpaid",
    },
  });
  for (const dl of deliveredLines) {
    await prisma.invoiceLine.create({ data: { invoiceId: invoice.id, ...dl } });
  }

  const drCount = await prisma.deliveryReceipt.count();
  const dr = await prisma.deliveryReceipt.create({
    data: {
      drNumber: `DR-${String(drCount + 1).padStart(6, "0")}`,
      invoiceId: invoice.id,
      receivedBy,
      status: anyShortfall ? "partial" : "delivered",
    },
  });
  for (const line of order.lines) {
    const qtyDelivered = deliveredLines.find((dl) => dl.productId === line.productId)?.qty ?? 0;
    await prisma.deliveryReceiptLine.create({
      data: { deliveryReceiptId: dr.id, productId: line.productId, qtyOrdered: line.qty, qtyDelivered },
    });
  }

  await prisma.aRLedgerEntry.create({
    data: {
      outletId: order.outletId,
      invoiceId: invoice.id,
      type: "invoice",
      amount: invoiceAmount,
      balance: outstanding + invoiceAmount,
      reference: invoice.invoiceNumber,
    },
  });

  await prisma.salesOrder.update({ where: { id: order.id }, data: { status: "delivered" } });

  revalidatePath(`/supervisor/orders/${order.id}`);
  revalidatePath("/supervisor/orders");
  redirect(`/supervisor/orders/${order.id}`);
}
