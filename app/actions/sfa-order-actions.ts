"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { getAllSettings } from "@/lib/settings";
import { priceOrder, recordPromoUsage } from "@/lib/pricing";
import { allocateOrder, outletPosition, validateOrder, type Check } from "@/lib/orders";
import { getRepVan, sellableByProduct } from "@/lib/van";
import { completeVanSale } from "@/lib/vansale";
import { deliverySettings, deliveryCalendar, unavailableReason, earliestDelivery } from "@/lib/delivery";
import { invoiceBalance } from "@/lib/finance";

export interface FieldItem {
  productId: string;
  qty: number;
}

const HOLD_TYPE: Record<string, string> = {
  credit: "credit_limit_exception",
  stock: "stock_shortage",
  overdue: "overdue_balance",
  duplicate: "duplicate_order",
  discount: "discount_override",
};

async function nextOrderNumber() {
  const last = await prisma.salesOrder.findFirst({ orderBy: { orderNumber: "desc" }, select: { orderNumber: true } });
  const n = last ? Number(last.orderNumber.replace("SO-", "")) : 0;
  return `SO-${String(n + 1).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Context for the order screen: the customer's position, what they ordered last and most, the delivery calendar
// and how old the data on the device is.
// ---------------------------------------------------------------------------

export async function fieldOrderContext(outletId: string) {
  const { userId, branchId } = await getSession();
  const outlet = await prisma.outlet.findUnique({ where: { id: outletId }, include: { channel: true } });
  if (!outlet) return null;
  const [position, lastOrder, lines, settings, device, invoices] = await Promise.all([
    outletPosition(outletId),
    prisma.salesOrder.findFirst({ where: { outletId, status: { notIn: ["voided", "cancelled", "draft"] } }, orderBy: { orderDate: "desc" }, include: { lines: true } }),
    prisma.salesOrderLine.groupBy({ by: ["productId"], where: { salesOrder: { outletId, status: { notIn: ["voided", "cancelled", "draft"] } } }, _sum: { qty: true }, orderBy: { _sum: { qty: "desc" } }, take: 5 }),
    getAllSettings(),
    userId ? prisma.deviceRegistration.findUnique({ where: { userId } }) : null,
    prisma.invoice.findMany({ where: { outletId, status: { in: ["unpaid", "partially_paid", "overdue"] } }, include: { arLedgerEntries: true } }),
  ]);
  const rep = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
  const van = rep && branchId ? await getRepVan(branchId, rep) : null;
  const cal = deliveryCalendar(deliverySettings(settings));
  const sellable = van ? Object.fromEntries(await sellableByProduct(van.id)) : {};
  const staleH = Number(settings["sync.staleHours"] ?? 24);
  const ageH = device?.lastSyncAt ? (Date.now() - device.lastSyncAt.getTime()) / 3600000 : null;
  const open = invoices.map((i) => ({ number: i.invoiceNumber, bal: invoiceBalance(i), due: i.dueDate })).filter((i) => i.bal > 0);
  return {
    outlet: { id: outlet.id, name: outlet.name, code: outlet.code, creditLimit: outlet.creditLimit, creditStatus: outlet.creditStatus, terms: outlet.paymentTerms, channel: outlet.channel.name, address: outlet.address },
    position,
    available: outlet.creditLimit - position.outstanding - position.openOrderValue,
    lastOrder: lastOrder ? { number: lastOrder.orderNumber, date: lastOrder.orderDate.toISOString().slice(0, 10), items: lastOrder.lines.map((l) => ({ productId: l.productId, qty: l.qty })) } : null,
    topProducts: lines.map((l) => ({ productId: l.productId, qty: l._sum.qty ?? 0 })),
    calendar: cal,
    hasVan: !!van,
    sellable,
    dataAge: ageH === null ? "Data age unknown — sync once online." : ageH > staleH ? `Prices, stock and balances were last synced ${Math.round(ageH)} hours ago — they may be out of date.` : null,
    overdueInvoices: open.filter((i) => i.due < new Date()).length,
  };
}

export async function previewFieldOrder(outletId: string, items: FieldItem[], orderType: "pre_sales" | "van_sale", overridePct = 0) {
  const clean = items.filter((i) => i.qty > 0);
  if (!outletId || clean.length === 0) return null;
  const { userId, branchId } = await getSession();
  const pricing = await priceOrder(outletId, clean);
  let vanId: string | null = null;
  let warehouseId: string | null = null;
  if (orderType === "van_sale") {
    const rep = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
    vanId = rep && branchId ? (await getRepVan(branchId, rep))?.id ?? null : null;
  } else {
    warehouseId = (await prisma.warehouse.findFirst({ where: { branchId: pricing.outlet.branchId, type: "saleable", status: "active" } }))?.id ?? null;
  }
  const v = await validateOrder({ outletId, items: clean, pricing, warehouseId, vanId, discountOverridePct: overridePct });
  return {
    checks: v.checks as Check[],
    lines: pricing.lines.map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: l.unitPrice, discount: l.discount, lineTotal: l.lineTotal, promos: [...(l.ruleName ? [l.ruleName] : []), ...(l.promoNames ?? [])], free: l.freeQty ?? 0 })),
    subtotal: pricing.subtotal, discountTotal: pricing.discountTotal, total: pricing.total, hints: pricing.hints,
    orderPromos: pricing.orderPromos.map((o) => o.name),
  };
}

export interface SubmitInput {
  outletId: string;
  items: FieldItem[];
  orderType: "pre_sales" | "van_sale";
  intent: "submit" | "draft";
  clientRef: string;
  draftId?: string;
  requestedDeliveryDate?: string;
  urgent?: boolean;
  urgentReason?: string;
  signatoryName?: string;
  signatureDataUrl?: string | null;
  declinedReason?: string;
  remarks?: string;
  devicePrices?: Record<string, number>;
  overridePct?: number;
  overrideReason?: string;
  lat?: number;
  lng?: number;
}

export interface SubmitResult {
  ok: boolean;
  message: string;
  orderId?: string;
  orderNumber?: string;
  status?: string;
  invoiceNumber?: string;
  held?: string[];
  duplicate?: boolean;
  warnings?: string[];
}

// One entry point for every field order — a repeated submit with the same clientRef returns the original order,
// so a retry after a lost connection can never create a second one.
export async function submitFieldOrder(input: SubmitInput): Promise<SubmitResult> {
  const { userId, branchId } = await getSession();
  if (!userId || !branchId) return { ok: false, message: "No active session — sign in again." };
  const existing = await prisma.salesOrder.findUnique({ where: { clientRef: input.clientRef } });
  if (existing && !(input.draftId && existing.id === input.draftId)) {
    return { ok: true, duplicate: true, orderId: existing.id, orderNumber: existing.orderNumber, status: existing.status, message: `Already received as ${existing.orderNumber} — not duplicated.` };
  }
  const [rep, outlet, branch] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.outlet.findUnique({ where: { id: input.outletId } }),
    prisma.branch.findUnique({ where: { id: branchId } }),
  ]);
  if (!rep || !outlet) return { ok: false, message: "Invalid customer or representative." };
  if (branch?.status === "inactive") return { ok: false, message: "This branch is inactive and cannot transact." };
  if (outlet.branchId !== branchId) return { ok: false, message: "That customer belongs to another branch." };
  const items = input.items.filter((i) => Number.isFinite(i.qty) && i.qty > 0).map((i) => ({ productId: i.productId, qty: Math.floor(i.qty) }));
  if (items.length === 0) return { ok: false, message: "Add at least one product." };
  const settings = await getAllSettings();
  const cfg = deliverySettings(settings);
  const isVan = input.orderType === "van_sale";

  // delivery date (pre-sales) must respect the calendar unless the request is urgent
  let requested: Date | null = null;
  if (!isVan && input.requestedDeliveryDate) {
    requested = new Date(input.requestedDeliveryDate);
    const bad = unavailableReason(requested, cfg);
    if (!input.urgent && (bad || requested < earliestDelivery(cfg))) return { ok: false, message: bad ?? `The earliest delivery date is ${earliestDelivery(cfg).toISOString().slice(0, 10)} (cut-off ${cfg.cutoffHour}:00). Mark the order urgent to request an earlier date.` };
  }
  if (input.urgent && !input.urgentReason?.trim()) return { ok: false, message: "An urgent request needs a reason." };

  const pricing = await priceOrder(input.outletId, items);
  const base = {
    outletId: input.outletId, branchId, salespersonId: userId, source: "sfa", orderType: input.orderType,
    subtotal: pricing.subtotal, discountTotal: pricing.discountTotal, total: pricing.total,
    paymentTerms: outlet.paymentTerms, requestedDeliveryDate: requested,
    remarks: input.remarks?.trim() || null, deliveryAddress: outlet.address,
    urgentDelivery: !!input.urgent, urgentReason: input.urgent ? input.urgentReason?.trim() : null,
    clientRef: input.clientRef, capturedLat: input.lat ?? null, capturedLng: input.lng ?? null,
    signatoryName: input.signatoryName?.trim() || null, signatureDataUrl: input.signatureDataUrl ?? null,
    signatureDeclinedReason: input.declinedReason?.trim() || null,
  };
  const writeLines = async (orderId: string) => {
    await prisma.salesOrderLine.deleteMany({ where: { salesOrderId: orderId } });
    for (const l of pricing.lines) {
      await prisma.salesOrderLine.create({ data: { salesOrderId: orderId, productId: l.productId, qty: l.qty, unitPrice: l.unitPrice, discount: l.discount, lineTotal: l.lineTotal, promotionId: l.promotionId } });
    }
  };
  const upsert = async (data: Record<string, unknown>) => {
    if (input.draftId) {
      const d = await prisma.salesOrder.findUnique({ where: { id: input.draftId } });
      if (d && d.status === "draft" && d.salespersonId === userId) {
        await prisma.salesOrderLine.deleteMany({ where: { salesOrderId: d.id } });
        return prisma.salesOrder.update({ where: { id: d.id }, data: { ...data, amendedFromDraft: true } });
      }
    }
    return prisma.salesOrder.create({ data: { ...data, orderNumber: await nextOrderNumber() } as never });
  };

  if (input.intent === "draft") {
    const order = await upsert({ ...base, status: "draft", allocationStatus: "not_allocated" });
    await writeLines(order.id);
    await logAudit("SalesOrder", order.id, "draft", `Saved draft ${order.orderNumber} for ${outlet.name}`, { after: { total: pricing.total } });
    revalidatePath("/sfa/orders");
    return { ok: true, orderId: order.id, orderNumber: order.orderNumber, status: "draft", message: `Draft ${order.orderNumber} saved. It reserves no stock and can be amended or submitted later.` };
  }

  // van sale: the customer signs for goods handed over now — name and signature (or a recorded refusal) are required
  if (isVan) {
    if (!input.signatoryName?.trim()) return { ok: false, message: "Enter the name of the person who received the goods." };
    if (!input.signatureDataUrl && !input.declinedReason?.trim()) return { ok: false, message: "Capture the customer's signature, or record why they declined to sign." };
  } else if (input.signatureDataUrl && !input.signatoryName?.trim()) {
    return { ok: false, message: "Enter the signatory's name with the signature." };
  }
  if (input.overridePct && input.overridePct > 0 && !input.overrideReason?.trim()) return { ok: false, message: "A reason is required for a discount override request." };

  let vanId: string | null = null;
  let warehouseId: string | null = null;
  if (isVan) {
    const van = await getRepVan(branchId, rep);
    if (!van) return { ok: false, message: "No active van is assigned to you — van sales are not available." };
    vanId = van.id;
  } else {
    warehouseId = (await prisma.warehouse.findFirst({ where: { branchId, type: "saleable", status: "active" } }))?.id ?? null;
  }
  const v = await validateOrder({ outletId: input.outletId, items, pricing, warehouseId, vanId, devicePrices: input.devicePrices, clientRef: undefined, discountOverridePct: input.overridePct });
  const hard = v.checks.find((c) => ["customer", "quantity", "multiple"].includes(c.id) && c.outcome === "block") ?? (isVan ? v.checks.find((c) => c.id === "stock" && c.outcome === "block") : undefined);
  if (hard) return { ok: false, message: hard.message };
  const holds = v.checks.filter((c) => c.outcome === "block" && HOLD_TYPE[c.id]);
  const warnings = v.checks.filter((c) => c.outcome === "warn").map((c) => c.message);

  const order = await upsert({
    ...base, status: holds.length ? "on_hold" : "confirmed", allocationStatus: "not_allocated",
    validationResult: JSON.stringify(v.checks), creditHoldReason: holds.length ? holds.map((h) => h.message).join(" ") : null,
  });
  await writeLines(order.id);

  if (holds.length) {
    for (const h of holds) {
      await prisma.approvalRequest.create({
        data: {
          type: HOLD_TYPE[h.id], salesOrderId: order.id, requestedBy: rep.name, branchId, outletId: input.outletId,
          amount: h.id === "credit" ? Math.max(0, v.position.outstanding + pricing.total - outlet.creditLimit) : h.id === "discount" ? input.overridePct ?? 0 : pricing.total,
          reason: h.id === "discount" ? `${outlet.name}: ${input.overridePct}% discount beyond the rules — ${input.overrideReason}` : `${outlet.name}: ${h.message}`,
          payload: h.id === "discount" ? JSON.stringify({ pct: input.overridePct, reason: input.overrideReason }) : null,
        },
      });
    }
    await logAudit("SalesOrder", order.id, "hold", `${isVan ? "Van sale" : "Order"} ${order.orderNumber} held: ${holds.map((h) => h.label).join(", ")}`, { after: { source: "sfa" } });
    await notify({ role: "supervisor", branchId, title: "Field order held for approval", body: `${order.orderNumber} · ${outlet.name} — ${holds.map((h) => h.label).join(", ")}`, link: "/supervisor/approvals", kind: "approval" });
    revalidatePath("/sfa/orders");
    return { ok: true, orderId: order.id, orderNumber: order.orderNumber, status: "on_hold", held: holds.map((h) => h.message), warnings, message: `${order.orderNumber} is held for supervisor approval: ${holds.map((h) => h.label).join(", ")}.` };
  }

  await recordPromoUsage(pricing.lines, pricing.orderPromos);
  if (isVan) {
    try {
      const done = await completeVanSale(order.id, rep.name);
      revalidatePath("/sfa/orders");
      return { ok: true, orderId: order.id, orderNumber: order.orderNumber, status: "delivered", invoiceNumber: done.invoiceNumber, warnings, message: `Van sale ${order.orderNumber} completed — invoice ${done.invoiceNumber} issued.` };
    } catch (e) {
      await prisma.salesOrder.update({ where: { id: order.id }, data: { status: "draft", creditHoldReason: null } });
      return { ok: false, orderId: order.id, message: e instanceof Error ? e.message : "The van sale could not be completed." };
    }
  }
  const alloc = await allocateOrder(order.id);
  await logAudit("SalesOrder", order.id, "confirm", `Pre-sales order ${order.orderNumber} confirmed (${alloc.fully ? "fully" : alloc.allocated > 0 ? "partially" : "not"} allocated) for ${outlet.name}`, { after: { total: pricing.total, source: "sfa" } });
  if (!alloc.fully && alloc.allocated === 0 && settings["orders.shortagePolicy"] === "hold") {
    await prisma.salesOrder.update({ where: { id: order.id }, data: { status: "on_hold", creditHoldReason: "Insufficient available stock — held until stock arrives" } });
    await prisma.approvalRequest.create({ data: { type: "stock_shortage", salesOrderId: order.id, requestedBy: rep.name, branchId, outletId: input.outletId, amount: pricing.total, reason: `${outlet.name}: insufficient available warehouse stock` } });
    return { ok: true, orderId: order.id, orderNumber: order.orderNumber, status: "on_hold", warnings, held: ["Insufficient available warehouse stock"], message: `${order.orderNumber} is held — not enough warehouse stock is available yet.` };
  }
  if (input.urgent) await notify({ role: "branch_ops", branchId, title: "Urgent delivery requested", body: `${order.orderNumber} · ${outlet.name}: ${input.urgentReason}`, link: "/branch/picklists", kind: "action" });
  revalidatePath("/sfa/orders");
  return { ok: true, orderId: order.id, orderNumber: order.orderNumber, status: "confirmed", warnings, message: `Order ${order.orderNumber} sent to the branch${alloc.fully ? "" : " (partly allocated — the balance is on backorder)"}.` };
}

export async function deleteFieldDraft(orderId: string): Promise<{ ok: boolean; message: string }> {
  const { userId } = await getSession();
  const order = await prisma.salesOrder.findUnique({ where: { id: orderId } });
  if (!order || order.status !== "draft" || order.salespersonId !== userId) return { ok: false, message: "Only your own drafts can be deleted." };
  await prisma.salesOrderLine.deleteMany({ where: { salesOrderId: orderId } });
  await prisma.approvalRequest.deleteMany({ where: { salesOrderId: orderId } });
  await prisma.salesOrder.delete({ where: { id: orderId } });
  await logAudit("SalesOrder", orderId, "delete", `Deleted draft ${order.orderNumber}`);
  revalidatePath("/sfa/orders");
  return { ok: true, message: "Draft deleted." };
}

export async function suggestedQuantities(outletId: string, productIds: string[]) {
  const lines = await prisma.salesOrderLine.findMany({
    where: { productId: { in: productIds }, salesOrder: { outletId, status: { notIn: ["voided", "cancelled", "draft"] } } },
    orderBy: { salesOrder: { orderDate: "desc" } },
    take: 400,
  });
  const out: Record<string, number> = {};
  for (const pid of productIds) {
    const last = lines.filter((l) => l.productId === pid).slice(0, 3);
    if (last.length) out[pid] = Math.round(last.reduce((s, l) => s + l.qty, 0) / last.length);
  }
  return out;
}
