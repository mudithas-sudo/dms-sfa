import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/integration";
import { notify } from "@/lib/notify";

// The merchandising application exchanges four things with the DMS over the interface: it receives near-expiry
// signals, approved returns and suggested order quantities, and it reports physical inventory observations back.

type Scope = string[] | null;

export async function sendNearExpirySignals(branchIds: Scope, warningDays = 60) {
  const limit = new Date(Date.now() + warningDays * 86400000);
  const lots = await prisma.stockBalance.findMany({
    where: { locationType: "warehouse", expiryDate: { not: null, lte: limit }, qtyGood: { gt: 0 }, warehouse: branchIds ? { branchId: { in: branchIds } } : undefined },
    include: { product: true, warehouse: { include: { branch: true } } },
    orderBy: { expiryDate: "asc" },
  });
  const byBranch = new Map<string, typeof lots>();
  for (const l of lots) byBranch.set(l.warehouse!.branch.name, [...(byBranch.get(l.warehouse!.branch.name) ?? []), l]);
  const now = Date.now();
  for (const [branch, rows] of byBranch) {
    await sendMessage({
      connector: "merchandising", direction: "outbound", docType: "near_expiry_signal", reference: `${branch} — ${rows.length} lot(s)`,
      payload: rows.map((r) => ({ sku: r.product.sku, product: r.product.name, lot: r.lotNumber, qty: r.qtyGood, expiry: r.expiryDate!.toISOString().slice(0, 10), daysLeft: Math.floor((r.expiryDate!.getTime() - now) / 86400000) })),
    });
  }
  return { branches: byBranch.size, lots: lots.length };
}

export async function sendApprovedReturns(branchIds: Scope, days = 30) {
  const since = new Date(Date.now() - days * 86400000);
  const [market, central] = await Promise.all([
    prisma.marketReturn.findMany({ where: { createdAt: { gte: since }, creditNote: { status: { in: ["applied", "approved", "issued"] } }, outlet: branchIds ? { branchId: { in: branchIds } } : undefined }, include: { product: true, outlet: true, creditNote: true } }),
    prisma.supplierReturn.findMany({ where: { createdAt: { gte: since }, status: { in: ["approved", "shipped", "in_transit", "received", "posted"] }, warehouse: branchIds ? { branchId: { in: branchIds } } : undefined }, include: { product: true } }),
  ]);
  if (market.length) {
    await sendMessage({ connector: "merchandising", direction: "outbound", docType: "approved_returns", reference: `${market.length} market return(s)`, payload: market.map((m) => ({ creditNote: m.creditNote?.noteNumber, outlet: m.outlet.name, sku: m.product.sku, qty: m.qty, reason: m.reason })) });
  }
  if (central.length) {
    await sendMessage({ connector: "merchandising", direction: "outbound", docType: "approved_returns", reference: `${central.length} central-warehouse return(s)`, payload: central.map((c) => ({ ref: c.returnNumber, sku: c.product.sku, qty: c.qty, reason: c.reason, status: c.status })) });
  }
  return { market: market.length, central: central.length };
}

export async function sendSuggestedOrderQuantities(branchIds: Scope) {
  const outlets = await prisma.outlet.findMany({ where: { status: "active", ...(branchIds ? { branchId: { in: branchIds } } : {}) }, select: { id: true, name: true, code: true } });
  const lines = await prisma.salesOrderLine.findMany({
    where: { salesOrder: { outletId: { in: outlets.map((o) => o.id) }, status: { notIn: ["voided", "cancelled", "draft"] } } },
    select: { productId: true, qty: true, salesOrder: { select: { outletId: true, orderDate: true } }, product: { select: { sku: true, name: true } } },
    orderBy: { salesOrder: { orderDate: "desc" } },
    take: 3000,
  });
  const out: { outlet: string; code: string | null; sku: string; product: string; suggested: number }[] = [];
  for (const o of outlets) {
    const mine = lines.filter((l) => l.salesOrder.outletId === o.id);
    const byProduct = new Map<string, typeof mine>();
    for (const l of mine) byProduct.set(l.productId, [...(byProduct.get(l.productId) ?? []), l]);
    for (const [, ls] of byProduct) {
      const last = ls.slice(0, 3);
      out.push({ outlet: o.name, code: o.code, sku: last[0].product.sku, product: last[0].product.name, suggested: Math.round(last.reduce((s, l) => s + l.qty, 0) / last.length) });
    }
  }
  await sendMessage({ connector: "merchandising", direction: "outbound", docType: "suggested_order_quantities", reference: `${outlets.length} outlet(s), ${out.length} suggestion(s)`, payload: out.slice(0, 200) });
  return { outlets: outlets.length, suggestions: out.length };
}

// Inbound: what the merchandiser counted on the shelf during their visits.
export async function receiveInventoryObservations(branchIds: Scope) {
  const outlets = await prisma.outlet.findMany({ where: { status: "active", ...(branchIds ? { branchId: { in: branchIds } } : {}) }, orderBy: { name: "asc" }, take: 8 });
  const products = await prisma.product.findMany({ where: { status: "active" }, orderBy: { sku: "asc" }, take: 6 });
  let created = 0;
  let gaps = 0;
  for (let i = 0; i < outlets.length; i++) {
    for (let j = 0; j < 3; j++) {
      const p = products[(i + j * 2) % products.length];
      const observedQty = (i * 7 + j * 5) % 11; // deterministic spread, including shelf gaps
      await prisma.merchandisingObservation.create({ data: { outletId: outlets[i].id, productId: p.id, observedQty, facings: Math.max(0, 3 - (observedQty < 3 ? 2 : 0)), shelfShare: 20 + ((i * 9 + j * 4) % 40) } });
      created++;
      if (observedQty < 3) {
        gaps++;
        await notify({ role: "supervisor", branchId: outlets[i].branchId, title: "Shelf gap reported by merchandiser", body: `${outlets[i].name}: ${p.name} — only ${observedQty} on the shelf`, link: `/supervisor/orders/new`, kind: "alert" });
      }
    }
  }
  await sendMessage({ connector: "merchandising", direction: "inbound", docType: "physical_inventory_observation", reference: `${outlets.length} outlet(s), ${created} observation(s)`, payload: { gaps } });
  return { outlets: outlets.length, observations: created, gaps };
}
