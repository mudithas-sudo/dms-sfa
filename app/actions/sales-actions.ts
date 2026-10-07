"use server";

import { revalidatePath } from "next/cache";
import { currentVatRate } from "@/lib/reference";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { assertCan } from "@/lib/rbac";
import { sendMessage } from "@/lib/integration";
import { getAllSettings, getNumberSetting } from "@/lib/settings";
import { actorName, availableOf, fefoMode } from "@/lib/stock";
import { priceOrder, recordPromoUsage } from "@/lib/pricing";
import {
  allocateOrder, dispatchAllocations, dueDateFor, nextInvoiceNumber, outletPosition, releaseOrderAllocations, returnToWarehouse, validateOrder, vatOf, type Check,
} from "@/lib/orders";

function fail(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
}
function ok(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(message)}`);
}
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const intOf = (f: FormData, k: string) => {
  const n = Math.floor(Number(f.get(k)));
  return Number.isFinite(n) ? n : 0;
};

function itemsFrom(formData: FormData) {
  const items: { productId: string; qty: number }[] = [];
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith("qty_")) continue;
    const qty = Math.floor(Number(v));
    if (Number.isFinite(qty) && qty > 0) items.push({ productId: k.slice(4), qty });
  }
  return items;
}

async function nextOrderNumber() {
  const last = await prisma.salesOrder.findFirst({ orderBy: { orderNumber: "desc" }, select: { orderNumber: true } });
  const n = last ? Number(last.orderNumber.replace("SO-", "")) : 0;
  return `SO-${String(n + 1).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Live pre-check for the backend order screen: customer status, credit position, price,
// promotions and every validation outcome, before anything is saved.
// ---------------------------------------------------------------------------

export async function previewBackendOrder(outletId: string, items: { productId: string; qty: number }[], discountPct = 0) {
  if (!outletId) return null;
  const outlet = await prisma.outlet.findUnique({ where: { id: outletId }, include: { channel: true } });
  if (!outlet) return null;
  const position = await outletPosition(outletId);
  if (items.length === 0) {
    return { outlet: { name: outlet.name, code: outlet.code, status: outlet.status, creditStatus: outlet.creditStatus, creditLimit: outlet.creditLimit, paymentTerms: outlet.paymentTerms, channel: outlet.channel.name }, position, checks: [] as Check[], lines: [], subtotal: 0, discountTotal: 0, total: 0, hints: {} as Record<string, string> };
  }
  const pricing = await priceOrder(outletId, items);
  const warehouse = await prisma.warehouse.findFirst({ where: { branchId: outlet.branchId, type: "saleable", status: "active" } });
  const v = await validateOrder({ outletId, items, pricing, warehouseId: warehouse?.id ?? null, discountOverridePct: discountPct });
  return {
    outlet: { name: outlet.name, code: outlet.code, status: outlet.status, creditStatus: outlet.creditStatus, creditLimit: outlet.creditLimit, paymentTerms: outlet.paymentTerms, channel: outlet.channel.name },
    position, checks: v.checks,
    lines: pricing.lines.map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: l.unitPrice, discount: l.discount, lineTotal: l.lineTotal, promos: l.promoNames ?? [] })),
    subtotal: pricing.subtotal, discountTotal: pricing.discountTotal, total: pricing.total, hints: pricing.hints,
  };
}

// ---------------------------------------------------------------------------
// Backend (manual) order entry
// ---------------------------------------------------------------------------

const HOLD_TYPE: Record<string, string> = {
  credit: "credit_limit_exception",
  stock: "stock_shortage",
  overdue: "overdue_balance",
  duplicate: "duplicate_order",
  discount: "discount_override",
};

