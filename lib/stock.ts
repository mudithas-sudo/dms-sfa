import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getNumberSetting, getSetting } from "@/lib/settings";
import type { StockBalance } from "@prisma/client";

// Every change to a stock balance goes through here so it is also written to the movement
// ledger — who, what, which lot, which document, and the balance afterwards. That ledger is
// what lets any quantity be drilled into its source receipt, transfer, adjustment or sale.

export type Bucket = "good" | "damaged" | "expired" | "quarantine";

export const BUCKET_FIELD: Record<Bucket, "qtyGood" | "qtyDamaged" | "qtyExpired" | "qtyQuarantine"> = {
  good: "qtyGood",
  damaged: "qtyDamaged",
  expired: "qtyExpired",
  quarantine: "qtyQuarantine",
};

export const BUCKET_LABEL: Record<string, string> = {
  good: "Good (sellable)",
  damaged: "Bad: Damaged",
  expired: "Bad: Expired",
  quarantine: "Bad: Quarantine",
  in_transit: "In transit",
};

export interface MovementRef {
  type: string;
  refType?: string | null;
  refId?: string | null;
  refNumber?: string | null;
  userName?: string | null;
  note?: string | null;
}

export async function actorName(fallback = "System") {
  const { userId } = await getSession();
  return userId ? (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? fallback : fallback;
}

export async function logMovement(row: Pick<StockBalance, "locationType" | "warehouseId" | "vanId" | "productId" | "lotNumber">, bucket: string, qty: number, balanceAfter: number | null, ref: MovementRef) {
  if (qty === 0) return;
  await prisma.stockMovement.create({
    data: {
      locationType: row.locationType,
      warehouseId: row.warehouseId,
      vanId: row.vanId,
      productId: row.productId,
      lotNumber: row.lotNumber,
      bucket,
      qty,
      balanceAfter,
      type: ref.type,
      refType: ref.refType ?? null,
      refId: ref.refId ?? null,
      refNumber: ref.refNumber ?? null,
      userName: ref.userName ?? null,
      note: ref.note ?? null,
    },
  });
}

// Change one bucket of an existing balance row by `delta` (never below zero) and log it.
export async function changeBalance(rowId: string, bucket: Bucket, delta: number, ref: MovementRef) {
  const row = await prisma.stockBalance.findUniqueOrThrow({ where: { id: rowId } });
  const field = BUCKET_FIELD[bucket];
  const next = Math.max(0, row[field] + delta);
  const applied = next - row[field];
  const updated = await prisma.stockBalance.update({ where: { id: rowId }, data: { [field]: next } });
  await logMovement(row, bucket, applied, updated[field], ref);
  return updated;
}

// Add stock to a location's lot, creating the balance row when this lot is new there.
export async function addToLot(
  loc: { locationType: "warehouse" | "van"; warehouseId?: string; vanId?: string },
  productId: string,
  lotNumber: string,
  expiryDate: Date | null,
  bucket: Bucket,
  qty: number,
  ref: MovementRef,
  goodsReceiptLineId?: string,
) {
  const existing = await prisma.stockBalance.findFirst({
    where: { locationType: loc.locationType, warehouseId: loc.warehouseId ?? null, vanId: loc.vanId ?? null, productId, lotNumber },
  });
  if (existing) return changeBalance(existing.id, bucket, qty, ref);
  const created = await prisma.stockBalance.create({
    data: {
      locationType: loc.locationType,
      warehouseId: loc.warehouseId ?? null,
      vanId: loc.vanId ?? null,
      productId,
      lotNumber,
      expiryDate,
      [BUCKET_FIELD[bucket]]: Math.max(0, qty),
      goodsReceiptLineId: goodsReceiptLineId ?? null,
    },
  });
  await logMovement(created, bucket, Math.max(0, qty), Math.max(0, qty), ref);
  return created;
}

export const availableOf = (r: Pick<StockBalance, "qtyGood" | "qtyReserved">) => Math.max(0, r.qtyGood - r.qtyReserved);

// Good, unexpired lots with available quantity — earliest expiry first (FEFO). A minimum
// remaining shelf life (days) skips lots that are too close to expiry for the customer/channel.
export async function fefoLots(warehouseId: string, productId: string, minShelfLifeDays?: number) {
  const minDays = minShelfLifeDays ?? (await getNumberSetting("fefo.minShelfLifeDays"));
  const cutoff = new Date(Date.now() + minDays * 86400000);
  const rows = await prisma.stockBalance.findMany({ where: { warehouseId, productId, qtyGood: { gt: 0 } } });
  return rows
    .filter((r) => availableOf(r) > 0 && (!r.expiryDate || r.expiryDate >= cutoff))
    .sort((a, b) => {
      if (a.expiryDate && b.expiryDate) return a.expiryDate.getTime() - b.expiryDate.getTime();
      if (a.expiryDate) return -1;
      if (b.expiryDate) return 1;
      return 0;
    });
}

export async function fefoMode(): Promise<"suggest" | "enforce"> {
  return (await getSetting("fefo.mode")) === "enforce" ? "enforce" : "suggest";
}

// Net quantity received per PO line from posted receipts (reversals carry negative lines).
export async function receivedByProduct(purchaseOrderId: string) {
  const grs = await prisma.goodsReceipt.findMany({
    where: { purchaseOrderId, status: { in: ["posted", "reversed"] } },
    include: { lines: true },
  });
  const m = new Map<string, number>();
  for (const g of grs) for (const l of g.lines) m.set(l.productId, (m.get(l.productId) ?? 0) + l.qtyReceived);
  return m;
}

export async function refreshPoStatus(purchaseOrderId: string, exceptionReason?: string | null) {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId }, include: { lines: true } });
  if (po.status === "cancelled") return po;
  const got = await receivedByProduct(purchaseOrderId);
  const ordered = po.lines.reduce((s, l) => s + l.qtyOrdered, 0);
  const received = po.lines.reduce((s, l) => s + Math.min(l.qtyOrdered, got.get(l.productId) ?? 0), 0);
  const status = received <= 0 ? "pending" : received >= ordered ? "received" : "partially_received";
  return prisma.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: { status: exceptionReason ? "exception" : status, exceptionReason: exceptionReason ?? null },
  });
}

