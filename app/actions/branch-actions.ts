"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function receiveGoods(formData: FormData) {
  const purchaseOrderId = String(formData.get("purchaseOrderId"));
  const warehouseId = String(formData.get("warehouseId"));
  // No real file storage in this prototype — a real file picker is used,
  // but only the filename is persisted as the stub "attachment", consistent
  // with how other capture flows simulate evidence without a backing
  // upload service.
  const attachmentFile = formData.get("attachment");
  const attachmentFilename = attachmentFile instanceof File && attachmentFile.size > 0 ? attachmentFile.name : null;
  const { userId } = await getSession();
  const receiver = userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? "Branch Ops" : "Branch Ops";

  const lines = await prisma.purchaseOrderLine.findMany({ where: { purchaseOrderId } });
  const grCount = await prisma.goodsReceipt.count();
  const gr = await prisma.goodsReceipt.create({
    data: {
      grNumber: `GR-${String(grCount + 1).padStart(5, "0")}`,
      purchaseOrderId,
      warehouseId,
      receivedBy: receiver,
      hasAttachment: !!attachmentFilename,
      attachmentFilename,
    },
  });

  let fullyReceived = true;
  for (const line of lines) {
    const qtyReceived = Number(formData.get(`qty_${line.id}`) ?? 0);
    const lotNumber = String(formData.get(`lot_${line.id}`) ?? `LOT-${Date.now()}`);
    const expiryRaw = String(formData.get(`expiry_${line.id}`) ?? "");

    if (qtyReceived < line.qtyOrdered) fullyReceived = false;
    if (qtyReceived <= 0) continue;

    const grLine = await prisma.goodsReceiptLine.create({
      data: {
        goodsReceiptId: gr.id,
        productId: line.productId,
        qtyExpected: line.qtyOrdered,
        qtyReceived,
        lotNumber,
        expiryDate: expiryRaw ? new Date(expiryRaw) : null,
      },
    });

    // Linking the new stock lot straight back to the receipt line it came
    // from is what makes "click from a lot to its originating PO" possible.
    await prisma.stockBalance.create({
      data: {
        locationType: "warehouse",
        warehouseId,
        productId: line.productId,
        lotNumber,
        expiryDate: expiryRaw ? new Date(expiryRaw) : null,
        qtyGood: qtyReceived,
        qtyDamaged: 0,
        goodsReceiptLineId: grLine.id,
      },
    });
  }

  await prisma.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: { status: fullyReceived ? "received" : "partially_received" },
  });

  revalidatePath("/branch/purchase-orders");
  revalidatePath("/branch/warehouse-stock");
  redirect("/branch/purchase-orders");
}

// A count line's variance is "within tolerance" if it's small both in
// absolute terms and relative to the system quantity — catches a one- or
// two-unit miscount without forcing a supervisor to review it, while still
// routing anything larger for review before it posts.
function isVarianceWithinThreshold(variance: number, systemQty: number): boolean {
  const relativeAllowance = Math.round(systemQty * 0.05);
  return Math.abs(variance) <= Math.max(2, relativeAllowance);
}

export async function submitStockCount(formData: FormData) {
  const warehouseId = String(formData.get("warehouseId"));
  const { userId } = await getSession();
  const counter = userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? "Branch Ops" : "Branch Ops";

  const rows = await prisma.stockBalance.findMany({ where: { warehouseId } });
  const lines: { row: (typeof rows)[number]; countedQty: number; variance: number }[] = [];
  for (const row of rows) {
    const countedRaw = formData.get(`counted_${row.id}`);
    if (countedRaw === null || countedRaw === "") continue;
    const countedQty = Number(countedRaw);
    lines.push({ row, countedQty, variance: countedQty - row.qtyGood });
  }

  // Only a count where every line is within threshold can auto-post; a
  // single large discrepancy sends the whole count for review.
  const needsReview = lines.some((l) => !isVarianceWithinThreshold(l.variance, l.row.qtyGood));

  const count = await prisma.stockCount.create({
    data: {
      warehouseId,
      countedBy: counter,
      status: needsReview ? "pending_approval" : "closed",
      ...(needsReview ? {} : { approvedBy: "Auto-approved (within variance threshold)" }),
    },
  });

  for (const l of lines) {
    await prisma.stockCountLine.create({
      data: {
        stockCountId: count.id,
        productId: l.row.productId,
        lotNumber: l.row.lotNumber,
        systemQty: l.row.qtyGood,
        countedQty: l.countedQty,
        variance: l.variance,
      },
    });
    if (!needsReview && l.variance !== 0) {
      await prisma.stockBalance.update({ where: { id: l.row.id }, data: { qtyGood: l.countedQty } });
    }
  }

  revalidatePath("/branch/stock-count");
  revalidatePath("/branch/warehouse-stock");
  redirect("/branch/stock-count");
}