// Creates the order, runs the validation engine, then either confirms + allocates it or puts it on hold
// with one approval request per blocking check. `intent=draft` saves without validating or reserving stock.
export async function createBackendOrder(formData: FormData) {
  await assertCan("sales", "edit");
  const { branchId, userId } = await getSession();
  const back = "/supervisor/orders/new";
  if (!branchId || !userId) fail(back, "Select a branch user first.");
  const outletId = str(formData, "outletId");
  const intent = str(formData, "intent") === "draft" ? "draft" : "submit";
  const items = itemsFrom(formData);
  if (!outletId) fail(back, "Choose the customer.");
  if (items.length === 0) fail(back, "Add at least one product line.");

  const [outlet, branch, requester] = await Promise.all([
    prisma.outlet.findUniqueOrThrow({ where: { id: outletId } }),
    prisma.branch.findUniqueOrThrow({ where: { id: branchId } }),
    actorName("Supervisor"),
  ]);
  // Users can only enter orders for customers of their own branch.
  if (outlet.branchId !== branchId) fail(back, "Users can only enter orders for customers of their own branch.");
  if (branch.status !== "active") fail(back, "This branch is inactive and cannot transact.");

  const pricing = await priceOrder(outletId, items);
  const warehouse = await prisma.warehouse.findFirst({ where: { branchId, type: "saleable", status: "active" } });
  const discountPct = Number(str(formData, "overridePct")) || 0;
  const overrideReason = str(formData, "overrideReason");
  if (discountPct > 0 && !overrideReason) fail(back, "A reason is required for a discount override request.");
  const settings = await getAllSettings();

  const base = {
    outletId, branchId, salespersonId: userId, source: "backend", orderType: "pre_sales",
    subtotal: pricing.subtotal, discountTotal: pricing.discountTotal, total: pricing.total,
    paymentTerms: str(formData, "paymentTerms") || outlet.paymentTerms,
    requestedDeliveryDate: str(formData, "requestedDeliveryDate") ? new Date(str(formData, "requestedDeliveryDate")) : null,
    remarks: str(formData, "remarks") || null,
    deliveryAddress: str(formData, "deliveryAddress") || outlet.address,
  };
  const makeLines = async (orderId: string) => {
    for (const l of pricing.lines) {
      await prisma.salesOrderLine.create({
        data: { salesOrderId: orderId, productId: l.productId, qty: l.qty, unitPrice: l.unitPrice, discount: l.discount, lineTotal: l.lineTotal, promotionId: l.promotionId },
      });
    }
  };

  if (intent === "draft") {
    const order = await prisma.salesOrder.create({ data: { ...base, orderNumber: await nextOrderNumber(), status: "draft", allocationStatus: "not_allocated" } });
    await makeLines(order.id);
    await logAudit("SalesOrder", order.id, "draft", `Saved draft backend order ${order.orderNumber} for ${outlet.name}`, { after: { total: pricing.total } });
    ok(`/supervisor/orders/${order.id}`, `Draft ${order.orderNumber} saved. Drafts do not reserve stock until they pass validation and are confirmed.`);
  }

  const v = await validateOrder({ outletId, items, pricing, warehouseId: warehouse?.id ?? null, discountOverridePct: discountPct });
  // a customer who cannot be sold to stops the order outright; every other block becomes a supervisor decision
  const customerBlock = v.checks.find((c) => c.id === "customer" && c.outcome === "block");
  const qtyBlock = v.checks.find((c) => (c.id === "quantity" || c.id === "multiple") && c.outcome === "block");
  if (customerBlock) fail(back, customerBlock.message);
  if (qtyBlock) fail(back, qtyBlock.message);

  const holds = v.checks.filter((c) => c.outcome === "block" && HOLD_TYPE[c.id]);
  const order = await prisma.salesOrder.create({
    data: {
      ...base, orderNumber: await nextOrderNumber(), status: holds.length ? "on_hold" : "confirmed", allocationStatus: "not_allocated",
      validationResult: JSON.stringify(v.checks),
      creditHoldReason: holds.length ? holds.map((h) => h.message).join(" ") : null,
    },
  });
  await makeLines(order.id);

  if (holds.length) {
    for (const h of holds) {
      await prisma.approvalRequest.create({
        data: {
          type: HOLD_TYPE[h.id], salesOrderId: order.id, requestedBy: requester, branchId, outletId,
          amount: h.id === "credit" ? Math.max(0, v.position.outstanding + pricing.total - outlet.creditLimit) : h.id === "discount" ? discountPct : pricing.total,
          reason: h.id === "discount" ? `${outlet.name}: ${discountPct}% discount beyond the rules — ${overrideReason}` : `${outlet.name}: ${h.message}`,
          payload: h.id === "discount" ? JSON.stringify({ pct: discountPct, reason: overrideReason }) : null,
        },
      });
    }
    await logAudit("SalesOrder", order.id, "hold", `Backend order ${order.orderNumber} held: ${holds.map((h) => h.label).join(", ")}`, { after: { checks: v.checks.filter((c) => c.outcome !== "pass").map((c) => c.id) } });
    await notify({ role: "supervisor", branchId, title: "Order held for approval", body: `${order.orderNumber} — ${holds.map((h) => h.label).join(", ")}`, link: "/supervisor/approvals", kind: "approval" });
    revalidatePath("/supervisor/orders");
    redirect(`/supervisor/orders/${order.id}`);
  }

  const alloc = await allocateOrder(order.id);
  await recordPromoUsage(pricing.lines, pricing.orderPromos);
  await logAudit("SalesOrder", order.id, "confirm", `Backend order ${order.orderNumber} confirmed (${alloc.fully ? "fully" : alloc.allocated > 0 ? "partially" : "not"} allocated) for ${outlet.name}`, { after: { total: pricing.total, source: "backend" } });
  if (!alloc.fully && alloc.allocated === 0 && settings["orders.shortagePolicy"] === "hold") {
    // nothing could be reserved under the "hold" policy — park it until stock arrives
    await prisma.salesOrder.update({ where: { id: order.id }, data: { status: "on_hold", creditHoldReason: "Insufficient available stock — held until stock arrives" } });
    await prisma.approvalRequest.create({ data: { type: "stock_shortage", salesOrderId: order.id, requestedBy: requester, branchId, outletId, amount: pricing.total, reason: `${outlet.name}: insufficient available warehouse stock` } });
  }
  revalidatePath("/supervisor/orders");
  redirect(`/supervisor/orders/${order.id}`);
}