// Configured as "auto": lots past expiry leave sellable stock without anyone confirming.
export async function autoMoveExpired(branchId: string) {
  const rows = await prisma.stockBalance.findMany({
    where: { locationType: "warehouse", expiryDate: { lt: new Date() }, qtyGood: { gt: 0 }, warehouse: { branchId } },
  });
  for (const r of rows) {
    const move = r.qtyGood - r.qtyReserved;
    if (move <= 0) continue;
    const ref = { type: "reclass", refType: "StockBalance", refId: r.id, userName: "System", note: "Expiry date reached (automatic)" };
    await changeBalance(r.id, "good", -move, ref);
    await changeBalance(r.id, "expired", move, ref);
    await prisma.stockDamageEvent.create({ data: { stockBalanceId: r.id, qty: move, direction: "good_to_bad", reason: "good → expired: expiry date reached (automatic)", createdBy: "System" } });
  }
}

// One daily summary per branch of the lots that have entered a warning band.
export async function ensureNearExpiryAlert(branchId: string, warningCount: number, criticalCount: number) {
  if (warningCount + criticalCount === 0) return;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const exists = await prisma.notification.count({ where: { branchId, title: "Near-expiry daily summary", createdAt: { gte: start } } });
  if (exists) return;
  await prisma.notification.create({
    data: {
      role: "branch_ops", branchId, kind: "alert", title: "Near-expiry daily summary", link: "/branch/near-expiry",
      body: `${criticalCount} lot(s) are in the Critical band and ${warningCount} in the Warning band — prioritise them for sale.`,
    },
  });
}