// Posting a count as an adjustment: only once approved does the physical
// count overwrite the system quantity — this is the "route for approval,
// then post" cycle-count workflow.
export async function decideStockCount(formData: FormData) {
  const stockCountId = String(formData.get("stockCountId"));
  const decision = String(formData.get("decision")); // approved | rejected
  const { userId } = await getSession();
  const approver = userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? "Manager" : "Manager";

  const count = await prisma.stockCount.findUniqueOrThrow({ where: { id: stockCountId }, include: { lines: true } });
  if (count.status !== "pending_approval") return;

  if (decision === "approved") {
    for (const line of count.lines) {
      if (line.variance === 0) continue;
      const balance = await prisma.stockBalance.findFirst({
        where: { warehouseId: count.warehouseId, productId: line.productId, lotNumber: line.lotNumber },
      });
      if (balance) {
        await prisma.stockBalance.update({ where: { id: balance.id }, data: { qtyGood: line.countedQty } });
      }
    }
  }

  await prisma.stockCount.update({
    where: { id: stockCountId },
    data: { status: decision === "approved" ? "closed" : "rejected", approvedBy: approver },
  });

  revalidatePath("/branch/stock-count");
  revalidatePath("/branch/warehouse-stock");
}

// ---------------------------------------------------------------------------
// Good / bad stock segregation
// ---------------------------------------------------------------------------

export async function markStockDamaged(formData: FormData) {
  const stockBalanceId = String(formData.get("stockBalanceId"));
  const qty = Number(formData.get("qty") ?? 0);
  const reason = String(formData.get("reason") ?? "").trim();
  const photoPlaceholder = formData.get("photoPlaceholder") === "on";
  if (qty <= 0) return;
  const { userId } = await getSession();
  const reporter = userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? "Branch Ops" : "Branch Ops";

  const row = await prisma.stockBalance.findUniqueOrThrow({ where: { id: stockBalanceId } });
  const moveQty = Math.min(qty, row.qtyGood);
  await prisma.stockBalance.update({
    where: { id: stockBalanceId },
    data: { qtyGood: row.qtyGood - moveQty, qtyDamaged: row.qtyDamaged + moveQty },
  });
  await prisma.stockDamageEvent.create({
    data: { stockBalanceId, qty: moveQty, direction: "good_to_bad", reason: reason || null, photoPlaceholder, createdBy: reporter },
  });

  revalidatePath("/branch/warehouse-stock");
}

// A damaged lot that passes a quality re-check moves back to sellable stock
// — the reverse of markStockDamaged, logged the same way so the reason and
// timing of every reclassification (either direction) stays on record.
export async function reverseStockDamage(formData: FormData) {
  const stockBalanceId = String(formData.get("stockBalanceId"));
  const qty = Number(formData.get("qty") ?? 0);
  const reason = String(formData.get("reason") ?? "").trim();
  if (qty <= 0) return;
  const { userId } = await getSession();
  const reporter = userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? "Branch Ops" : "Branch Ops";

  const row = await prisma.stockBalance.findUniqueOrThrow({ where: { id: stockBalanceId } });
  const moveQty = Math.min(qty, row.qtyDamaged);
  await prisma.stockBalance.update({
    where: { id: stockBalanceId },
    data: { qtyGood: row.qtyGood + moveQty, qtyDamaged: row.qtyDamaged - moveQty },
  });
  await prisma.stockDamageEvent.create({
    data: { stockBalanceId, qty: moveQty, direction: "bad_to_good", reason: reason || null, createdBy: reporter },
  });

  revalidatePath("/branch/warehouse-stock");
}