// Edit a draft or on-hold order's lines: it is re-priced and re-validated.
export async function updateOrderLines(formData: FormData) {
  await assertCan("sales", "edit");
  const id = str(formData, "id");
  const back = `/supervisor/orders/${id}`;
  const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  if (!["draft", "on_hold"].includes(order.status)) fail(back, `A ${order.status} order is locked — change it through cancel / void.`);
  const items = itemsFrom(formData);
  if (items.length === 0) fail(back, "An order needs at least one line.");
  const pricing = await priceOrder(order.outletId, items);
  const lineIds = order.lines.map((l) => l.id);
  await prisma.orderAllocation.deleteMany({ where: { salesOrderLineId: { in: lineIds } } });
  await prisma.salesOrderLine.deleteMany({ where: { salesOrderId: id } });
  for (const l of pricing.lines) {
    await prisma.salesOrderLine.create({ data: { salesOrderId: id, productId: l.productId, qty: l.qty, unitPrice: l.unitPrice, discount: l.discount, lineTotal: l.lineTotal, promotionId: l.promotionId } });
  }
  await prisma.salesOrder.update({ where: { id }, data: { subtotal: pricing.subtotal, discountTotal: pricing.discountTotal, total: pricing.total } });
  await logAudit("SalesOrder", id, "edit", `Edited lines of ${order.orderNumber}; re-priced to ₱${pricing.total.toLocaleString()}`, { before: { total: order.total }, after: { total: pricing.total } });
  ok(back, order.status === "draft" ? "Draft updated. Submit it to validate and reserve stock." : "Lines updated and re-priced — the order stays on hold until released.");
}

// A draft is submitted: it goes through the same validation as a new order.
export async function submitDraftOrder(formData: FormData) {
  await assertCan("sales", "edit");
  const id = str(formData, "id");
  const back = `/supervisor/orders/${id}`;
  const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id }, include: { lines: true, outlet: true } });
  if (order.status !== "draft") fail(back, "Only a draft can be submitted.");
  const items = order.lines.map((l) => ({ productId: l.productId, qty: l.qty }));
  const pricing = await priceOrder(order.outletId, items);
  const warehouse = await prisma.warehouse.findFirst({ where: { branchId: order.branchId, type: "saleable", status: "active" } });
  const v = await validateOrder({ outletId: order.outletId, items, pricing, warehouseId: warehouse?.id ?? null, excludeOrderId: id });
  const hard = v.checks.find((c) => (c.id === "customer" || c.id === "quantity" || c.id === "multiple") && c.outcome === "block");
  if (hard) fail(back, hard.message);
  const holds = v.checks.filter((c) => c.outcome === "block" && HOLD_TYPE[c.id]);
  await prisma.salesOrder.update({ where: { id }, data: { status: holds.length ? "on_hold" : "confirmed", validationResult: JSON.stringify(v.checks), creditHoldReason: holds.length ? holds.map((h) => h.message).join(" ") : null, total: pricing.total, subtotal: pricing.subtotal, discountTotal: pricing.discountTotal } });
  const requester = await actorName("Supervisor");
  if (holds.length) {
    for (const h of holds) {
      await prisma.approvalRequest.create({ data: { type: HOLD_TYPE[h.id], salesOrderId: id, requestedBy: requester, branchId: order.branchId, outletId: order.outletId, amount: pricing.total, reason: `${order.outlet.name}: ${h.message}` } });
    }
    ok(back, "Submitted — validation held the order for a supervisor decision.");
  }
  await allocateOrder(id);
  await recordPromoUsage(pricing.lines, pricing.orderPromos);
  await logAudit("SalesOrder", id, "confirm", `Submitted and confirmed ${order.orderNumber}`);
  ok(back, "Order confirmed and stock allocated.");
}

export async function deleteDraftOrder(formData: FormData) {
  await assertCan("sales", "edit");
  const id = str(formData, "id");
  const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id } });
  if (order.status !== "draft") fail(`/supervisor/orders/${id}`, "Only a draft can be deleted by its creator.");
  const lineIds = (await prisma.salesOrderLine.findMany({ where: { salesOrderId: id }, select: { id: true } })).map((l) => l.id);
  await prisma.orderAllocation.deleteMany({ where: { salesOrderLineId: { in: lineIds } } });
  await prisma.approvalRequest.deleteMany({ where: { salesOrderId: id } });
  await prisma.salesOrderLine.deleteMany({ where: { salesOrderId: id } });
  await prisma.salesOrder.delete({ where: { id } });
  await logAudit("SalesOrder", id, "delete", `Deleted draft order ${order.orderNumber}`);
  revalidatePath("/supervisor/orders");
  redirect("/supervisor/orders");
}

// Once confirmed, only remarks and the delivery date may change.
export async function updateOrderDetails(formData: FormData) {
  await assertCan("sales", "edit");
  const id = str(formData, "id");
  const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id } });
  if (["picked", "invoiced", "delivered", "partially_delivered", "voided", "cancelled"].includes(order.status)) fail(`/supervisor/orders/${id}`, `A ${order.status} order is locked.`);
  const before = { remarks: order.remarks, requestedDeliveryDate: order.requestedDeliveryDate };
  await prisma.salesOrder.update({ where: { id }, data: { remarks: str(formData, "remarks") || null, requestedDeliveryDate: str(formData, "requestedDeliveryDate") ? new Date(str(formData, "requestedDeliveryDate")) : null } });
  await logAudit("SalesOrder", id, "edit", `Updated remarks / delivery date of ${order.orderNumber}`, { before, after: { remarks: str(formData, "remarks"), requestedDeliveryDate: str(formData, "requestedDeliveryDate") } });
  ok(`/supervisor/orders/${id}`, "Remarks and delivery date saved.");
}

