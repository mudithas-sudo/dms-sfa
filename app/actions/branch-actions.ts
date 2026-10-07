"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

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