// ---------------------------------------------------------------------------
// Beginning balance (opening stock entry)
// ---------------------------------------------------------------------------

// Beginning-balance entries are corrections to the stock baseline like any
// other, so they go through the same request-then-approve control as a
// stock adjustment rather than posting straight to the balance.
export async function setOpeningBalance(formData: FormData) {
  const warehouseId = String(formData.get("warehouseId"));
  const productId = String(formData.get("productId"));
  const qty = Number(formData.get("qty") ?? 0);
  const lotNumber = String(formData.get("lotNumber") ?? "").trim() || `OPEN-${Date.now()}`;
  const expiryRaw = String(formData.get("expiryDate") ?? "");
  if (qty <= 0) return;

  const { userId } = await getSession();
  const requester = userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? "Branch Ops" : "Branch Ops";

  await prisma.stockAdjustment.create({
    data: {
      warehouseId,
      productId,
      lotNumber,
      expiryDate: expiryRaw ? new Date(expiryRaw) : null,
      qtyDelta: qty,
      reasonCode: "opening_balance",
      requestedBy: requester,
    },
  });

  revalidatePath("/branch/opening-balance");
  revalidatePath("/branch/stock-adjustments");
  redirect("/branch/opening-balance?submitted=1");
}

// ---------------------------------------------------------------------------
// Stock transfers between warehouses
// ---------------------------------------------------------------------------

export async function requestStockTransfer(formData: FormData) {
  const fromWarehouseId = String(formData.get("fromWarehouseId"));
  const toWarehouseId = String(formData.get("toWarehouseId"));
  const productId = String(formData.get("productId"));
  const qty = Number(formData.get("qty") ?? 0);
  if (!fromWarehouseId || !toWarehouseId || fromWarehouseId === toWarehouseId || qty <= 0) return;

  const { userId } = await getSession();
  const requester = userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? "Branch Ops" : "Branch Ops";

  const sourceRow = await prisma.stockBalance.findFirst({
    where: { warehouseId: fromWarehouseId, productId },
    orderBy: { qtyGood: "desc" },
  });
  if (!sourceRow) return;

  await prisma.stockTransfer.create({
    data: {
      fromWarehouseId,
      toWarehouseId,
      productId,
      lotNumber: sourceRow.lotNumber,
      qty,
      requestedBy: requester,
    },
  });

  revalidatePath("/branch/stock-transfers");
  redirect("/branch/stock-transfers");
}

export async function decideStockTransfer(formData: FormData) {
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision")); // approved | rejected
  const { userId } = await getSession();
  const approver = userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? "Manager" : "Manager";

  const transfer = await prisma.stockTransfer.findUniqueOrThrow({ where: { id } });
  if (transfer.status !== "pending") return;

  if (decision === "approved") {
    const sourceRow = await prisma.stockBalance.findFirst({
      where: { warehouseId: transfer.fromWarehouseId, productId: transfer.productId, lotNumber: transfer.lotNumber },
    });
    if (sourceRow && sourceRow.qtyGood >= transfer.qty) {
      await prisma.stockBalance.update({ where: { id: sourceRow.id }, data: { qtyGood: sourceRow.qtyGood - transfer.qty } });

      const destRow = await prisma.stockBalance.findFirst({
        where: { warehouseId: transfer.toWarehouseId, productId: transfer.productId, lotNumber: transfer.lotNumber },
      });
      if (destRow) {
        await prisma.stockBalance.update({ where: { id: destRow.id }, data: { qtyGood: destRow.qtyGood + transfer.qty } });
      } else {
        await prisma.stockBalance.create({
          data: {
            locationType: "warehouse",
            warehouseId: transfer.toWarehouseId,
            productId: transfer.productId,
            lotNumber: transfer.lotNumber,
            expiryDate: sourceRow.expiryDate,
            qtyGood: transfer.qty,
            qtyDamaged: 0,
          },
        });
      }
      await prisma.stockTransfer.update({
        where: { id },
        data: { status: "completed", approvedBy: approver, decidedAt: new Date() },
      });
    }
  } else {
    await prisma.stockTransfer.update({ where: { id }, data: { status: "rejected", approvedBy: approver, decidedAt: new Date() } });
  }

  revalidatePath("/branch/stock-transfers");
  revalidatePath("/branch/warehouse-stock");
}