// Run after a hold is approved: re-allocate and move the order on (called from the approval decision).
export async function completeHeldOrder(orderId: string) {
  const order = await prisma.salesOrder.findUnique({ where: { id: orderId }, include: { lines: true, outlet: true } });
  if (!order || !["draft", "on_hold"].includes(order.status)) return;
  const pending = await prisma.approvalRequest.count({ where: { salesOrderId: orderId, status: "pending" } });
  if (pending > 0) return; // still waiting on other checks
  // an approved discount override reduces the order total
  const override = await prisma.approvalRequest.findFirst({ where: { salesOrderId: orderId, type: "discount_override", status: "approved" } });
  if (override?.payload) {
    const pct = (JSON.parse(override.payload) as { pct: number }).pct;
    let total = 0;
    for (const l of order.lines) {
      const extra = Math.round(l.lineTotal * (pct / 100));
      await prisma.salesOrderLine.update({ where: { id: l.id }, data: { discount: l.discount + extra, lineTotal: l.lineTotal - extra } });
      total += l.lineTotal - extra;
    }
    await prisma.salesOrder.update({ where: { id: orderId }, data: { total, discountTotal: order.discountTotal + (order.total - total) } });
  }
  if (order.orderType === "van_sale") return; // van sales complete in the SFA module
  await prisma.salesOrder.update({ where: { id: orderId }, data: { status: "confirmed", creditHoldReason: null } });
  await allocateOrder(orderId, "partial_backorder"); // an approved shortage exception ships what is available
  await logAudit("SalesOrder", orderId, "release", `Released ${order.orderNumber} from hold after approval`);
}

// ---------------------------------------------------------------------------
// Cancellation (before invoicing) — direct while draft / on hold, otherwise approved
// ---------------------------------------------------------------------------

export async function cancelOrder(formData: FormData) {
  await assertCan("sales", "edit");
  const id = str(formData, "id");
  const reason = str(formData, "reason");
  const back = `/supervisor/orders/${id}`;
  if (!reason) fail(back, "A reason is required.");
  const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id }, include: { picklistLines: true } });
  const requester = await actorName("Supervisor");
  if (["invoiced", "delivered", "partially_delivered"].includes(order.status)) fail(back, "An invoiced order is cancelled through the void process.");
  if (["voided", "cancelled"].includes(order.status)) fail(back, "This order is already cancelled.");
  if (["draft", "on_hold"].includes(order.status)) {
    await releaseOrderAllocations(id);
    await prisma.approvalRequest.updateMany({ where: { salesOrderId: id, status: "pending" }, data: { status: "rejected", decisionNote: "Order cancelled", decidedAt: new Date(), decidedBy: requester } });
    await prisma.salesOrder.update({ where: { id }, data: { status: "voided", voidReason: reason, cancelReason: reason } });
    await logAudit("SalesOrder", id, "cancel", `Cancelled ${order.orderNumber} — ${reason}`);
    ok(back, "Order cancelled.");
  }
  // confirmed / allocated / picked: an approval lists what the reversal will do
  const dup = await prisma.approvalRequest.count({ where: { salesOrderId: id, type: "order_cancel", status: "pending" } });
  if (dup) fail(back, "A cancellation request is already pending.");
  const reserved = await prisma.orderAllocation.aggregate({ where: { salesOrderLineId: { in: (await prisma.salesOrderLine.findMany({ where: { salesOrderId: id }, select: { id: true } })).map((l) => l.id) }, status: "reserved" }, _sum: { qty: true } });
  await prisma.approvalRequest.create({
    data: {
      type: "order_cancel", salesOrderId: id, requestedBy: requester, branchId: order.branchId, outletId: order.outletId, amount: order.total,
      reason: `${reason}. Effects on approval: release ${reserved._sum.qty ?? 0} reserved unit(s)${order.picklistLines.length ? " and cancel the open picklist lines" : ""}; the order stays visible as cancelled.`,
    },
  });
  await logAudit("SalesOrder", id, "cancel_request", `Requested cancellation of ${order.orderNumber} — ${reason}`);
  await notify({ role: "supervisor", branchId: order.branchId, title: "Order cancellation awaiting approval", body: `${order.orderNumber}: ${reason}`, link: "/supervisor/approvals", kind: "approval" });
  ok(back, "Cancellation requested — a supervisor must approve it.");
}

// Called from the approval decision for order_cancel.
export async function performOrderCancellation(orderId: string, reason: string, approver: string) {
  const order = await prisma.salesOrder.findUnique({ where: { id: orderId } });
  if (!order || order.status === "voided") return;
  await releaseOrderAllocations(orderId);
  const lineIds = (await prisma.salesOrderLine.findMany({ where: { salesOrderId: orderId }, select: { id: true } })).map((l) => l.id);
  const pls = await prisma.picklistLine.findMany({ where: { salesOrderLineId: { in: lineIds } }, select: { picklistId: true } });
  for (const pid of new Set(pls.map((p) => p.picklistId))) {
    const open = await prisma.picklist.findUnique({ where: { id: pid } });
    if (open && open.status !== "picked") await prisma.picklist.update({ where: { id: pid }, data: { status: "cancelled" } });
  }
  await prisma.salesOrder.update({ where: { id: orderId }, data: { status: "voided", voidReason: reason, cancelReason: reason } });
  await logAudit("SalesOrder", orderId, "cancel", `Cancelled ${order.orderNumber} (approved by ${approver}) — ${reason}`);
}

