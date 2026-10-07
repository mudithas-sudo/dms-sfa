import { outletBalance, invoiceBalance } from "@/lib/finance";
import { prisma } from "@/lib/prisma";
import { priceOrder, type PricedLine, type PricingResult } from "@/lib/pricing";
import { getAllSettings, num } from "@/lib/settings";
import { availableOf, changeBalance, fefoLots, addToLot } from "@/lib/stock";
import { creditDays } from "@/lib/masterdata";

// One validation / allocation / invoicing engine for every order, wherever it was entered.

export type Outcome = "pass" | "warn" | "block";

export interface Check {
  id: string;
  label: string;
  outcome: Outcome;
  message: string;
}

export interface OutletPosition {
  outstanding: number;
  overdueAmount: number;
  oldestOverdueDays: number;
  openOrderValue: number;
}

// Statuses and what can still be edited at each (proposal: editing is locked by status).
export const ORDER_EDIT_RULES: { status: string; label: string; editable: string }[] = [
  { status: "draft", label: "Draft", editable: "All fields and lines; the creator can delete the order" },
  { status: "on_hold", label: "On hold (credit, stock or override)", editable: "Lines can be edited (re-validated) or the order released by a supervisor" },
  { status: "confirmed", label: "Confirmed / allocated", editable: "Remarks and delivery date only; line changes need cancel and re-enter" },
  { status: "picked", label: "Picked", editable: "No edits; short picks are recorded on the picklist" },
  { status: "invoiced", label: "Invoiced", editable: "Locked — changes only through invoice void and re-issue" },
  { status: "delivered", label: "Delivered / partially delivered", editable: "Locked — corrections through returns or the void process" },
  { status: "voided", label: "Cancelled / voided", editable: "Locked — shown as reversed in history" },
];

export async function outletPosition(outletId: string): Promise<OutletPosition> {
  const now = new Date();
  const [invoices, open, outstanding] = await Promise.all([
    prisma.invoice.findMany({ where: { outletId, status: { in: ["unpaid", "partially_paid", "overdue"] } }, include: { arLedgerEntries: true } }),
    prisma.salesOrder.aggregate({ where: { outletId, status: { in: ["confirmed", "picked", "on_hold"] } }, _sum: { total: true } }),
    outletBalance(outletId),
  ]);
  let overdueAmount = 0;
  let oldest = 0;
  for (const inv of invoices) {
    const bal = invoiceBalance(inv);
    if (inv.dueDate < now && bal > 0) {
      overdueAmount += bal;
      oldest = Math.max(oldest, Math.floor((now.getTime() - inv.dueDate.getTime()) / 86400000));
    }
  }
  return { outstanding: Math.max(0, outstanding), overdueAmount, oldestOverdueDays: oldest, openOrderValue: open._sum.total ?? 0 };
}

function severityOf(settings: Record<string, string>, key: string): "block" | "warn" | "off" {
  const v = settings[key];
  return v === "warn" || v === "off" ? v : "block";
}

export interface ValidationInput {
  outletId: string;
  items: { productId: string; qty: number }[];
  pricing: PricingResult;
  warehouseId?: string | null; // for warehouse-allocated orders; null for van sales
  vanId?: string | null; // for van sales
  discountOverridePct?: number;
  devicePrices?: Record<string, number>;
  clientRef?: string;
  excludeOrderId?: string;
}

