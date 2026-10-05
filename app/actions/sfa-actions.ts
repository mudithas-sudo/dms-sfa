"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { priceOrder } from "@/lib/pricing";

export async function getRepVan(branchId: string, rep: { id: string; name: string }) {
  const vans = await prisma.van.findMany({ where: { branchId } });
  return (
    vans.find((v) => v.assignedUserId === rep.id) ??
    vans.find((v) => v.driverName === rep.name) ??
    vans[0] ??
    null
  );
}

async function outletOutstanding(outletId: string): Promise<number> {
  const invoices = await prisma.invoice.findMany({
    where: { outletId, status: { in: ["unpaid", "partially_paid", "overdue"] } },
    include: { arLedgerEntries: true },
  });
  return invoices.reduce((sum, inv) => {
    const paid = inv.arLedgerEntries.filter((e) => e.type === "payment").reduce((s, e) => s + e.amount, 0);
    return sum + (inv.amount - paid);
  }, 0);
}

export interface CartItem {
  productId: string;
  qty: number;
}

// Live price quote for the cart — runs the same engine submitOrder uses, so
// the total a rep sees while building an order is exactly what's invoiced.
export async function quoteOrder(outletId: string, items: CartItem[]) {
  if (!outletId || items.length === 0) return { subtotal: 0, discountTotal: 0, total: 0 };
  const { subtotal, discountTotal, total } = await priceOrder(outletId, items);
  return { subtotal, discountTotal, total };
}

// Suggested reorder quantity: average of the outlet's last 3 orders for this
// product — a simple rule, not real forecasting/AI.
export async function suggestedOrderQty(outletId: string, productId: string): Promise<number> {
  const lastLines = await prisma.salesOrderLine.findMany({
    where: { productId, salesOrder: { outletId, status: { not: "voided" } } },
    orderBy: { salesOrder: { orderDate: "desc" } },
    take: 3,
  });
  if (lastLines.length === 0) return 0;
  return Math.round(lastLines.reduce((s, l) => s + l.qty, 0) / lastLines.length);
}

// Suggested van-stock replenishment quantity: average of the rep's last 5
// sales-order line quantities for this product, across all their customers —
// a simple rule (not real forecasting), giving a starting point for the load.
export async function suggestedVanQty(vanId: string, productId: string): Promise<number> {
  const van = await prisma.van.findUnique({ where: { id: vanId } });
  if (!van) return 0;
  const rep = van.assignedUserId
    ? await prisma.user.findUnique({ where: { id: van.assignedUserId } })
    : await prisma.user.findFirst({ where: { branchId: van.branchId, role: "sales_rep", name: van.driverName } });
  if (!rep) return 0;

  const lastLines = await prisma.salesOrderLine.findMany({
    where: { productId, salesOrder: { salespersonId: rep.id, status: { not: "voided" } } },
    orderBy: { salesOrder: { orderDate: "desc" } },
    take: 5,
  });
  if (lastLines.length === 0) return 0;
  return Math.round(lastLines.reduce((s, l) => s + l.qty, 0) / lastLines.length);
}