// Release stale reservations — orders confirmed but never picked within the configured window.
export async function releaseStaleReservations() {
  await assertCan("sales", "approve");
  const hours = await getNumberSetting("orders.reservationHours");
  const cutoff = new Date(Date.now() - hours * 3600000);
  const stale = await prisma.salesOrder.findMany({
    where: { status: "confirmed", orderDate: { lt: cutoff }, validationResult: { not: null }, picklistLines: { none: {} }, allocationStatus: { in: ["fully_allocated", "partially_allocated"] } },
  });
  for (const o of stale) {
    await releaseOrderAllocations(o.id);
    await prisma.salesOrder.update({ where: { id: o.id }, data: { status: "on_hold", creditHoldReason: `Reservation released after ${hours}h without picking` } });
    await logAudit("SalesOrder", o.id, "release", `Released stale reservation for ${o.orderNumber}`);
  }
  revalidatePath("/supervisor/orders");
  ok("/supervisor/orders", stale.length ? `${stale.length} unconfirmed reservation(s) released.` : "No stale reservations.");
}

// ---------------------------------------------------------------------------
// Picklists
// ---------------------------------------------------------------------------

function binFor(productId: string) {
  let h = 0;
  for (const c of productId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `Aisle ${String.fromCharCode(65 + (h % 6))} · Rack ${(h >> 3) % 12 + 1}`;
}

export async function generatePicklist(formData: FormData) {
  await assertCan("inventory", "edit");
  const { branchId } = await getSession();
  const back = "/branch/picklists";
  if (!branchId) fail(back, "Select a branch first.");
  const orderIds = formData.getAll("orderIds").map(String);
  if (orderIds.length === 0) fail(back, "Select at least one allocated order.");
  const orders = await prisma.salesOrder.findMany({ where: { id: { in: orderIds }, branchId, status: "confirmed" }, include: { lines: true, outlet: { include: { route: true } } } });
  if (orders.length === 0) fail(back, "Picklists are generated only from confirmed, allocated orders.");
  const user = await actorName("Warehouse");
  // the picklist number is unique across all branches, so the sequence is too
  const last = await prisma.picklist.findFirst({ orderBy: { picklistNumber: "desc" }, select: { picklistNumber: true } });
  const seq = last ? Number(last.picklistNumber.replace(/\D/g, "")) + 1 : 1;
  const routes = [...new Set(orders.map((o) => o.outlet.route?.name).filter(Boolean))];
  const pl = await prisma.picklist.create({
    data: { picklistNumber: `PL-${String(seq).padStart(5, "0")}`, branchId, generatedBy: user, groupLabel: orders.length > 1 ? `${orders.length} orders${routes.length ? ` · ${routes.join(", ")}` : ""}` : null },
  });
  let made = 0;
  const rows: { line: (typeof orders)[number]["lines"][number]; order: (typeof orders)[number] }[] = orders.flatMap((o) => o.lines.map((line) => ({ line, order: o })));
  for (const { line, order } of rows) {
    const allocs = await prisma.orderAllocation.findMany({ where: { salesOrderLineId: line.id, status: "reserved" } });
    for (const a of allocs) {
      const row = await prisma.stockBalance.findFirst({ where: { warehouseId: a.warehouseId, productId: a.productId, lotNumber: a.lotNumber } });
      await prisma.picklistLine.create({
        data: { picklistId: pl.id, salesOrderId: order.id, salesOrderLineId: line.id, productId: line.productId, lotNumber: a.lotNumber, expiryDate: row?.expiryDate ?? null, location: binFor(line.productId), qtyToPick: a.qty },
      });
      made++;
    }
  }
  if (made === 0) {
    await prisma.picklist.delete({ where: { id: pl.id } });
    fail(back, "Those orders have no allocated stock to pick yet.");
  }
  await logAudit("Picklist", pl.id, "generate", `Generated ${pl.picklistNumber} for ${orders.map((o) => o.orderNumber).join(", ")}`);
  revalidatePath(back);
  redirect(`/branch/picklists?pl=${pl.id}`);
}

export async function recordPicks(formData: FormData) {
  await assertCan("inventory", "edit");
  const id = str(formData, "id");
  const back = `/branch/picklists?pl=${id}`;
  const pl = await prisma.picklist.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  if (pl.status === "picked" || pl.status === "cancelled") fail(back, `This picklist is ${pl.status}.`);
  const user = await actorName("Warehouse");
  let filled = 0;
  for (const l of pl.lines) {
    const raw = formData.get(`picked_${l.id}`);
    if (raw === null || raw === "") continue;
    const q = Math.max(0, Math.floor(Number(raw)));
    if (q > l.qtyToPick) fail(back, "You cannot pick more than the quantity to pick.");
    await prisma.picklistLine.update({ where: { id: l.id }, data: { qtyPicked: q } });
    filled++;
  }
  const fresh = await prisma.picklistLine.findMany({ where: { picklistId: id } });
  const allDone = fresh.every((l) => l.qtyPicked !== null);
  if (!allDone) {
    await prisma.picklist.update({ where: { id }, data: { status: "in_progress" } });
    ok(back, `${filled} line(s) recorded — the picklist is in progress.`);
  }
  // short picks: release the shortfall and keep it as a backorder so the invoice reflects what was picked
  let shorts = 0;
  for (const l of fresh) {
    const short = l.qtyToPick - (l.qtyPicked ?? 0);
    if (short <= 0) continue;
    shorts += short;
    const alloc = await prisma.orderAllocation.findFirst({ where: { salesOrderLineId: l.salesOrderLineId, lotNumber: l.lotNumber ?? "", status: "reserved" } });
    if (alloc) {
      const row = await prisma.stockBalance.findFirst({ where: { warehouseId: alloc.warehouseId, productId: alloc.productId, lotNumber: alloc.lotNumber } });
      if (row) await prisma.stockBalance.update({ where: { id: row.id }, data: { qtyReserved: Math.max(0, row.qtyReserved - short) } });
      await prisma.orderAllocation.update({ where: { id: alloc.id }, data: { qty: Math.max(0, alloc.qty - short), status: alloc.qty - short <= 0 ? "released" : "reserved" } });
    }
    await prisma.salesOrderLine.update({ where: { id: l.salesOrderLineId }, data: { qtyBackorder: { increment: short } } });
  }
  const orderIds = [...new Set(fresh.map((l) => l.salesOrderId))];
  for (const oid of orderIds) {
    const mine = fresh.filter((l) => l.salesOrderId === oid);
    for (const lineId of new Set(mine.map((l) => l.salesOrderLineId))) {
      const picked = mine.filter((l) => l.salesOrderLineId === lineId).reduce((s, l) => s + (l.qtyPicked ?? 0), 0);
      await prisma.salesOrderLine.update({ where: { id: lineId }, data: { qtyPicked: picked } });
    }
    await prisma.salesOrder.update({ where: { id: oid }, data: { status: "picked" } });
  }
  await prisma.picklist.update({ where: { id }, data: { status: "picked", pickedBy: user, pickedAt: new Date() } });
  await logAudit("Picklist", id, "picked", `Picked ${pl.picklistNumber}${shorts ? ` with ${shorts} unit(s) short — order adjusted before invoicing` : ""}`);
  revalidatePath("/branch/picklists");
  ok(back, shorts ? `Picked with ${shorts} unit(s) short — the shortfall was kept as backorder and the order adjusted before invoicing.` : "Picklist complete — the orders are ready to invoice.");
}

// FEFO is suggested by default; in "suggest" mode staff may pick another lot with a recorded reason.
export async function overridePickLot(formData: FormData) {
  await assertCan("inventory", "edit");
  const lineId = str(formData, "lineId");
  const newLot = str(formData, "newLot");
  const reason = str(formData, "reason");
  const line = await prisma.picklistLine.findUniqueOrThrow({ where: { id: lineId }, include: { picklist: true } });
  const back = `/branch/picklists?pl=${line.picklistId}`;
  if ((await fefoMode()) === "enforce") fail(back, "FEFO is enforced for this branch — only the suggested lot can be picked.");
  if (!reason) fail(back, "A reason is required to change the suggested lot.");
  if (line.picklist.status === "picked" || line.picklist.status === "cancelled") fail(back, "This picklist is closed.");
  const alloc = await prisma.orderAllocation.findFirst({ where: { salesOrderLineId: line.salesOrderLineId, lotNumber: line.lotNumber ?? "", status: "reserved" } });
  if (!alloc) fail(back, "No reservation found for this line.");
  const target = await prisma.stockBalance.findFirst({ where: { warehouseId: alloc.warehouseId, productId: alloc.productId, lotNumber: newLot } });
  if (!target || availableOf(target) < alloc.qty) fail(back, `Lot ${newLot} does not have ${alloc.qty} unit(s) available.`);
  const old = await prisma.stockBalance.findFirst({ where: { warehouseId: alloc.warehouseId, productId: alloc.productId, lotNumber: alloc.lotNumber } });
  if (old) await prisma.stockBalance.update({ where: { id: old.id }, data: { qtyReserved: Math.max(0, old.qtyReserved - alloc.qty) } });
  await prisma.stockBalance.update({ where: { id: target.id }, data: { qtyReserved: { increment: alloc.qty } } });
  await prisma.orderAllocation.update({ where: { id: alloc.id }, data: { lotNumber: newLot } });
  await prisma.picklistLine.update({ where: { id: lineId }, data: { lotNumber: newLot, expiryDate: target.expiryDate, overrideReason: `${reason} (suggested ${line.lotNumber})` } });
  await logAudit("Picklist", line.picklistId, "override", `Changed picked lot ${line.lotNumber} → ${newLot} — ${reason}`);
  ok(back, `Lot changed to ${newLot} and the override was recorded.`);
}

export async function reprintPicklist(formData: FormData) {
  const id = str(formData, "id");
  const pl = await prisma.picklist.update({ where: { id }, data: { reprintCount: { increment: 1 } } });
  await logAudit("Picklist", id, "reprint", `Reprinted ${pl.picklistNumber} (copy #${pl.reprintCount})`);
  redirect(`/branch/picklists?pl=${id}&print=1`);
}

export async function cancelPicklist(formData: FormData) {
  await assertCan("inventory", "edit");
  const id = str(formData, "id");
  const pl = await prisma.picklist.findUniqueOrThrow({ where: { id } });
  if (pl.status === "picked") fail("/branch/picklists", "A completed picklist cannot be cancelled.");
  await prisma.picklist.update({ where: { id }, data: { status: "cancelled" } });
  await logAudit("Picklist", id, "cancel", `Cancelled picklist ${pl.picklistNumber}`);
  revalidatePath("/branch/picklists");
  redirect("/branch/picklists");
}

// ---------------------------------------------------------------------------
// Invoice, dispatch and delivery
// ---------------------------------------------------------------------------

export async function issueInvoice(formData: FormData) {
  await assertCan("sales", "edit");
  const id = str(formData, "orderId");
  const back = `/supervisor/orders/${id}`;
  const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id }, include: { lines: { include: { product: true } }, outlet: true } });
  if (order.status !== "picked") fail(back, "Invoices are issued only for confirmed and picked orders.");
  const user = await actorName("Branch Ops");
  const pos = await outletPosition(order.outletId);
  const picked = order.lines.map((l) => ({ l, qty: l.qtyPicked ?? l.qty })).filter((x) => x.qty > 0);
  if (picked.length === 0) fail(back, "Nothing was picked — nothing to invoice.");
  const value = picked.map((x) => ({ ...x, amount: Math.round((x.l.lineTotal * x.qty) / x.l.qty) }));
  const amount = value.reduce((s, x) => s + x.amount, 0);
  const { seq, number } = await nextInvoiceNumber(order.branchId);
  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber: number, branchSeq: seq, salesOrderId: id, outletId: order.outletId, branchId: order.branchId,
      dueDate: dueDateFor(order.paymentTerms ?? order.outlet.paymentTerms), amount, taxAmount: vatOf(amount, await currentVatRate()), status: "unpaid", deliveryStatus: "pending_delivery",
    },
  });
  for (const x of value) {
    await prisma.invoiceLine.create({ data: { invoiceId: invoice.id, productId: x.l.productId, qty: x.qty, unitPrice: x.l.unitPrice, lineTotal: x.amount } });
  }
  await prisma.aRLedgerEntry.create({ data: { outletId: order.outletId, invoiceId: invoice.id, type: "invoice", amount, balance: pos.outstanding + amount, reference: invoice.invoiceNumber } });
  await dispatchAllocations(id, user, { number: invoice.invoiceNumber, id: invoice.id });
  await prisma.salesOrder.update({ where: { id }, data: { status: "invoiced", allocationStatus: "dispatched" } });
  await sendMessage({ connector: "erp", direction: "outbound", docType: "financial_posting", reference: invoice.invoiceNumber, payload: { amount } });
  await logAudit("Invoice", invoice.id, "issue", `Issued invoice ${invoice.invoiceNumber} (₱${amount.toLocaleString()}) for ${order.orderNumber}; reserved stock dispatched`, { after: { amount, branchSeq: seq } });
  revalidatePath("/supervisor/orders");
  ok(back, `Invoice ${invoice.invoiceNumber} issued — stock dispatched; it is now locked (changes need a void and re-issue).`);
}