// ---------------------------------------------------------------------------
// Stock adjustments (reason-coded corrections)
// ---------------------------------------------------------------------------

export async function requestStockAdjustment(formData: FormData) {
  const warehouseId = String(formData.get("warehouseId"));
  const productId = String(formData.get("productId"));
  const qtyDelta = Number(formData.get("qtyDelta") ?? 0);
  const reasonCode = String(formData.get("reasonCode"));
  const notes = String(formData.get("notes") ?? "");
  if (qtyDelta === 0) return;

  const { userId } = await getSession();
  const requester = userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? "Branch Ops" : "Branch Ops";

  const row = await prisma.stockBalance.findFirst({ where: { warehouseId, productId }, orderBy: { qtyGood: "desc" } });
  if (!row) return;

  await prisma.stockAdjustment.create({
    data: { warehouseId, productId, lotNumber: row.lotNumber, qtyDelta, reasonCode, notes, requestedBy: requester },
  });

  revalidatePath("/branch/stock-adjustments");
  redirect("/branch/stock-adjustments");
}

export async function decideStockAdjustment(formData: FormData) {
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision")); // approved | rejected
  const { userId } = await getSession();
  const approver = userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? "Manager" : "Manager";

  const adjustment = await prisma.stockAdjustment.findUniqueOrThrow({ where: { id } });
  if (adjustment.status !== "pending") return;

  if (decision === "approved") {
    const row = await prisma.stockBalance.findFirst({
      where: { warehouseId: adjustment.warehouseId, productId: adjustment.productId, lotNumber: adjustment.lotNumber },
    });
    if (row) {
      await prisma.stockBalance.update({ where: { id: row.id }, data: { qtyGood: Math.max(0, row.qtyGood + adjustment.qtyDelta) } });
    } else if (adjustment.qtyDelta > 0) {
      // No existing lot at this location — this is a beginning-balance entry
      // (or a correction against a lot never received), so approval creates
      // the balance row rather than silently having nothing to update.
      await prisma.stockBalance.create({
        data: {
          locationType: "warehouse",
          warehouseId: adjustment.warehouseId,
          productId: adjustment.productId,
          lotNumber: adjustment.lotNumber,
          expiryDate: adjustment.expiryDate,
          qtyGood: adjustment.qtyDelta,
          qtyDamaged: 0,
        },
      });
    }
  }

  await prisma.stockAdjustment.update({
    where: { id },
    data: { status: decision, approvedBy: approver, decidedAt: new Date() },
  });

  revalidatePath("/branch/stock-adjustments");
  revalidatePath("/branch/warehouse-stock");
  revalidatePath("/branch/opening-balance");
}

// ---------------------------------------------------------------------------
// Van -> warehouse returns
// ---------------------------------------------------------------------------