// Runs every check in one pass so the user sees all issues at once; severity is configurable.
export async function validateOrder(input: ValidationInput): Promise<{ checks: Check[]; position: OutletPosition; blocking: boolean; warnings: number }> {
  const settings = await getAllSettings();
  const { outlet, lines, total } = input.pricing;
  const position = await outletPosition(outlet.id);
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  // customer status
  if (outlet.status !== "active" || outlet.onboardingStatus !== "approved") {
    add({ id: "customer", label: "Customer status", outcome: "block", message: `${outlet.name} is ${outlet.status === "blocked" ? `blocked (${outlet.blockedReason ?? "no reason recorded"})` : outlet.onboardingStatus !== "approved" ? "not yet approved" : "inactive"} and cannot be sold to.` });
  } else if (outlet.creditStatus === "on_hold" || outlet.creditStatus === "blocked") {
    add({ id: "customer", label: "Customer status", outcome: "block", message: `Credit status is ${outlet.creditStatus.replace("_", " ")} — new orders are held until a supervisor releases it.` });
  } else if (outlet.creditStatus === "on_watch") {
    add({ id: "customer", label: "Customer status", outcome: "warn", message: "Customer is on the credit watch list." });
  } else {
    add({ id: "customer", label: "Customer status", outcome: "pass", message: "Active and approved." });
  }

  // quantity rules (minimum order quantity)
  const products = await prisma.product.findMany({ where: { id: { in: input.items.map((i) => i.productId) } } });
  const belowMin = input.items.filter((i) => i.qty < (products.find((p) => p.id === i.productId)?.minOrderQty ?? 1));
  add(
    belowMin.length
      ? { id: "quantity", label: "Minimum order quantity", outcome: "block", message: `Below the minimum order quantity: ${belowMin.map((i) => products.find((p) => p.id === i.productId)?.name).join(", ")}.` }
      : { id: "quantity", label: "Minimum order quantity", outcome: "pass", message: "All quantities meet the minimum." },
  );

  // price vs. what the device calculated
  const mismatched = Object.entries(input.devicePrices ?? {}).filter(([pid, price]) => {
    const l = lines.find((x) => x.productId === pid);
    return l && Math.abs(l.unitPrice - price) > 0.009;
  });
  add(
    mismatched.length
      ? { id: "price", label: "Price", outcome: "warn", message: `The device price differed from the effective price list for ${mismatched.length} line(s); the DMS price was used and the variance is flagged for review.` }
      : { id: "price", label: "Price", outcome: "pass", message: "Matches the effective price list." },
  );

  // promotions
  const promoLines = lines.filter((l) => l.promotionId && l.discount > 0);
  add({ id: "promotion", label: "Promotion", outcome: "pass", message: promoLines.length || input.pricing.orderPromos.length ? `${promoLines.length + input.pricing.orderPromos.length} promotion benefit(s) applied automatically.` : "No promotion applies." });

  // discount beyond rules
  if (input.discountOverridePct && input.discountOverridePct > 0) {
    const sev = severityOf(settings, "validation.discount");
    add({ id: "discount", label: "Discount", outcome: sev === "off" ? "pass" : sev === "warn" ? "warn" : "block", message: `A ${input.discountOverridePct}% discount beyond the configured rules was requested — it needs an approved override.` });
  } else {
    add({ id: "discount", label: "Discount", outcome: "pass", message: "Within the configured rules." });
  }

  // credit limit
  const projected = position.outstanding + total;
  const creditSev = severityOf(settings, "validation.credit");
  if (projected > outlet.creditLimit) {
    add({ id: "credit", label: "Credit limit", outcome: creditSev === "off" ? "pass" : creditSev === "warn" ? "warn" : "block", message: `Outstanding ₱${position.outstanding.toLocaleString()} + this order ₱${total.toLocaleString()} = ₱${projected.toLocaleString()} exceeds the credit limit of ₱${outlet.creditLimit.toLocaleString()}.` });
  } else if (outlet.creditLimit > 0 && projected >= (outlet.creditLimit * num(settings, "credit.nearLimitPct")) / 100) {
    add({ id: "credit", label: "Credit limit", outcome: "warn", message: `Near the limit: ₱${(outlet.creditLimit - projected).toLocaleString()} of credit would remain.` });
  } else {
    add({ id: "credit", label: "Credit limit", outcome: "pass", message: `Within limit — ₱${(outlet.creditLimit - projected).toLocaleString()} of credit would remain.` });
  }

  // overdue receivables
  const overdueSev = severityOf(settings, "validation.overdue");
  const overdueBreach = position.overdueAmount > num(settings, "credit.overdueAmount") || (position.overdueAmount > 0 && position.oldestOverdueDays > num(settings, "credit.overdueDays"));
  add(
    overdueBreach
      ? { id: "overdue", label: "Overdue receivables", outcome: overdueSev === "off" ? "pass" : overdueSev === "warn" ? "warn" : "block", message: `₱${position.overdueAmount.toLocaleString()} is overdue (oldest ${position.oldestOverdueDays} days), beyond the allowed policy.` }
      : { id: "overdue", label: "Overdue receivables", outcome: "pass", message: position.overdueAmount > 0 ? `₱${position.overdueAmount.toLocaleString()} overdue, within the allowed policy.` : "Nothing overdue." },
  );

  // stock availability
  const short: string[] = [];
  for (const item of input.items) {
    const name = products.find((p) => p.id === item.productId)?.name ?? item.productId;
    let avail = 0;
    if (input.warehouseId) {
      avail = (await fefoLots(input.warehouseId, item.productId)).reduce((s, r) => s + availableOf(r), 0);
    } else if (input.vanId) {
      const rows = await prisma.stockBalance.findMany({ where: { locationType: "van", vanId: input.vanId, productId: item.productId } });
      avail = rows.reduce((s, r) => s + r.qtyGood, 0);
    } else continue;
    if (avail < item.qty) short.push(`${name} (need ${item.qty}, available ${avail})`);
  }
  const stockSev = severityOf(settings, "validation.stock");
  add(
    short.length
      ? { id: "stock", label: "Stock availability", outcome: stockSev === "off" ? "pass" : stockSev === "warn" || settings["orders.shortagePolicy"] === "partial_backorder" ? "warn" : "block", message: `${input.vanId ? "Not enough on the van" : "Shortage"}: ${short.join("; ")}.${settings["orders.shortagePolicy"] === "partial_backorder" && input.warehouseId ? " Available stock will be allocated and the balance kept as backorder." : ""}` }
      : { id: "stock", label: "Stock availability", outcome: "pass", message: "Fully available." },
  );

  // duplicate order
  const windowH = num(settings, "orders.duplicateWindowHours");
  const since = new Date(Date.now() - windowH * 3600000);
  let dup: { orderNumber: string } | null = null;
  if (input.clientRef) dup = await prisma.salesOrder.findFirst({ where: { clientRef: input.clientRef, ...(input.excludeOrderId ? { id: { not: input.excludeOrderId } } : {}) }, select: { orderNumber: true } });
  if (!dup) {
    const recent = await prisma.salesOrder.findMany({
      where: { outletId: outlet.id, orderDate: { gte: since }, status: { notIn: ["voided", "draft"] }, ...(input.excludeOrderId ? { id: { not: input.excludeOrderId } } : {}) },
      include: { lines: true },
      take: 20,
    });
    const sig = (ls: { productId: string; qty: number }[]) => ls.map((l) => `${l.productId}:${l.qty}`).sort().join("|");
    const mine = sig(input.items);
    dup = recent.find((o) => sig(o.lines) === mine) ?? null;
  }
  const dupSev = severityOf(settings, "validation.duplicate");
  add(dup ? { id: "duplicate", label: "Duplicate order", outcome: dupSev === "off" ? "pass" : dupSev === "block" ? "block" : "warn", message: `Matches ${dup.orderNumber}, raised for the same customer within ${windowH} hours.` } : { id: "duplicate", label: "Duplicate order", outcome: "pass", message: "No matching recent order." });

  return { checks, position, blocking: checks.some((c) => c.outcome === "block"), warnings: checks.filter((c) => c.outcome === "warn").length };
}