export async function markOutForDelivery(formData: FormData) {
  await assertCan("inventory", "edit");
  const id = str(formData, "invoiceId");
  const inv = await prisma.invoice.update({ where: { id }, data: { deliveryStatus: "out_for_delivery" } });
  await logAudit("Invoice", id, "dispatch", `Marked ${inv.invoiceNumber} out for delivery`);
  revalidatePath("/branch/deliveries");
  redirect("/branch/deliveries");
}

// Delivery receipt with the customer's signature. Receivables follow what was delivered; the rest
// is tracked as an undelivered balance until it is re-delivered, returned to stock or cancelled.
export async function confirmDelivery(formData: FormData) {
  await assertCan("inventory", "edit");
  const id = str(formData, "invoiceId");
  const back = "/branch/deliveries";
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id }, include: { lines: true, salesOrder: { include: { lines: true } } } });
  if (inv.deliveryStatus === "delivered" || inv.deliveryStatus === "partially_delivered") fail(back, "This invoice was already delivered.");
  const receiver = str(formData, "receivedBy");
  if (!receiver) fail(back, "Enter the name of the person who received the goods.");
  const count = await prisma.deliveryReceipt.count();
  let delivered = 0;
  let invoiced = 0;
  const lineResults: { line: (typeof inv.lines)[number]; qtyDelivered: number }[] = [];
  for (const l of inv.lines) {
    const q = Math.min(l.qty, Math.max(0, intOf(formData, `delivered_${l.id}`)));
    lineResults.push({ line: l, qtyDelivered: q });
    delivered += Math.round((l.lineTotal * q) / l.qty);
    invoiced += l.lineTotal;
    if (q < l.qty && !str(formData, `reason_${l.id}`)) fail(back, "Give a shortfall reason for every line delivered short.");
  }
  const totalQty = lineResults.reduce((s, r) => s + r.qtyDelivered, 0);
  const anyShort = lineResults.some((r) => r.qtyDelivered < r.line.qty);
  const status = totalQty === 0 ? "failed" : anyShort ? "partial" : "delivered";
  const dr = await prisma.deliveryReceipt.create({
    data: { drNumber: `DR-${String(count + 1).padStart(6, "0")}`, invoiceId: id, receivedBy: receiver, status, signatoryName: receiver, signatureDataUrl: str(formData, "signatureDataUrl") || null },
  });
  for (const r of lineResults) {
    await prisma.deliveryReceiptLine.create({ data: { deliveryReceiptId: dr.id, productId: r.line.productId, qtyOrdered: r.line.qty, qtyDelivered: r.qtyDelivered } });
    const ol = inv.salesOrder.lines.find((x) => x.productId === r.line.productId);
    if (ol) await prisma.salesOrderLine.update({ where: { id: ol.id }, data: { qtyDelivered: r.qtyDelivered } });
    if (r.qtyDelivered < r.line.qty) {
      await prisma.undeliveredBalance.create({ data: { invoiceId: id, productId: r.line.productId, qty: r.line.qty - r.qtyDelivered, reason: str(formData, `reason_${r.line.id}`) } });
    }
  }
  if (anyShort) {
    const pos = await outletPosition(inv.outletId);
    const diff = invoiced - delivered;
    await prisma.invoice.update({ where: { id }, data: { amount: delivered, taxAmount: vatOf(delivered, await currentVatRate()) } });
    await prisma.aRLedgerEntry.create({ data: { outletId: inv.outletId, invoiceId: id, type: "adjustment", amount: -diff, balance: pos.outstanding - diff, reference: dr.drNumber } });
  }
  const dStatus = status === "failed" ? "returned" : anyShort ? "partially_delivered" : "delivered";
  await prisma.invoice.update({ where: { id }, data: { deliveryStatus: dStatus } });
  await prisma.salesOrder.update({ where: { id: inv.salesOrderId }, data: { status: anyShort ? "partially_delivered" : "delivered" } });
  await logAudit("DeliveryReceipt", dr.id, "deliver", `Delivery ${dr.drNumber} for ${inv.invoiceNumber}: ${status}${anyShort ? ` — receivable adjusted to delivered quantities (₱${delivered.toLocaleString()})` : ""}`, undefined);
  revalidatePath("/branch/deliveries");
  revalidatePath("/supervisor/orders");
  ok(back, `${dr.drNumber} recorded${anyShort ? " — the undelivered balance is tracked until it is resolved" : ""}.`);
}