export async function recordVanReturn(formData: FormData) {
  const vanId = String(formData.get("vanId"));
  const warehouseId = String(formData.get("warehouseId"));
  const productId = String(formData.get("productId"));
  const qty = Number(formData.get("qty") ?? 0);
  const condition = String(formData.get("condition")); // good | damaged
  const reason = String(formData.get("reason") ?? "");
  if (qty <= 0) return;

  const { userId } = await getSession();
  const returner = userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? "Sales Rep" : "Sales Rep";

  const vanRow = await prisma.stockBalance.findFirst({ where: { locationType: "van", vanId, productId }, orderBy: { qtyGood: "desc" } });
  if (!vanRow || vanRow.qtyGood < qty) return;

  await prisma.stockBalance.update({ where: { id: vanRow.id }, data: { qtyGood: vanRow.qtyGood - qty } });

  const whRow = await prisma.stockBalance.findFirst({ where: { warehouseId, productId, lotNumber: vanRow.lotNumber } });
  if (whRow) {
    await prisma.stockBalance.update({
      where: { id: whRow.id },
      data: condition === "damaged" ? { qtyDamaged: whRow.qtyDamaged + qty } : { qtyGood: whRow.qtyGood + qty },
    });
  } else {
    await prisma.stockBalance.create({
      data: {
        locationType: "warehouse",
        warehouseId,
        productId,
        lotNumber: vanRow.lotNumber,
        expiryDate: vanRow.expiryDate,
        qtyGood: condition === "damaged" ? 0 : qty,
        qtyDamaged: condition === "damaged" ? qty : 0,
      },
    });
  }

  await prisma.vanReturn.create({
    data: { vanId, warehouseId, productId, lotNumber: vanRow.lotNumber, qty, condition, reason, returnedBy: returner },
  });

  revalidatePath("/branch/van-returns");
  revalidatePath("/branch/warehouse-stock");
  redirect("/branch/van-returns");
}

// ---------------------------------------------------------------------------
// Returns to principal (warehouse stock returned to the supplier/manufacturer
// — distinct from van returns, which stay inside the distributor's own stock)
// ---------------------------------------------------------------------------

export async function requestSupplierReturn(formData: FormData) {
  const warehouseId = String(formData.get("warehouseId"));
  const productId = String(formData.get("productId"));
  const qty = Number(formData.get("qty") ?? 0);
  const reason = String(formData.get("reason") ?? "expired");
  const notes = String(formData.get("notes") ?? "");
  if (qty <= 0) return;

  const { userId } = await getSession();
  const requester = userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? "Branch Ops" : "Branch Ops";

  // Expired/damaged returns come out of the bad-stock bucket; a recall or
  // other reason comes out of good stock — either way we need a lot that
  // actually has enough of the relevant bucket to cover the request.
  const rows = await prisma.stockBalance.findMany({ where: { warehouseId, productId } });
  const sourceRow = rows.find((r) => (reason === "expired" || reason === "damaged" ? r.qtyDamaged : r.qtyGood) >= qty);
  if (!sourceRow) return;

  await prisma.supplierReturn.create({
    data: { warehouseId, productId, lotNumber: sourceRow.lotNumber, qty, reason, notes, requestedBy: requester },
  });

  revalidatePath("/branch/supplier-returns");
  redirect("/branch/supplier-returns");
}

export async function decideSupplierReturn(formData: FormData) {
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision")); // approved | rejected
  const { userId } = await getSession();
  const approver = userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? "Manager" : "Manager";

  const ret = await prisma.supplierReturn.findUniqueOrThrow({ where: { id } });
  if (ret.status !== "pending") return;

  if (decision === "approved") {
    const row = await prisma.stockBalance.findFirst({ where: { warehouseId: ret.warehouseId, productId: ret.productId, lotNumber: ret.lotNumber } });
    if (row) {
      const fromDamaged = ret.reason === "expired" || ret.reason === "damaged";
      await prisma.stockBalance.update({
        where: { id: row.id },
        data: fromDamaged
          ? { qtyDamaged: Math.max(0, row.qtyDamaged - ret.qty) }
          : { qtyGood: Math.max(0, row.qtyGood - ret.qty) },
      });
    }
  }

  await prisma.supplierReturn.update({
    where: { id },
    data: { status: decision, approvedBy: approver, decidedAt: new Date() },
  });

  revalidatePath("/branch/supplier-returns");
  revalidatePath("/branch/warehouse-stock");
}

export async function markSupplierReturnShipped(formData: FormData) {
  const id = String(formData.get("id"));
  await prisma.supplierReturn.update({ where: { id }, data: { status: "shipped" } });
  revalidatePath("/branch/supplier-returns");
}

// ---------------------------------------------------------------------------
// Van replenishment requests
// ---------------------------------------------------------------------------

export async function decideReplenishmentRequest(formData: FormData) {
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision")); // approved | rejected
  const request = await prisma.replenishmentRequest.findUniqueOrThrow({ where: { id } });
  if (request.status !== "pending") return;
  await prisma.replenishmentRequest.update({ where: { id }, data: { status: decision, decidedAt: new Date() } });
  revalidatePath("/branch/replenishment-requests");
}