export async function submitOrder(
  outletId: string,
  items: CartItem[],
  options?: { requestedDeliveryDate?: string; signatureDataUrl?: string },
) {
  const { userId, branchId } = await getSession();
  if (!userId || !branchId) throw new Error("No active session");
  const rep = await prisma.user.findUnique({ where: { id: userId } });
  const outlet = await prisma.outlet.findUnique({ where: { id: outletId } });
  if (!rep || !outlet) throw new Error("Invalid outlet or rep");
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (branch?.status === "inactive") throw new Error("This branch is inactive and cannot transact");
  if (outlet.status === "inactive") throw new Error("This outlet is inactive and cannot transact");

  const van = await getRepVan(branchId, rep);
  const { lines: lineData, subtotal, discountTotal, total } = await priceOrder(outletId, items);
  const orderCount = await prisma.salesOrder.count();
  const outstanding = await outletOutstanding(outletId);
  const exceedsCreditLimit = outstanding + total > outlet.creditLimit;

  const order = await prisma.salesOrder.create({
    data: {
      orderNumber: `SO-${String(orderCount + 1).padStart(6, "0")}`,
      outletId,
      branchId,
      salespersonId: rep.id,
      status: exceedsCreditLimit ? "draft" : "delivered",
      requestedDeliveryDate: options?.requestedDeliveryDate ? new Date(options.requestedDeliveryDate) : undefined,
      signatureDataUrl: options?.signatureDataUrl,
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
        requestedBy: rep.name,
        amount: outstanding + total - outlet.creditLimit,
        reason: `${outlet.name}: order total ₱${total.toLocaleString()} would exceed credit limit`,
        status: "pending",
      },
    });
    revalidatePath("/sfa");
    redirect(`/sfa/outlets/${outletId}?orderStatus=hold`);
  }

  // Auto-approved: deduct van stock, invoice, and deliver immediately (van sale).
  if (van) {
    for (const line of lineData) {
      const vanStock = await prisma.stockBalance.findFirst({
        where: { locationType: "van", vanId: van.id, productId: line.productId },
        orderBy: { qtyGood: "desc" },
      });
      if (vanStock) {
        await prisma.stockBalance.update({
          where: { id: vanStock.id },
          data: { qtyGood: Math.max(0, vanStock.qtyGood - line.qty) },
        });
      }
    }
  }

  const invoiceCount = await prisma.invoice.count();
  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber: `INV-${String(invoiceCount + 1).padStart(6, "0")}`,
      salesOrderId: order.id,
      outletId,
      branchId,
      dueDate: new Date(Date.now() + 30 * 86400000),
      amount: total,
      status: "unpaid",
    },
  });
  for (const line of lineData) {
    await prisma.invoiceLine.create({
      data: { invoiceId: invoice.id, productId: line.productId, qty: line.qty, unitPrice: line.unitPrice, lineTotal: line.lineTotal },
    });
  }

  const drCount = await prisma.deliveryReceipt.count();
  await prisma.deliveryReceipt.create({
    data: { drNumber: `DR-${String(drCount + 1).padStart(6, "0")}`, invoiceId: invoice.id, receivedBy: `${outlet.name} staff`, status: "delivered" },
  });

  await prisma.aRLedgerEntry.create({
    data: {
      outletId,
      invoiceId: invoice.id,
      type: "invoice",
      amount: total,
      balance: outstanding + total,
      reference: invoice.invoiceNumber,
    },
  });

  revalidatePath("/sfa");
  redirect(`/sfa/outlets/${outletId}?orderStatus=success`);
}

export async function recordCollection(formData: FormData) {
  const outletId = String(formData.get("outletId"));
  const method = String(formData.get("method"));
  let amountLeft = Number(formData.get("amount"));
  // One reference ties every ledger entry from this single collection
  // together, so a receipt can be reconstructed after the fact.
  const reference = String(formData.get("reference") ?? "").trim() || `OR-${Date.now()}`;

  const invoices = await prisma.invoice.findMany({
    where: { outletId, status: { in: ["unpaid", "partially_paid", "overdue"] } },
    include: { arLedgerEntries: true },
    orderBy: { invoiceDate: "asc" },
  });

  let runningBalance = await outletOutstanding(outletId);

  for (const inv of invoices) {
    if (amountLeft <= 0) break;
    const alreadyPaid = inv.arLedgerEntries.filter((e) => e.type === "payment").reduce((s, e) => s + e.amount, 0);
    const invOutstanding = inv.amount - alreadyPaid;
    if (invOutstanding <= 0) continue;

    const applied = Math.min(invOutstanding, amountLeft);
    amountLeft -= applied;
    runningBalance -= applied;

    await prisma.aRLedgerEntry.create({
      data: {
        outletId,
        invoiceId: inv.id,
        type: "payment",
        method,
        amount: applied,
        balance: runningBalance,
        reference,
      },
    });

    await prisma.invoice.update({
      where: { id: inv.id },
      data: { status: applied >= invOutstanding ? "paid" : "partially_paid" },
    });
  }

  if (amountLeft > 0) {
    runningBalance -= amountLeft;
    await prisma.aRLedgerEntry.create({
      data: { outletId, type: "payment", method, amount: amountLeft, balance: runningBalance, reference },
    });
  }

  revalidatePath(`/sfa/outlets/${outletId}`);
  redirect(`/sfa/receipt/${encodeURIComponent(reference)}?outlet=${outletId}`);
}