export async function resolveUndelivered(formData: FormData) {
  await assertCan("inventory", "edit");
  const id = str(formData, "id");
  const action = str(formData, "action"); // redeliver | return | cancel
  const back = "/branch/deliveries";
  const bal = await prisma.undeliveredBalance.findUniqueOrThrow({ where: { id }, include: { invoice: true } });
  if (bal.status !== "open" && bal.status !== "redelivery_scheduled") return;
  const user = await actorName("Delivery");
  if (action === "redeliver") {
    const date = str(formData, "redeliveryDate");
    if (!date) fail(back, "Choose the new delivery date.");
    await prisma.undeliveredBalance.update({ where: { id }, data: { status: "redelivery_scheduled", redeliveryDate: new Date(date) } });
    await prisma.invoice.update({ where: { id: bal.invoiceId }, data: { deliveryStatus: "redelivery_scheduled" } });
    await logAudit("UndeliveredBalance", id, "schedule", `Scheduled re-delivery of ${bal.qty} unit(s) for ${date}`);
  } else if (action === "complete") {
    // re-delivery done: receivables rise by the value now delivered
    const line = await prisma.invoiceLine.findFirst({ where: { invoiceId: bal.invoiceId, productId: bal.productId } });
    const unit = line ? line.lineTotal / Math.max(1, line.qty) : 0;
    const value = Math.round(unit * bal.qty);
    const pos = await outletPosition(bal.invoice.outletId);
    await prisma.invoice.update({ where: { id: bal.invoiceId }, data: { amount: { increment: value }, deliveryStatus: "delivered" } });
    await prisma.aRLedgerEntry.create({ data: { outletId: bal.invoice.outletId, invoiceId: bal.invoiceId, type: "adjustment", amount: value, balance: pos.outstanding + value, reference: `REDELIVERY-${bal.invoice.invoiceNumber}` } });
    await prisma.undeliveredBalance.update({ where: { id }, data: { status: "cancelled", resolvedBy: user, resolvedAt: new Date(), reason: `${bal.reason ?? ""} — re-delivered` } });
    await logAudit("UndeliveredBalance", id, "redeliver", `Re-delivered ${bal.qty} unit(s); receivable increased by ₱${value.toLocaleString()}`);
  } else {
    const bucket = str(formData, "condition") === "damaged" ? "damaged" : "good";
    await returnToWarehouse(bal.invoice.salesOrderId, bal.productId, bal.qty, bucket, user, action === "cancel" ? "Undelivered balance cancelled" : "Undelivered balance returned to stock");
    await prisma.undeliveredBalance.update({ where: { id }, data: { status: action === "cancel" ? "cancelled" : "returned_to_stock", resolvedBy: user, resolvedAt: new Date() } });
    await logAudit("UndeliveredBalance", id, action, `${action === "cancel" ? "Cancelled" : "Returned to stock"} ${bal.qty} undelivered unit(s) as ${bucket} stock`);
  }
  revalidatePath(back);
  redirect(back);
}