export async function markReplenishmentFulfilled(formData: FormData) {
  const id = String(formData.get("id"));
  await prisma.replenishmentRequest.update({ where: { id }, data: { status: "fulfilled", decidedAt: new Date() } });
  revalidatePath("/branch/replenishment-requests");
}

// Requesting a van load only records what's intended to move — the same
// "same transfer mechanism as warehouse-to-warehouse" pattern as
// StockTransfer, just targeting a van. Stock only actually moves once
// decideVanLoad approves it.
export async function requestVanLoad(formData: FormData) {
  const vanId = String(formData.get("vanId"));
  const warehouseId = String(formData.get("warehouseId"));
  const { userId } = await getSession();
  const loader = userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? "Branch Ops" : "Branch Ops";

  const stockRows = await prisma.stockBalance.findMany({ where: { warehouseId } });
  const load = await prisma.vanLoad.create({ data: { vanId, warehouseId, loadedBy: loader, status: "pending" } });

  let anyRequested = false;
  for (const row of stockRows) {
    const qtyRaw = formData.get(`qty_${row.id}`);
    if (qtyRaw === null || qtyRaw === "") continue;
    const qty = Number(qtyRaw);
    if (qty <= 0) continue;
    const available = row.qtyGood - row.qtyReserved;
    if (qty > available) continue;
    anyRequested = true;

    await prisma.vanLoadLine.create({
      data: { vanLoadId: load.id, productId: row.productId, qty, lotNumber: row.lotNumber },
    });
    // Reserve the stock so it can't also be picked for another order or
    // load while this one is awaiting approval.
    await prisma.stockBalance.update({ where: { id: row.id }, data: { qtyReserved: row.qtyReserved + qty } });
  }

  if (!anyRequested) await prisma.vanLoad.delete({ where: { id: load.id } });

  revalidatePath("/branch/van-loading");
  revalidatePath("/branch/warehouse-stock");
  redirect("/branch/van-loading");
}

export async function decideVanLoad(formData: FormData) {
  const vanLoadId = String(formData.get("vanLoadId"));
  const decision = String(formData.get("decision")); // approved | rejected
  const { userId } = await getSession();
  const approver = userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? "Manager" : "Manager";

  const load = await prisma.vanLoad.findUniqueOrThrow({ where: { id: vanLoadId }, include: { lines: true } });
  if (load.status !== "pending") return;

  for (const line of load.lines) {
    const row = await prisma.stockBalance.findFirst({
      where: { warehouseId: load.warehouseId, productId: line.productId, lotNumber: line.lotNumber },
    });
    if (!row) continue;
    // Release the reservation either way — approved consumes the stock,
    // rejected just frees it back up.
    await prisma.stockBalance.update({ where: { id: row.id }, data: { qtyReserved: Math.max(0, row.qtyReserved - line.qty) } });

    if (decision === "approved") {
      await prisma.stockBalance.update({ where: { id: row.id }, data: { qtyGood: row.qtyGood - line.qty } });

      const existingVanRow = await prisma.stockBalance.findFirst({
        where: { locationType: "van", vanId: load.vanId, productId: line.productId, lotNumber: line.lotNumber },
      });
      if (existingVanRow) {
        await prisma.stockBalance.update({ where: { id: existingVanRow.id }, data: { qtyGood: existingVanRow.qtyGood + line.qty } });
      } else {
        await prisma.stockBalance.create({
          data: {
            locationType: "van",
            vanId: load.vanId,
            productId: line.productId,
            lotNumber: line.lotNumber,
            expiryDate: row.expiryDate,
            qtyGood: line.qty,
            qtyDamaged: 0,
          },
        });
      }
    }
  }

  await prisma.vanLoad.update({
    where: { id: vanLoadId },
    data: { status: decision, approvedBy: approver, decidedAt: new Date() },
  });

  revalidatePath("/branch/van-loading");
  revalidatePath("/branch/warehouse-stock");
}