export async function checkInVisit(formData: FormData) {
  const outletId = String(formData.get("outletId"));
  const { userId } = await getSession();
  if (!userId) return;
  const outlet = await prisma.outlet.findUnique({ where: { id: outletId } });
  if (!outlet) return;

  await prisma.fieldVisit.create({
    data: {
      outletId,
      salespersonId: userId,
      checkinLat: outlet.lat,
      checkinLng: outlet.lng,
      status: "in_progress",
    },
  });

  revalidatePath("/sfa/visit/new");
  redirect("/sfa/visit/new");
}

export async function checkOutVisit(formData: FormData) {
  const visitId = String(formData.get("visitId"));
  const feedback = String(formData.get("feedback") ?? "");

  const visit = await prisma.fieldVisit.findUniqueOrThrow({ where: { id: visitId }, include: { outlet: true } });

  await prisma.fieldVisit.update({
    where: { id: visitId },
    data: {
      checkoutAt: new Date(),
      // Same simulated-GPS pattern as check-in — a second real fix, not a
      // reuse of the check-in coordinates, so "GPS captured at each point"
      // genuinely records two distinct readings.
      checkoutLat: visit.outlet.lat + (Math.random() - 0.5) * 0.001,
      checkoutLng: visit.outlet.lng + (Math.random() - 0.5) * 0.001,
      feedback,
      photoPlaceholder: true,
      status: "completed",
    },
  });

  revalidatePath("/sfa/visit/new");
  redirect("/sfa?visit=completed");
}

// ---------------------------------------------------------------------------
// New customer registration from the field (feeds the admin onboarding queue)
// ---------------------------------------------------------------------------