// ---------------------------------------------------------------------------
// Allocation (FEFO, possibly across several lots) and release
// ---------------------------------------------------------------------------

export async function allocateOrder(orderId: string, policyOverride?: "hold" | "partial_backorder") {
  const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
  const settings = await getAllSettings();
  const policy = policyOverride ?? (settings["orders.shortagePolicy"] === "partial_backorder" ? "partial_backorder" : "hold");
  const warehouse = await prisma.warehouse.findFirst({ where: { branchId: order.branchId, type: "saleable", status: "active" } });
  if (!warehouse) return { fully: false, allocated: 0, short: order.lines.length };

  // pass 1: work out what each line can get, without touching stock yet
  const plan: { line: (typeof order.lines)[number]; picks: { rowId: string; lot: string; qty: number }[]; need: number }[] = [];
  let anyShort = false;
  for (const line of order.lines) {
    const have = await prisma.orderAllocation.aggregate({ where: { salesOrderLineId: line.id, status: { in: ["reserved", "dispatched"] } }, _sum: { qty: true } });
    const need = line.qty - (have._sum.qty ?? 0);
    if (need <= 0) continue;
    const lots = await fefoLots(warehouse.id, line.productId);
    const picks: { rowId: string; lot: string; qty: number }[] = [];
    let left = need;
    for (const r of lots) {
      if (left <= 0) break;
      const take = Math.min(availableOf(r), left);
      if (take > 0) {
        picks.push({ rowId: r.id, lot: r.lotNumber, qty: take });
        left -= take;
      }
    }
    if (left > 0) anyShort = true;
    plan.push({ line, picks, need });
  }
  // "hold" policy reserves nothing unless every line can be covered in full
  if (anyShort && policy === "hold") {
    for (const p of plan) await prisma.salesOrderLine.update({ where: { id: p.line.id }, data: { qtyBackorder: p.need } });
    await prisma.salesOrder.update({ where: { id: orderId }, data: { allocationStatus: "not_allocated" } });
    return { fully: false, allocated: 0, short: plan.filter((p) => p.picks.reduce((s, x) => s + x.qty, 0) < p.need).length };
  }
  let allocatedTotal = 0;
  for (const p of plan) {
    let got = 0;
    for (const pick of p.picks) {
      await prisma.orderAllocation.create({ data: { salesOrderLineId: p.line.id, warehouseId: warehouse.id, productId: p.line.productId, lotNumber: pick.lot, qty: pick.qty } });
      await prisma.stockBalance.update({ where: { id: pick.rowId }, data: { qtyReserved: { increment: pick.qty } } });
      got += pick.qty;
    }
    allocatedTotal += got;
    await prisma.salesOrderLine.update({
      where: { id: p.line.id },
      data: { qtyBackorder: p.need - got, reservedLotNumber: p.line.reservedLotNumber ?? p.picks[0]?.lot ?? null },
    });
  }
  const fully = !anyShort;
  await prisma.salesOrder.update({ where: { id: orderId }, data: { allocationStatus: fully ? "fully_allocated" : allocatedTotal > 0 ? "partially_allocated" : "not_allocated" } });
  return { fully, allocated: allocatedTotal, short: anyShort ? 1 : 0 };
}