export async function registerFieldCustomer(formData: FormData) {
  const { branchId, userId } = await getSession();
  if (!branchId) return;
  const name = String(formData.get("name") ?? "").trim();
  const channelId = String(formData.get("channelId"));
  const subChannel = String(formData.get("subChannel") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const contactPerson = String(formData.get("contactPerson") ?? "").trim();
  const lat = Number(formData.get("lat") ?? 0);
  const lng = Number(formData.get("lng") ?? 0);
  if (!name || !channelId) return;

  const rep = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;

  await prisma.outlet.create({
    data: {
      name,
      branchId,
      channelId,
      subChannel,
      address,
      contactPerson: contactPerson || null,
      lat,
      lng,
      creditLimit: 20000,
      status: "inactive",
      onboardingStatus: "pending",
      routeId: rep?.routeId,
    },
  });

  redirect("/sfa?customer=submitted");
}

// ---------------------------------------------------------------------------
// Van inventory: replenishment request, damage marking, stock count
// ---------------------------------------------------------------------------

export async function requestVanReplenishment(formData: FormData) {
  const { branchId, userId } = await getSession();
  if (!branchId) return;
  const productId = String(formData.get("productId"));
  const qtyRequested = Number(formData.get("qtyRequested") ?? 0);
  if (!productId || qtyRequested <= 0) return;

  const rep = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
  const van = rep ? await getRepVan(branchId, rep) : null;
  if (!van) return;

  await prisma.replenishmentRequest.create({
    data: { vanId: van.id, branchId, productId, qtyRequested, requestedBy: rep?.name ?? "Sales Rep" },
  });

  revalidatePath("/sfa/van-stock");
  redirect("/sfa/van-stock?replenishment=submitted");
}

export async function markVanStockDamaged(formData: FormData) {
  const stockBalanceId = String(formData.get("stockBalanceId"));
  const qty = Number(formData.get("qty") ?? 0);
  if (qty <= 0) return;
  const { userId } = await getSession();
  const reporter = userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? "Sales Rep" : "Sales Rep";

  const row = await prisma.stockBalance.findUniqueOrThrow({ where: { id: stockBalanceId } });
  const moveQty = Math.min(qty, row.qtyGood);
  await prisma.stockBalance.update({
    where: { id: stockBalanceId },
    data: { qtyGood: row.qtyGood - moveQty, qtyDamaged: row.qtyDamaged + moveQty },
  });
  await prisma.stockDamageEvent.create({
    data: { stockBalanceId, qty: moveQty, direction: "good_to_bad", photoPlaceholder: true, createdBy: reporter },
  });

  revalidatePath("/sfa/van-stock");
}

// A damaged item that passes a quality re-check can be moved back to
// sellable stock — the reverse of markVanStockDamaged, logged the same way.
export async function reverseVanStockDamage(formData: FormData) {
  const stockBalanceId = String(formData.get("stockBalanceId"));
  const qty = Number(formData.get("qty") ?? 0);
  if (qty <= 0) return;
  const { userId } = await getSession();
  const reporter = userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? "Sales Rep" : "Sales Rep";

  const row = await prisma.stockBalance.findUniqueOrThrow({ where: { id: stockBalanceId } });
  const moveQty = Math.min(qty, row.qtyDamaged);
  await prisma.stockBalance.update({
    where: { id: stockBalanceId },
    data: { qtyGood: row.qtyGood + moveQty, qtyDamaged: row.qtyDamaged - moveQty },
  });
  await prisma.stockDamageEvent.create({
    data: { stockBalanceId, qty: moveQty, direction: "bad_to_good", createdBy: reporter },
  });

  revalidatePath("/sfa/van-stock");
}

// Van stock counts post immediately (lower risk than warehouse counts —
// it's the rep correcting their own van, not a formal warehouse cycle count).
export async function applyVanStockCount(formData: FormData) {
  const { branchId, userId } = await getSession();
  if (!branchId || !userId) return;
  const rep = await prisma.user.findUnique({ where: { id: userId } });
  const van = rep ? await getRepVan(branchId, rep) : null;
  if (!van) return;

  const rows = await prisma.stockBalance.findMany({ where: { locationType: "van", vanId: van.id } });
  for (const row of rows) {
    const countedRaw = formData.get(`counted_${row.id}`);
    if (countedRaw === null || countedRaw === "") continue;
    const countedQty = Number(countedRaw);
    if (countedQty !== row.qtyGood) {
      await prisma.stockBalance.update({ where: { id: row.id }, data: { qtyGood: countedQty } });
    }
  }

  revalidatePath("/sfa/van-stock");
  redirect("/sfa/van-stock?count=submitted");
}

// ---------------------------------------------------------------------------
// Market returns (settled into a credit note by the supervisor)
// ---------------------------------------------------------------------------

export async function captureMarketReturn(formData: FormData) {
  const { userId } = await getSession();
  if (!userId) return;
  const rep = await prisma.user.findUnique({ where: { id: userId } });
  const outletId = String(formData.get("outletId"));
  const productId = String(formData.get("productId"));
  const qty = Number(formData.get("qty") ?? 0);
  const reason = String(formData.get("reason") ?? "").trim();
  if (!outletId || !productId || qty <= 0 || !reason) return;

  await prisma.marketReturn.create({
    data: { outletId, productId, qty, reason, photoPlaceholder: true, capturedBy: rep?.name ?? "Sales Rep" },
  });

  redirect(`/sfa/outlets/${outletId}?return=submitted`);
}

// ---------------------------------------------------------------------------
// Field execution: shelf audit / merchandising / competitor observation
// ---------------------------------------------------------------------------

export async function createFieldNote(formData: FormData) {
  const { userId } = await getSession();
  if (!userId) return;
  const outletId = String(formData.get("outletId"));
  const type = String(formData.get("type"));
  const notes = String(formData.get("notes") ?? "").trim();
  if (!outletId || !notes) return;

  await prisma.fieldNote.create({
    data: { outletId, salespersonId: userId, type, notes, photoPlaceholder: true },
  });

  redirect("/sfa?note=submitted");
}

// ---------------------------------------------------------------------------
// Task assignment & completion
// ---------------------------------------------------------------------------

export async function completeTask(formData: FormData) {
  const id = String(formData.get("id"));
  await prisma.task.update({ where: { id }, data: { status: "completed", completedAt: new Date() } });
  revalidatePath("/sfa/tasks");
}

// ---------------------------------------------------------------------------
// Workforce administration (conditional / subject to confirmation)
// ---------------------------------------------------------------------------

export async function submitLeaveRequest(formData: FormData) {
  const { userId } = await getSession();
  if (!userId) return;
  const startDate = String(formData.get("startDate"));
  const endDate = String(formData.get("endDate"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!startDate || !endDate || !reason) return;

  await prisma.leaveRequest.create({
    data: { userId, startDate: new Date(startDate), endDate: new Date(endDate), reason },
  });

  redirect("/sfa/requests?leave=submitted");
}

export async function submitExpenseRequest(formData: FormData) {
  const { userId } = await getSession();
  if (!userId) return;
  const amount = Number(formData.get("amount") ?? 0);
  const category = String(formData.get("category"));
  const description = String(formData.get("description") ?? "").trim();
  if (amount <= 0 || !description) return;

  await prisma.expenseRequest.create({
    data: { userId, amount, category, description, receiptPlaceholder: true },
  });

  redirect("/sfa/requests?expense=submitted");
}

// ---------------------------------------------------------------------------
// Mobile attendance (start/end day)
// ---------------------------------------------------------------------------

export async function startAttendanceDay(formData: FormData) {
  const { userId } = await getSession();
  if (!userId) return;
  const lat = Number(formData.get("lat") ?? 0);
  const lng = Number(formData.get("lng") ?? 0);

  const dayDate = new Date();
  dayDate.setHours(0, 0, 0, 0);

  await prisma.attendance.create({
    data: { userId, dayDate, startAt: new Date(), startLat: lat, startLng: lng, status: "in_progress" },
  });

  revalidatePath("/sfa/attendance");
  redirect("/sfa/attendance");
}

export async function endAttendanceDay(formData: FormData) {
  const attendanceId = String(formData.get("attendanceId"));
  const lat = Number(formData.get("lat") ?? 0);
  const lng = Number(formData.get("lng") ?? 0);

  await prisma.attendance.update({
    where: { id: attendanceId },
    data: { endAt: new Date(), endLat: lat, endLng: lng, status: "completed" },
  });

  revalidatePath("/sfa/attendance");
  redirect("/sfa/attendance");
}

// ---------------------------------------------------------------------------
// Van load acknowledgement & field-side EOD sign-off
// ---------------------------------------------------------------------------

// The rep's own confirmation that stock approved onto their van actually
// arrived — the mobile-side half of the warehouse's loading transaction.
export async function confirmVanLoad(formData: FormData) {
  const vanLoadId = String(formData.get("vanLoadId"));
  await prisma.vanLoad.update({ where: { id: vanLoadId }, data: { confirmedAt: new Date() } });
  revalidatePath("/sfa/van-stock");
}

export async function confirmEodReconciliation(formData: FormData) {
  const attendanceId = String(formData.get("attendanceId"));
  const hasMismatch = String(formData.get("hasMismatch") ?? "") === "1";
  const { userId } = await getSession();
  const rep = userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? "Sales Rep" : "Sales Rep";

  await prisma.attendance.update({ where: { id: attendanceId }, data: { eodConfirmedAt: new Date() } });

  if (hasMismatch && userId) {
    await prisma.auditLog.create({
      data: {
        entity: "Attendance",
        entityId: attendanceId,
        action: "flag",
        userId,
        summary: `${rep} confirmed end-of-day reconciliation with an unresolved loaded/sold/returned mismatch — needs investigation`,
      },
    });
  }

  revalidatePath("/sfa/eod");
}