export async function releaseOrderAllocations(orderId: string) {
  const lines = await prisma.salesOrderLine.findMany({ where: { salesOrderId: orderId }, select: { id: true } });
  const allocs = await prisma.orderAllocation.findMany({ where: { salesOrderLineId: { in: lines.map((l) => l.id) }, status: "reserved" } });
  for (const a of allocs) {
    const row = await prisma.stockBalance.findFirst({ where: { warehouseId: a.warehouseId, productId: a.productId, lotNumber: a.lotNumber } });
    if (row) await prisma.stockBalance.update({ where: { id: row.id }, data: { qtyReserved: Math.max(0, row.qtyReserved - a.qty) } });
    await prisma.orderAllocation.update({ where: { id: a.id }, data: { status: "released" } });
  }
  await prisma.salesOrder.update({ where: { id: orderId }, data: { allocationStatus: "released" } });
  return allocs.length;
}

// A stock receipt can unblock orders waiting on stock: allocate what they were missing.
export async function reallocateWaitingOrders(branchId: string) {
  const waiting = await prisma.salesOrder.findMany({
    where: { branchId, status: { in: ["confirmed", "on_hold"] }, orderType: "pre_sales", lines: { some: { qtyBackorder: { gt: 0 } } } },
    select: { id: true, status: true },
  });
  let n = 0;
  for (const o of waiting) {
    if (o.status === "on_hold") continue; // held orders wait for a supervisor decision first
    const r = await allocateOrder(o.id, "partial_backorder");
    if (r.allocated > 0) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Invoicing, dispatch and delivery
// ---------------------------------------------------------------------------

export async function nextInvoiceNumber(branchId: string) {
  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
  const last = await prisma.invoice.findFirst({ where: { branchId, branchSeq: { not: null } }, orderBy: { branchSeq: "desc" }, select: { branchSeq: true } });
  const seq = (last?.branchSeq ?? (await prisma.invoice.count({ where: { branchId } }))) + 1;
  const prefix = (branch.code ?? branch.name.slice(0, 3)).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return { seq, number: `${prefix}-INV-${String(seq).padStart(6, "0")}` };
}

export function vatOf(vatInclusive: number, rate = 0.12) {
  return Math.round((vatInclusive - vatInclusive / (1 + rate)) * 100) / 100;
}

export function dueDateFor(terms: string | null | undefined, from = new Date()) {
  return new Date(from.getTime() + creditDays(terms) * 86400000);
}

// Dispatch the reserved stock of an order line quantity out of the warehouse (reservation → deduction).
export async function dispatchAllocations(orderId: string, user: string, ref: { number: string; id: string }) {
  const lines = await prisma.salesOrderLine.findMany({ where: { salesOrderId: orderId } });
  const allocs = await prisma.orderAllocation.findMany({ where: { salesOrderLineId: { in: lines.map((l) => l.id) }, status: "reserved" } });
  for (const a of allocs) {
    const row = await prisma.stockBalance.findFirst({ where: { warehouseId: a.warehouseId, productId: a.productId, lotNumber: a.lotNumber } });
    if (row) {
      await prisma.stockBalance.update({ where: { id: row.id }, data: { qtyReserved: Math.max(0, row.qtyReserved - a.qty) } });
      await changeBalance(row.id, "good", -a.qty, { type: "order_delivery", refType: "Invoice", refId: ref.id, refNumber: ref.number, userName: user, note: "Dispatched against invoice" });
    }
    await prisma.orderAllocation.update({ where: { id: a.id }, data: { status: "dispatched" } });
  }
}

// Put undelivered / returned units back on the shelf they came from.
export async function returnToWarehouse(orderId: string, productId: string, qty: number, bucket: "good" | "damaged", user: string, note: string) {
  const lines = await prisma.salesOrderLine.findMany({ where: { salesOrderId: orderId, productId }, select: { id: true } });
  const alloc = await prisma.orderAllocation.findFirst({ where: { salesOrderLineId: { in: lines.map((l) => l.id) }, status: "dispatched" }, orderBy: { createdAt: "asc" } });
  const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
  const wh = alloc ? { id: alloc.warehouseId, lot: alloc.lotNumber } : { id: (await prisma.warehouse.findFirst({ where: { branchId: order.branchId, type: "saleable" } }))?.id ?? "", lot: "RETURNED" };
  if (!wh.id) return;
  const src = await prisma.stockBalance.findFirst({ where: { warehouseId: wh.id, productId, lotNumber: wh.lot } });
  await addToLot({ locationType: "warehouse", warehouseId: wh.id }, productId, wh.lot, src?.expiryDate ?? null, bucket, qty, { type: "void_restore", refType: "SalesOrder", refId: orderId, refNumber: order.orderNumber, userName: user, note });
}

export type { PricedLine };
export { priceOrder };
