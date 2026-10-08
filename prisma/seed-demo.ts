import { PrismaClient } from "@prisma/client";
import { priceOrder } from "@/lib/pricing";
import { allocateOrder, dispatchAllocations, nextInvoiceNumber, outletPosition, vatOf, dueDateFor } from "@/lib/orders";
import { addToLot, changeBalance } from "@/lib/stock";

// Sample data for every feature of the platform, added on top of the base seed. Idempotent: each block runs only when
// its own records are missing. The branch order flow is built with the same library functions the screens use
// (pricing, FEFO allocation, picklists, invoicing, delivery) so stock, receivables and documents agree with each other.

const DAY = 86400000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);
const dayStart = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const pad = (n: number, w = 4) => String(n).padStart(w, "0");
const svg = (label: string, color: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="${color}"/><text x="160" y="105" font-family="sans-serif" font-size="20" text-anchor="middle" fill="#334155">${label}</text></svg>`)}`;

function binFor(productId: string) {
  let h = 0;
  for (const c of productId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `Aisle ${String.fromCharCode(65 + (h % 6))} · Rack ${((h >> 3) % 12) + 1}`;
}

export async function seedDemo(prisma: PrismaClient) {
  console.log("Seeding sample data for every feature...");
  const branches = await prisma.branch.findMany({ orderBy: { name: "asc" } });
  const products = await prisma.product.findMany({ where: { status: "active" }, orderBy: { sku: "asc" } });
  const users = await prisma.user.findMany();
  const warehouses = await prisma.warehouse.findMany({ where: { type: "saleable" }, orderBy: { name: "asc" } });
  const roleOf = (role: string, branchId: string) => users.find((u) => u.role === role && u.branchId === branchId);

  // ---------------------------------------------------------------- 1. Branch order flow (pre-sales)
  const flowDone = process.env.SEED_SKIP_FLOW === "1" || (await prisma.salesOrder.count({ where: { orderType: "pre_sales", status: { notIn: ["draft"] } } })) > 0;
  if (!flowDone) {
    const vat = Number((await prisma.referenceItem.findFirst({ where: { kind: "tax_rate", isDefault: true } }))?.value ?? 12) / 100;
    let orderSeq = Number(((await prisma.salesOrder.findFirst({ orderBy: { orderNumber: "desc" }, select: { orderNumber: true } }))?.orderNumber ?? "SO-000000").replace("SO-", ""));
    const mkOrder = async (b: (typeof branches)[number], outletIdx: number, items: [number, number][], opts: { age: number; status?: string; hold?: string; source?: string; urgent?: boolean }) => {
      const outlets = await prisma.outlet.findMany({ where: { branchId: b.id, status: "active", onboardingStatus: "approved", creditStatus: "active" }, orderBy: { code: "asc" } });
      const outlet = outlets[outletIdx % outlets.length];
      // spread the orders over the branch's reps so every rep has some in the field app
      const reps = users.filter((u) => u.role === "sales_rep" && u.branchId === b.id);
      const rep = reps.length ? reps[outletIdx % reps.length] : roleOf("supervisor", b.id)!;
      const pricing = await priceOrder(outlet.id, items.map(([pi, qty]) => ({ productId: products[pi % products.length].id, qty })));
      const order = await prisma.salesOrder.create({
        data: {
          orderNumber: `SO-${pad(++orderSeq, 6)}`, outletId: outlet.id, branchId: b.id, salespersonId: rep.id, source: opts.source ?? "sfa", orderType: "pre_sales",
          status: opts.status ?? "confirmed", allocationStatus: "not_allocated", orderDate: daysAgo(opts.age), requestedDeliveryDate: daysFromNow(2),
          subtotal: pricing.subtotal, discountTotal: pricing.discountTotal, total: pricing.total, paymentTerms: outlet.paymentTerms, deliveryAddress: outlet.address,
          urgentDelivery: !!opts.urgent, urgentReason: opts.urgent ? "Customer is out of stock for the weekend" : null, creditHoldReason: opts.hold ?? null,
        },
      });
      for (const l of pricing.lines) await prisma.salesOrderLine.create({ data: { salesOrderId: order.id, productId: l.productId, qty: l.qty, unitPrice: l.unitPrice, discount: l.discount, lineTotal: l.lineTotal, promotionId: l.promotionId } });
      return { order, outlet, rep, pricing };
    };
    const pickState = async (b: (typeof branches)[number], orderIds: string[]) => {
      const orders = await prisma.salesOrder.findMany({ where: { id: { in: orderIds } }, include: { lines: true, outlet: { include: { route: true } } } });
      const last = await prisma.picklist.findFirst({ orderBy: { picklistNumber: "desc" } });
      const seq = last ? Number(last.picklistNumber.replace(/\D/g, "")) + 1 : 1;
      const routes = [...new Set(orders.map((o) => o.outlet.route?.name).filter(Boolean))];
      const wh = roleOf("branch_ops", b.id);
      const pl = await prisma.picklist.create({ data: { picklistNumber: `PL-${pad(seq, 5)}`, branchId: b.id, generatedBy: wh?.name ?? "Warehouse", groupLabel: orders.length > 1 ? `${orders.length} orders${routes.length ? ` · ${routes.join(", ")}` : ""}` : null, createdAt: daysAgo(1) } });
      for (const o of orders) {
        for (const line of o.lines) {
          const allocs = await prisma.orderAllocation.findMany({ where: { salesOrderLineId: line.id, status: "reserved" } });
          for (const a of allocs) {
            const row = await prisma.stockBalance.findFirst({ where: { warehouseId: a.warehouseId, productId: a.productId, lotNumber: a.lotNumber } });
            await prisma.picklistLine.create({ data: { picklistId: pl.id, salesOrderId: o.id, salesOrderLineId: line.id, productId: line.productId, lotNumber: a.lotNumber, expiryDate: row?.expiryDate ?? null, location: binFor(line.productId), qtyToPick: a.qty } });
          }
        }
      }
      return pl;
    };
    const finishPicks = async (picklistId: string, b: (typeof branches)[number]) => {
      const lines = await prisma.picklistLine.findMany({ where: { picklistId } });
      for (const l of lines) await prisma.picklistLine.update({ where: { id: l.id }, data: { qtyPicked: l.qtyToPick } });
      const perLine = new Map<string, number>();
      for (const l of lines) perLine.set(l.salesOrderLineId, (perLine.get(l.salesOrderLineId) ?? 0) + l.qtyToPick);
      for (const [lineId, q] of perLine) await prisma.salesOrderLine.update({ where: { id: lineId }, data: { qtyPicked: q } });
      for (const oid of new Set(lines.map((l) => l.salesOrderId))) await prisma.salesOrder.update({ where: { id: oid }, data: { status: "picked" } });
      await prisma.picklist.update({ where: { id: picklistId }, data: { status: "picked", pickedBy: roleOf("branch_ops", b.id)?.name ?? "Warehouse", pickedAt: daysAgo(1) } });
    };
    const invoiceOrder = async (orderId: string, user: string, age: number) => {
      const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true, outlet: true } });
      const picked = order.lines.map((l) => ({ l, qty: l.qtyPicked ?? l.qty })).filter((x) => x.qty > 0);
      const value = picked.map((x) => ({ ...x, amount: Math.round((x.l.lineTotal * x.qty) / x.l.qty) }));
      const amount = value.reduce((s, x) => s + x.amount, 0);
      const pos = await outletPosition(order.outletId);
      const { seq, number } = await nextInvoiceNumber(order.branchId);
      const invoice = await prisma.invoice.create({
        data: { invoiceNumber: number, branchSeq: seq, salesOrderId: orderId, outletId: order.outletId, branchId: order.branchId, invoiceDate: daysAgo(age), dueDate: dueDateFor(order.paymentTerms ?? order.outlet.paymentTerms, daysAgo(age)), amount, taxAmount: vatOf(amount, vat), status: "unpaid", deliveryStatus: "pending_delivery" },
      });
      for (const x of value) await prisma.invoiceLine.create({ data: { invoiceId: invoice.id, productId: x.l.productId, qty: x.qty, unitPrice: x.l.unitPrice, lineTotal: x.amount } });
      await prisma.aRLedgerEntry.create({ data: { outletId: order.outletId, invoiceId: invoice.id, type: "invoice", amount, balance: pos.outstanding + amount, reference: invoice.invoiceNumber, entryDate: daysAgo(age) } });
      await dispatchAllocations(orderId, user, { number: invoice.invoiceNumber, id: invoice.id });
      await prisma.salesOrder.update({ where: { id: orderId }, data: { status: "invoiced", allocationStatus: "dispatched" } });
      return invoice;
    };
    const deliver = async (invoiceId: string, receiver: string, shortLineIdx?: number, shortBy = 0) => {
      const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: true, salesOrder: { include: { lines: true } } } });
      const count = await prisma.deliveryReceipt.count();
      let delivered = 0;
      let invoiced = 0;
      const results = inv.lines.map((l, i) => {
        const q = shortLineIdx === i ? Math.max(0, l.qty - shortBy) : l.qty;
        delivered += Math.round((l.lineTotal * q) / l.qty);
        invoiced += l.lineTotal;
        return { l, q };
      });
      const anyShort = results.some((r) => r.q < r.l.qty);
      const dr = await prisma.deliveryReceipt.create({ data: { drNumber: `DR-${pad(count + 1, 6)}`, invoiceId, receivedBy: receiver, status: anyShort ? "partial" : "delivered", signatoryName: receiver } });
      for (const r of results) {
        await prisma.deliveryReceiptLine.create({ data: { deliveryReceiptId: dr.id, productId: r.l.productId, qtyOrdered: r.l.qty, qtyDelivered: r.q } });
        const ol = inv.salesOrder.lines.find((x) => x.productId === r.l.productId);
        if (ol) await prisma.salesOrderLine.update({ where: { id: ol.id }, data: { qtyDelivered: r.q } });
        if (r.q < r.l.qty) await prisma.undeliveredBalance.create({ data: { invoiceId, productId: r.l.productId, qty: r.l.qty - r.q, reason: "Store closed early — part of the load could not be handed over" } });
      }
      if (anyShort) {
        const pos = await outletPosition(inv.outletId);
        const diff = invoiced - delivered;
        await prisma.invoice.update({ where: { id: invoiceId }, data: { amount: delivered, taxAmount: vatOf(delivered, vat) } });
        await prisma.aRLedgerEntry.create({ data: { outletId: inv.outletId, invoiceId, type: "adjustment", amount: -diff, balance: pos.outstanding - diff, reference: dr.drNumber } });
      }
      await prisma.invoice.update({ where: { id: invoiceId }, data: { deliveryStatus: anyShort ? "partially_delivered" : "delivered" } });
      await prisma.salesOrder.update({ where: { id: inv.salesOrderId }, data: { status: anyShort ? "partially_delivered" : "delivered" } });
    };

    for (let bi = 0; bi < branches.length; bi++) {
      const b = branches[bi];
      const ops = roleOf("branch_ops", b.id)?.name ?? "Branch Ops";
      const o = bi * 20;
      // confirmed and fully allocated, waiting to be put on a picklist
      await mkOrder(b, o + 0, [[bi + 1, 12], [bi + 4, 8]], { age: 0 });
      await mkOrder(b, o + 1, [[bi + 2, 24]], { age: 0, urgent: bi === 0 });
      // two orders grouped on one picklist that has been generated
      const g1 = await mkOrder(b, o + 2, [[bi + 3, 10], [bi + 6, 6]], { age: 1 });
      const g2 = await mkOrder(b, o + 3, [[bi + 5, 18]], { age: 1 });
      await allocateOrder(g1.order.id, "partial_backorder");
      await allocateOrder(g2.order.id, "partial_backorder");
      await pickState(b, [g1.order.id, g2.order.id]);
      // picked, ready to invoice
      const p1 = await mkOrder(b, o + 4, [[bi + 7, 15], [bi + 8, 9]], { age: 2 });
      await allocateOrder(p1.order.id, "partial_backorder");
      const plP = await pickState(b, [p1.order.id]);
      await finishPicks(plP.id, b);
      // invoiced and waiting for delivery / out for delivery
      const i1 = await mkOrder(b, o + 5, [[bi + 9, 20]], { age: 3 });
      await allocateOrder(i1.order.id, "partial_backorder");
      await finishPicks((await pickState(b, [i1.order.id])).id, b);
      await invoiceOrder(i1.order.id, ops, 2);
      const i2 = await mkOrder(b, o + 6, [[bi + 10, 14], [bi + 11, 10]], { age: 3 });
      await allocateOrder(i2.order.id, "partial_backorder");
      await finishPicks((await pickState(b, [i2.order.id])).id, b);
      const inv2 = await invoiceOrder(i2.order.id, ops, 2);
      await prisma.invoice.update({ where: { id: inv2.id }, data: { deliveryStatus: "out_for_delivery" } });
      // delivered in full
      const d1 = await mkOrder(b, o + 7, [[bi + 12, 16]], { age: 8 });
      await allocateOrder(d1.order.id, "partial_backorder");
      await finishPicks((await pickState(b, [d1.order.id])).id, b);
      await deliver((await invoiceOrder(d1.order.id, ops, 7)).id, "Store owner");
      // delivered short: an undelivered balance is open; a second one has a re-delivery scheduled
      const s1 = await mkOrder(b, o + 8, [[bi + 13, 30], [bi + 14, 12]], { age: 6 });
      await allocateOrder(s1.order.id, "partial_backorder");
      await finishPicks((await pickState(b, [s1.order.id])).id, b);
      await deliver((await invoiceOrder(s1.order.id, ops, 5)).id, "Receiving clerk", 0, 10);
      const s2 = await mkOrder(b, o + 9, [[bi + 15, 24]], { age: 7 });
      await allocateOrder(s2.order.id, "partial_backorder");
      await finishPicks((await pickState(b, [s2.order.id])).id, b);
      const sInv = await invoiceOrder(s2.order.id, ops, 6);
      await deliver(sInv.id, "Store supervisor", 0, 8);
      await prisma.undeliveredBalance.updateMany({ where: { invoiceId: sInv.id }, data: { status: "redelivery_scheduled", redeliveryDate: daysFromNow(2) } });
      await prisma.invoice.update({ where: { id: sInv.id }, data: { deliveryStatus: "redelivery_scheduled" } });
      // short on stock: confirmed with part of the quantity on backorder
      // the scarcest affordable product, ordered a little beyond what the warehouse has: a believable partial allocation
      const whRows = await prisma.stockBalance.findMany({ where: { warehouse: { branchId: b.id, type: "saleable" }, locationType: "warehouse" }, include: { product: true } });
      const avail = new Map<string, { n: number; price: number }>();
      for (const r of whRows) {
        const cur = avail.get(r.productId) ?? { n: 0, price: r.product.unitPrice };
        cur.n += Math.max(0, r.qtyGood - r.qtyReserved);
        avail.set(r.productId, cur);
      }
      const scarce = [...avail.entries()].filter(([, v]) => v.n > 0 && v.price <= 250).sort((x, y) => x[1].n - y[1].n)[0];
      const scarceIdx = products.findIndex((x) => x.id === scarce[0]);
      const bo = await mkOrder(b, o + 10, [[scarceIdx, scarce[1].n + 24]], { age: 1 });
      await allocateOrder(bo.order.id, "partial_backorder");
      // on hold for a credit decision
      const held = await mkOrder(b, o + 11, [[bi + 17, 40], [bi + 18, 30]], { age: 0, status: "on_hold", hold: "The order would take the customer over their credit limit." });
      await prisma.approvalRequest.create({ data: { type: "credit_limit_exception", salesOrderId: held.order.id, requestedBy: held.rep.name, branchId: b.id, outletId: held.outlet.id, amount: Math.round(held.pricing.total * 0.35), reason: `${held.outlet.name}: the order would take the customer over their credit limit.` } });
    }
  }

  // Credit limits with headroom: keep one deliberately over-limit customer per branch for the credit-control screens.
  if (!flowDone) {
    for (const b of branches) {
      const outlets = await prisma.outlet.findMany({ where: { branchId: b.id, status: "active" } });
      const rows = [];
      for (const o of outlets) {
        const pos = await outletPosition(o.id);
        rows.push({ o, exposure: pos.outstanding + pos.openOrderValue });
      }
      const worst = [...rows].sort((x, y) => y.exposure - y.o.creditLimit - (x.exposure - x.o.creditLimit))[0];
      for (const r of rows) {
        if (r.o.id === worst.o.id || r.exposure <= r.o.creditLimit * 0.9) continue;
        await prisma.outlet.update({ where: { id: r.o.id }, data: { creditLimit: Math.ceil((r.exposure * 1.4) / 5000) * 5000 } });
      }
    }
  }

  // ---------------------------------------------------------------- 2. Territories
  if ((await prisma.territory.count()) === 0) {
    const names: [string, string][] = [["Metro Manila North", "TER-MMN"], ["Metro Manila South", "TER-MMS"], ["Cebu City", "TER-CEB"], ["Cebu Province", "TER-CBP"], ["Davao City", "TER-DVO"], ["Davao Region", "TER-DVR"]];
    const ter = [];
    for (const [name, code] of names) ter.push(await prisma.territory.create({ data: { name, code } }));
    const routes = await prisma.route.findMany({ orderBy: { name: "asc" } });
    for (let i = 0; i < routes.length; i++) await prisma.route.update({ where: { id: routes[i].id }, data: { territoryId: ter[i % ter.length].id } });
  }

  // ---------------------------------------------------------------- 3. Pricing rules, standing discounts
  const channels = await prisma.channel.findMany({ orderBy: { name: "asc" } });
  if ((await prisma.pricingRule.count()) <= 1) {
    const kaOutlets = await prisma.outlet.findMany({ where: { channel: { name: { contains: "Key" } }, status: "active" }, orderBy: { code: "asc" }, take: 3 });
    const rules = [
      { name: "General Trade — Beverages 5% off (festive)", level: "channel", channelId: channels[0]?.id, scopeCategory: "Beverages", priceType: "discount_percent", value: 5, startDate: daysAgo(10), endDate: daysFromNow(35), remarks: "Seasonal channel discount agreed with sales head" },
      { name: `${products[2].name} — Cebu launch price`, level: "sku", productId: products[2].id, branchId: branches[0]?.id, priceType: "fixed_price", value: Math.max(1, products[2].unitPrice * 0.94), startDate: daysAgo(5), endDate: daysFromNow(25), remarks: "Branch-only price to match a competitor" },
      { name: `${kaOutlets[0]?.name ?? "Key account"} — Standing 6% discount`, level: "customer", kind: "fixed_discount", outletId: kaOutlets[0]?.id, priceType: "discount_percent", value: 6, startDate: daysAgo(40), remarks: "Annual trade agreement" },
      { name: `${kaOutlets[1]?.name ?? "Key account"} — Proposed 8% discount`, level: "customer", kind: "fixed_discount", outletId: kaOutlets[1]?.id, priceType: "discount_percent", value: 8, startDate: daysFromNow(3), approvalStatus: "pending_approval", remarks: "Negotiated at the business review — needs head-office approval" },
      { name: `${products[5].name} — Summer price (ended)`, level: "sku", productId: products[5].id, priceType: "fixed_price", value: Math.max(1, products[5].unitPrice * 0.9), startDate: daysAgo(120), endDate: daysAgo(30), status: "expired", approvalStatus: "ended", remarks: "Season finished" },
      ...products.slice(0, 3).map((p, i) => ({ name: `Imported base price ${p.sku}`, level: "sku", productId: p.id, priceType: "fixed_price", value: Math.round(p.unitPrice * (1.03 + i * 0.01) * 100) / 100, startDate: daysFromNow(21), remarks: "Loaded from the price-list import" })),
    ];
    for (const r of rules) await prisma.pricingRule.create({ data: { approvedBy: (r as { approvalStatus?: string }).approvalStatus === "pending_approval" ? null : "Head office", ...r } as never });
  }

  // ---------------------------------------------------------------- 4. Credit note, debit note and adjustment awaiting approval
  const outletsAll = await prisma.outlet.findMany({ where: { status: "active" }, orderBy: { code: "asc" } });
  if ((await prisma.creditNote.count()) < 3) {
    const o = outletsAll[4];
    const sup = users.find((u) => u.role === "supervisor" && u.branchId === o.branchId);
    const inv = await prisma.invoice.findFirst({ where: { outletId: o.id, status: { in: ["unpaid", "partially_paid"] } } });
    const cn = await prisma.creditNote.create({ data: { noteNumber: `CN-${pad((await prisma.creditNote.count()) + 1)}`, outletId: o.id, invoiceId: inv?.id, amount: 1850, reason: "Price on the invoice did not match the agreed price list", status: "pending_approval", issuedBy: sup?.name ?? "Supervisor", issuedAt: daysAgo(1) } });
    await prisma.approvalRequest.create({ data: { type: "credit_note", refId: cn.id, outletId: o.id, branchId: o.branchId, requestedBy: sup?.name ?? "Supervisor", amount: 1850, reason: `${cn.noteNumber} for ${o.name}: price on the invoice did not match the agreed price list` } });
  }
  if ((await prisma.financialDocument.count()) < 3) {
    const o = outletsAll[9];
    const sup = users.find((u) => u.role === "supervisor" && u.branchId === o.branchId);
    const base = await prisma.financialDocument.count();
    const debit = await prisma.financialDocument.create({ data: { docNumber: `DN-${pad(base + 1, 5)}`, type: "debit_note", outletId: o.id, amount: 640, reason: "Late-payment charge per the credit agreement", requestedBy: sup?.name ?? "Supervisor" } });
    await prisma.approvalRequest.create({ data: { type: "fin_doc", refId: debit.id, outletId: o.id, branchId: o.branchId, requestedBy: sup?.name ?? "Supervisor", amount: 640, reason: `${debit.docNumber} — debit note for ${o.name}: late-payment charge per the credit agreement` } });
    const supAdj = users.find((u) => u.role === "supervisor" && u.branchId === outletsAll[14].branchId);
    const adj = await prisma.financialDocument.create({ data: { docNumber: `ADJ-${pad(base + 2, 5)}`, type: "adjustment", direction: "decrease", outletId: outletsAll[14].id, amount: 275, reason: "Rounding difference agreed with the customer", requestedBy: supAdj?.name ?? "Supervisor" } });
    await prisma.approvalRequest.create({ data: { type: "fin_doc", refId: adj.id, outletId: outletsAll[14].id, branchId: outletsAll[14].branchId, requestedBy: supAdj?.name ?? "Supervisor", amount: 275, reason: `${adj.docNumber} — adjustment (decrease) for ${outletsAll[14].name}: rounding difference agreed with the customer` } });
  }

  // ---------------------------------------------------------------- 5. Tasks, leave, expenses, customer change requests
  if ((await prisma.task.count()) < 6) {
    const mk = async (bi: number, title: string, status: string, due: number, priority: string, photo: boolean, description: string, extra: Record<string, unknown> = {}) => {
      const b = branches[bi];
      const rep = roleOf("sales_rep", b.id);
      const sup = roleOf("supervisor", b.id);
      if (!rep || !sup) return;
      const out = (await prisma.outlet.findMany({ where: { branchId: b.id, status: "active" }, orderBy: { code: "asc" }, take: 8 }))[bi + 2];
      await prisma.task.create({ data: { title, description, assignedToId: rep.id, assignedById: sup.id, outletId: out?.id, dueDate: daysFromNow(due), priority, requiresPhoto: photo, status, ...extra } });
    };
    await mk(0, "Rebuild the chiller display for the Sunrise promotion", "pending", 2, "high", true, "Photograph the finished display and the price tags.");
    await mk(0, "Collect the overdue balance", "acknowledged", 1, "high", false, "Agree a payment date and record it as a field note.", { acknowledgedAt: daysAgo(0) });
    await mk(1, "Check near-expiry stock on the shelf", "in_progress", 3, "normal", true, "Report any lots with less than 30 days left.", { acknowledgedAt: daysAgo(1), startedAt: daysAgo(0) });
    await mk(1, "Update the customer's contact details", "completed", -2, "low", false, "New owner since last month.", { acknowledgedAt: daysAgo(4), startedAt: daysAgo(3), completedAt: daysAgo(2) });
    await mk(2, "Introduce the new snack range", "pending", 5, "normal", false, "Leave the sample packs and note the buyer's feedback.");
    await mk(2, "Count the van stock before the weekend", "not_completed", -1, "normal", false, "Van was in the workshop.", { notCompletedReason: "Van was being repaired — will do on Monday", acknowledgedAt: daysAgo(3) });
  }
  if ((await prisma.leaveRequest.count()) < 5) {
    const reps = users.filter((u) => u.role === "sales_rep");
    const rows = [
      { i: 0, type: "annual", s: 12, e: 14, reason: "Family trip", status: "pending", half: false },
      { i: 1, type: "sick", s: -3, e: -2, reason: "Fever — medical certificate attached", status: "approved", half: false, att: "medical-certificate.pdf", note: "Get well soon" },
      { i: 2, type: "emergency", s: 6, e: 6, reason: "Hospital visit for a relative", status: "pending", half: true },
      { i: 3, type: "annual", s: 20, e: 24, reason: "Provincial fiesta", status: "rejected", half: false, note: "Quarter-end close — please move to next month" },
    ];
    for (const r of rows) {
      const u = reps[r.i % reps.length];
      if (!u) continue;
      await prisma.leaveRequest.create({ data: { userId: u.id, startDate: daysFromNow(r.s), endDate: daysFromNow(r.e), reason: r.reason, leaveType: r.type, halfDay: r.half, attachmentName: r.att ?? null, status: r.status, decisionNote: r.note ?? null, approvedBy: r.status === "pending" ? null : roleOf("supervisor", u.branchId ?? "")?.name ?? "Supervisor", decidedAt: r.status === "pending" ? null : daysAgo(1) } });
    }
  }
  if ((await prisma.expenseRequest.count()) < 5) {
    const reps = users.filter((u) => u.role === "sales_rep");
    const rows = [
      { i: 0, amount: 850, category: "fuel", description: "Fuel for the Cavite route", status: "pending", receipt: true },
      { i: 1, amount: 420, category: "meals", description: "Lunch with the buyer at a key account", status: "approved", receipt: true, note: "Approved within the daily limit" },
      { i: 2, amount: 1500, category: "travel", description: "Ferry and taxi to the island outlets", status: "partially_approved", receipt: true, note: "Taxi fare above the limit was not approved" },
      { i: 3, amount: 300, category: "other", description: "Photocopy of delivery receipts", status: "rejected", receipt: false, note: "No receipt attached" },
      { i: 4, amount: 960, category: "fuel", description: "Fuel — van route, week 2", status: "paid", receipt: true },
    ];
    for (const r of rows) {
      const u = reps[r.i % reps.length];
      if (!u) continue;
      await prisma.expenseRequest.create({ data: { userId: u.id, amount: r.amount, category: r.category, description: r.description, receiptPlaceholder: r.receipt, expenseDate: daysAgo(r.i + 1), status: r.status, decisionNote: r.note ?? null, approvedBy: r.status === "pending" ? null : roleOf("supervisor", u.branchId ?? "")?.name ?? "Supervisor", decidedAt: r.status === "pending" ? null : daysAgo(0) } });
    }
  }
  if ((await prisma.customerChangeRequest.count()) < 4) {
    const rows: [number, string, string, string, string, string][] = [
      [3, "phone", "0917 000 1111", "0917 555 2468", "Owner changed her number", "pending"],
      [6, "visit_day", "monday", "thursday", "Store restocks on Wednesdays — better to visit after delivery", "approved"],
      [8, "address", "—", "Unit 4, Rizal Ave., Poblacion", "Store moved to a new location", "pending"],
    ];
    for (const [i, field, cur, prop, reason, status] of rows) {
      const o = outletsAll[i];
      const rep = users.find((u) => u.role === "sales_rep" && u.branchId === o.branchId);
      await prisma.customerChangeRequest.create({ data: { outletId: o.id, requestedBy: rep?.name ?? "Rep", field, currentValue: cur, proposedValue: prop, reason, status, decidedBy: status === "pending" ? null : "Supervisor", decisionNote: status === "approved" ? "Confirmed on the next visit" : null, decidedAt: status === "pending" ? null : daysAgo(1) } });
    }
  }

  // ---------------------------------------------------------------- 6. Warehouse: transfers, adjustments, damage, opening balances
  const lotOf = async (warehouseId: string, skip = 0) => prisma.stockBalance.findFirst({ where: { warehouseId, locationType: "warehouse", qtyGood: { gt: 60 } }, orderBy: { lotNumber: "asc" }, skip });
  if ((await prisma.stockTransfer.count()) < 5 && warehouses.length >= 3) {
    const plan: [number, number, number, string, number][] = [[0, 1, 0, "pending", 30], [1, 2, 1, "in_transit", 24], [2, 0, 2, "completed", 36], [0, 2, 3, "discrepancy", 40]];
    for (const [f, t, skip, status, qty] of plan) {
      const lot = await lotOf(warehouses[f].id, skip);
      if (!lot) continue;
      const requester = roleOf("branch_ops", warehouses[f].branchId)?.name ?? "Branch Ops";
      const dispatched = status !== "pending";
      const tr = await prisma.stockTransfer.create({ data: { fromWarehouseId: warehouses[f].id, toWarehouseId: warehouses[t].id, productId: lot.productId, lotNumber: lot.lotNumber, qty, status, requestedBy: requester, approvedBy: dispatched ? "Branch manager" : null, approverRole: "branch_manager", notes: "Rebalancing stock between branches", dispatchedAt: dispatched ? daysAgo(2) : null, qtyReceived: status === "completed" ? qty : status === "discrepancy" ? qty - 4 : null, receivedBy: status === "completed" || status === "discrepancy" ? "Receiving branch" : null, receivedAt: status === "completed" || status === "discrepancy" ? daysAgo(1) : null, discrepancyNote: status === "discrepancy" ? "4 units damaged in transit" : null, decidedAt: dispatched ? daysAgo(2) : null } });
      const ref = { type: "transfer", refType: "StockTransfer", refId: tr.id, refNumber: `TRF-${tr.id.slice(-5).toUpperCase()}`, userName: requester, note: "Inter-branch transfer" };
      if (dispatched) await changeBalance(lot.id, "good", -qty, { ...ref, type: "transfer_out" });
      if (status === "completed" || status === "discrepancy") await addToLot({ locationType: "warehouse", warehouseId: warehouses[t].id }, lot.productId, lot.lotNumber, lot.expiryDate, "good", status === "completed" ? qty : qty - 4, { ...ref, type: "transfer_in" });
    }
  }
  if ((await prisma.stockAdjustment.count()) < 4) {
    const plan: [number, number, string, number, string][] = [[0, 4, "count_variance", -6, "pending"], [1, 5, "damage", -12, "pending"], [2, 6, "sample_promo", -20, "approved"], [0, 7, "data_entry", 15, "rejected"]];
    for (const [w, skip, reasonCode, delta, status] of plan) {
      const lot = await lotOf(warehouses[w].id, skip);
      if (!lot) continue;
      const requester = roleOf("branch_ops", warehouses[w].branchId)?.name ?? "Branch Ops";
      const adj = await prisma.stockAdjustment.create({ data: { warehouseId: warehouses[w].id, productId: lot.productId, lotNumber: lot.lotNumber, expiryDate: lot.expiryDate, qtyDelta: delta, reasonCode, status, approverRole: "branch_manager", requestedBy: requester, approvedBy: status === "pending" ? null : "Branch manager", notes: { count_variance: "Cycle count found fewer cartons than the system", damage: "Pallet damaged by a forklift", sample_promo: "Samples for the school-canteen promotion", data_entry: "Receipt keyed twice" }[reasonCode], decidedAt: status === "pending" ? null : daysAgo(1) } });
      if (status === "approved") await changeBalance(lot.id, "good", delta, { type: "adjustment", refType: "StockAdjustment", refId: adj.id, refNumber: `ADJ-${adj.id.slice(-5).toUpperCase()}`, userName: "Branch manager", note: reasonCode });
    }
  }
  if ((await prisma.stockDamageEvent.count()) === 0) {
    for (let w = 0; w < warehouses.length; w++) {
      const lot = await lotOf(warehouses[w].id, 8 + w);
      if (!lot) continue;
      await prisma.stockBalance.update({ where: { id: lot.id }, data: { qtyGood: { decrement: 6 }, qtyDamaged: { increment: 6 } } });
      await prisma.stockDamageEvent.create({ data: { stockBalanceId: lot.id, qty: 6, direction: "good_to_bad", reason: ["Crushed cartons at the dock", "Leaking cases found during putaway", "Water damage from the roof leak"][w], photoPlaceholder: true, createdBy: roleOf("branch_ops", warehouses[w].branchId)?.name ?? "Branch Ops", createdAt: daysAgo(3 + w) } });
    }
  }
  if ((await prisma.openingBalanceBatch.count()) === 0) {
    for (let w = 0; w < 2; w++) {
      const wh = warehouses[w];
      if (!wh) continue;
      const batch = await prisma.openingBalanceBatch.create({ data: { warehouseId: wh.id, filename: `opening-stock-${(wh.name.split(" ")[0] ?? "branch").toLowerCase()}.csv`, asOfDate: daysAgo(60), uploadedBy: roleOf("branch_ops", wh.branchId)?.name ?? "Branch Ops", status: w === 0 ? "approved" : "pending", approvedBy: w === 0 ? "Head office" : null, decidedAt: w === 0 ? daysAgo(58) : null, createdAt: daysAgo(60) } });
      const sample = products.slice(w * 5, w * 5 + 6);
      for (let i = 0; i < sample.length; i++) await prisma.openingBalanceLine.create({ data: { batchId: batch.id, lineNo: i + 2, sku: sample[i].sku, productId: sample[i].id, category: "good", lotNumber: `OB-${pad(i + 1, 3)}`, expiryDate: daysFromNow(150 + i * 20), qty: 120 + i * 30, unitCost: Math.round(sample[i].unitPrice * 0.7 * 100) / 100 } });
      if (w === 1) await prisma.openingBalanceLine.create({ data: { batchId: batch.id, lineNo: 8, sku: "UNKNOWN-001", category: "good", lotNumber: "OB-099", qty: 50, result: "error", message: "SKU is not in the product master" } });
    }
  }

  // ---------------------------------------------------------------- 7. Van: replenishment lines, counts, reconciliation, returns
  const vans = await prisma.van.findMany({ include: { stockBalances: { where: { locationType: "van" } } } });
  const requests = await prisma.replenishmentRequest.findMany({ include: { lines: true } });
  for (const r of requests) if (r.lines.length === 0) await prisma.replenishmentLine.create({ data: { requestId: r.id, productId: r.productId, qtyRequested: r.qtyRequested, qtyApproved: ["approved", "fulfilled", "partially_approved"].includes(r.status) ? Math.min(r.qtyRequested, r.status === "partially_approved" ? Math.ceil(r.qtyRequested / 2) : r.qtyRequested) : null, vanBalance: 12, warehouseAvail: 340 } });
  if (requests.length < 5 && vans.length > 0) {
    const plan: [number, string, number][] = [[2, "pending", 48], [3, "approved", 36], [4, "partially_approved", 60]];
    for (const [vi, status, qty] of plan) {
      const v = vans[vi % vans.length];
      const p = products[(vi + 3) % products.length];
      const n = (await prisma.replenishmentRequest.count()) + 1;
      const req = await prisma.replenishmentRequest.create({ data: { vanId: v.id, branchId: v.branchId, productId: p.id, qtyRequested: qty, requestNumber: `RPL-${pad(n, 5)}`, requiredDate: daysFromNow(1), remarks: "Fast-moving before the weekend market", status, requestedBy: v.driverName, decisionNote: status === "partially_approved" ? "Warehouse could release half today" : null, decidedAt: status === "pending" ? null : daysAgo(0) } });
      await prisma.replenishmentLine.create({ data: { requestId: req.id, productId: p.id, qtyRequested: qty, qtyApproved: status === "pending" ? null : status === "approved" ? qty : Math.ceil(qty / 2), vanBalance: 8, warehouseAvail: 280 } });
    }
  }
  if ((await prisma.vanStockCount.count()) === 0) {
    for (let vi = 0; vi < Math.min(vans.length, 4); vi++) {
      const v = vans[vi];
      const rows = v.stockBalances.slice(0, 4);
      if (rows.length === 0) continue;
      const count = await prisma.vanStockCount.create({ data: { vanId: v.id, countedBy: v.driverName, countType: ["start_of_day", "mid_day", "end_of_day", "spot"][vi], blind: vi % 2 === 1, createdAt: daysAgo(vi === 0 ? 0 : vi) } });
      for (let i = 0; i < rows.length; i++) {
        const variance = vi === 1 && i === 0 ? -3 : vi === 2 && i === 1 ? 2 : 0;
        await prisma.vanStockCountLine.create({ data: { countId: count.id, productId: rows[i].productId, lotNumber: rows[i].lotNumber, systemGood: rows[i].qtyGood, systemDamaged: rows[i].qtyDamaged, countedGood: rows[i].qtyGood + variance, countedDamaged: rows[i].qtyDamaged, variance, remark: variance < 0 ? "Two cartons left at a customer by mistake" : variance > 0 ? "Found one case behind the seat" : null } });
      }
    }
  }
  if ((await prisma.vanReconciliation.count()) === 0) {
    const plan: [string, string | null, number][] = [["closed", null, 0], ["variance_open", "shortage", -4], ["pending_ack", null, 0]];
    for (let vi = 0; vi < Math.min(vans.length, 3); vi++) {
      const v = vans[vi];
      const day = dayStart(daysAgo(1));
      const [status, outcome, variance] = plan[vi];
      const rec = await prisma.vanReconciliation.create({ data: { vanId: v.id, dayDate: day, status, countedBy: v.driverName, cause: outcome ? "Unrecorded giveaway at a market stall" : null, note: status === "closed" ? "Balanced — no variance" : null, closedAt: status === "closed" ? daysAgo(1) : null, approvedBy: status === "closed" ? "Supervisor" : null, createdAt: daysAgo(1) } });
      for (const b of v.stockBalances.slice(0, 3)) {
        const opening = b.qtyGood + 20;
        const sold = 14;
        const loaded = 0;
        const returned = 6;
        const expected = opening + loaded - sold - returned;
        const counted = expected + (b === v.stockBalances[0] ? variance : 0);
        await prisma.vanReconciliationLine.create({ data: { reconciliationId: rec.id, productId: b.productId, opening, loaded, sold, returned, adjusted: 0, expected, counted, variance: counted - expected, outcome: counted === expected ? "none" : counted < expected ? "shortage" : "excess", resolution: status === "closed" ? "explained" : null } });
      }
    }
  }
  if ((await prisma.vanReturn.count()) < 4 && vans.length > 2) {
    const plan: [number, number, string, number, number | null, string][] = [[2, 0, "good", 12, 10, "variance_pending"], [3, 1, "damaged", 6, 6, "completed"]];
    for (const [vi, pi, condition, declared, received, status] of plan) {
      const v = vans[vi % vans.length];
      const wh = warehouses.find((w) => w.branchId === v.branchId);
      if (!wh) continue;
      const p = products[(pi + 12) % products.length];
      const n = (await prisma.vanReturn.count()) + 1;
      await prisma.vanReturn.create({ data: { vanId: v.id, warehouseId: wh.id, productId: p.id, lotNumber: "RET-LOT", qty: declared, condition, reason: condition === "damaged" ? "Crushed in the van" : "Unsold at end of route", returnNumber: `VRT-${pad(n, 5)}`, qtyDeclared: declared, qtyReceived: received, varianceReason: received !== declared ? "Two cartons missing at handover" : null, receivedBy: "Warehouse clerk", status, returnedBy: v.driverName, createdAt: daysAgo(1) } });
    }
  }

  // ---------------------------------------------------------------- 8. Claims detail, reports, audit trail extras
  for (const claim of await prisma.claim.findMany({ include: { lines: true } })) {
    if (claim.lines.length > 0) continue;
    const orders = await prisma.salesOrder.findMany({ where: { branchId: claim.branchId ?? undefined, status: "delivered", orderType: "van_sale" }, orderBy: { orderDate: "desc" }, take: 3 });
    const shares = [0.5, 0.3, 0.2];
    for (let i = 0; i < orders.length; i++) await prisma.claimLine.create({ data: { claimId: claim.id, salesOrderId: orders[i].id, orderNumber: orders[i].orderNumber, amount: Math.round(claim.amount * shares[i] * 100) / 100 } });
  }
  if ((await prisma.scheduledReportRun.count()) === 0) {
    for (const rep of await prisma.scheduledReport.findMany()) {
      const snap = JSON.stringify({ columns: ["Branch", "Sales"], rows: branches.map((b, i) => [b.name, 500000 + i * 120000]) });
      await prisma.scheduledReportRun.create({ data: { reportId: rep.id, startedAt: daysAgo(7), status: "success", rowCount: branches.length, output: snap, trigger: "schedule" } });
      await prisma.scheduledReportRun.create({ data: { reportId: rep.id, startedAt: daysAgo(3), status: "failed", error: "The mail server did not accept the message — will retry", trigger: "schedule" } });
      await prisma.scheduledReportRun.create({ data: { reportId: rep.id, startedAt: daysAgo(2), status: "success", rowCount: branches.length, output: snap, trigger: "retry" } });
      await prisma.scheduledReport.update({ where: { id: rep.id }, data: { lastRunAt: daysAgo(2), lastRunStatus: "success" } });
    }
  }
  if ((await prisma.exportLog.count()) === 0) {
    const adm = users.find((u) => u.role === "admin") ?? users[0];
    const mgr = users.find((u) => u.role === "management") ?? adm;
    const rows: [string, string, string, number, string][] = [["receivables-ageing", adm.id, "excel", branches.length * 9, "{\"groupBy\":\"branch\"}"], ["sales-by-dimension", mgr.id, "pdf", 54, "{}"], ["returns-register", adm.id, "csv", 12, "{\"dateFrom\":\"last 30 days\"}"], ["vat-sales-book", adm.id, "excel", 150, "{}"]];
    for (const [report, userId, format, rowCount, filters] of rows) await prisma.exportLog.create({ data: { userId, report, format, rowCount, filters, createdAt: daysAgo(Math.round(Math.random() * 5)) } });
  }
  if ((await prisma.duplicateLog.count()) === 0) {
    const rep = users.find((u) => u.role === "sales_rep");
    await prisma.duplicateLog.create({ data: { clientRef: "ord-demo-dup-1", docType: "order", userId: rep?.id, originalAt: daysAgo(1), repeatAt: daysAgo(0) } });
    await prisma.duplicateLog.create({ data: { clientRef: "col-demo-dup-1", docType: "collection", userId: rep?.id, originalAt: daysAgo(2), repeatAt: daysAgo(2) } });
  }

  // ---------------------------------------------------------------- 9. Field evidence: photos, merchandiser observations
  if ((await prisma.photo.count()) === 0) {
    const visits = await prisma.fieldVisit.findMany({ take: 3, orderBy: { checkinAt: "desc" } });
    const list: { linkedType: string; photoType: string; caption: string; color: string }[] = [
      { linkedType: "visit", photoType: "outlet_front", caption: "Store front on arrival", color: "#dbeafe" },
      { linkedType: "shelf_audit", photoType: "shelf", caption: "Beverage shelf — two gaps on the middle row", color: "#dcfce7" },
      { linkedType: "competitor", photoType: "competitor", caption: "Competitor end-cap display", color: "#fee2e2" },
      { linkedType: "return", photoType: "damaged_stock", caption: "Damaged cartons returned by the customer", color: "#fef3c7" },
      { linkedType: "merchandising", photoType: "display", caption: "New chiller display in place", color: "#ede9fe" },
    ];
    for (let i = 0; i < list.length; i++) {
      const v = visits[i % Math.max(1, visits.length)];
      const outlet = v ? await prisma.outlet.findUnique({ where: { id: v.outletId } }) : outletsAll[i];
      await prisma.photo.create({ data: { linkedType: list[i].linkedType, linkedId: v?.id, photoType: list[i].photoType, caption: list[i].caption, dataUrl: svg(list[i].caption.slice(0, 28), list[i].color), outletId: outlet?.id, uploadedBy: v?.salespersonId ?? users.find((u) => u.role === "sales_rep")!.id, lat: outlet?.lat, lng: outlet?.lng, createdAt: daysAgo(i) } });
    }
  }
  if ((await prisma.merchandisingObservation.count()) === 0) {
    for (let i = 0; i < 12; i++) {
      const o = outletsAll[i * 2 % outletsAll.length];
      const qty = [2, 8, 0, 14, 5, 1, 9, 3, 11, 0, 6, 4][i];
      await prisma.merchandisingObservation.create({ data: { outletId: o.id, productId: products[(i * 3) % products.length].id, observedQty: qty, facings: qty < 3 ? 1 : 3, shelfShare: 18 + ((i * 7) % 32), observedAt: daysAgo(i % 5), note: qty < 3 ? "Shelf gap — reorder suggested" : null } });
    }
  }

  if ((await prisma.goodsReceiptAttachment.count()) === 0) {
    const receipts = await prisma.goodsReceipt.findMany({ orderBy: { receivedDate: "desc" }, take: 5 });
    const docs: [string, string, string][] = [["supplier-delivery-receipt.pdf", "delivery_receipt", "Signed by the receiving clerk"], ["packing-list.pdf", "packing_list", "Matches the purchase order lines"], ["damage-report-photos.pdf", "damage_report", "Two cartons crushed on arrival"]];
    for (let i = 0; i < receipts.length; i++) {
      const [filename, docType, description] = docs[i % docs.length];
      await prisma.goodsReceiptAttachment.create({ data: { goodsReceiptId: receipts[i].id, filename, docType, description, uploadedBy: users.find((u) => u.role === "branch_ops")?.name ?? "Branch Ops" } });
    }
  }

  // ---------------------------------------------------------------- 9b. Today in the field, and stock approaching expiry
  const todayStart = dayStart();
  if ((await prisma.attendance.count({ where: { dayDate: todayStart } })) === 0) {
    const reps = users.filter((u) => u.role === "sales_rep");
    const outcomes = ["order_taken", "collection_only", "order_taken", "no_order"];
    for (let ri = 0; ri < reps.length; ri++) {
      const rep = reps[ri];
      const stops = rep.routeId ? await prisma.routeStop.findMany({ where: { routeId: rep.routeId }, include: { outlet: true }, orderBy: { sequence: "asc" }, take: 4 }) : [];
      const first = stops[0]?.outlet;
      const start = new Date(todayStart.getTime() + (8 * 60 + 2 + ri * 4) * 60000);
      await prisma.attendance.create({ data: { userId: rep.id, dayDate: todayStart, startAt: start, startLat: first?.lat ?? 14.6, startLng: first?.lng ?? 121, status: "in_progress", startVariance: ri % 5 === 4 ? "late" : "on_time" } });
      for (let si = 0; si < Math.min(stops.length, 3); si++) {
        const o = stops[si].outlet;
        const checkin = new Date(todayStart.getTime() + (8 * 60 + 40 + si * 75 + ri * 3) * 60000);
        const outcome = outcomes[(ri + si) % outcomes.length];
        await prisma.fieldVisit.create({ data: { outletId: o.id, salespersonId: rep.id, checkinAt: checkin, checkinLat: o.lat ?? 14.6, checkinLng: o.lng ?? 121, checkoutAt: new Date(checkin.getTime() + (18 + si * 4) * 60000), checkoutLat: o.lat ?? 14.6, checkoutLng: o.lng ?? 121, status: "completed", visitType: "planned", outcome, noOrderReason: outcome === "no_order" ? "Well stocked this week" : null, serviceRating: 4 + ((ri + si) % 2), distanceM: 12 + si * 7 } });
      }
    }
  }
  if ((await prisma.stockBalance.count({ where: { locationType: "warehouse", qtyGood: { gt: 0 }, expiryDate: { gte: new Date(), lte: daysFromNow(60) } } })) < 8) {
    // lots drifting towards expiry: two in the critical band and two in the warning band at every branch
    const days = [11, 23, 38, 52];
    for (const wh of warehouses) {
      const lots = await prisma.stockBalance.findMany({ where: { warehouseId: wh.id, locationType: "warehouse", qtyGood: { gt: 0 }, qtyReserved: 0 }, orderBy: { lotNumber: "asc" }, skip: 14, take: 4 });
      for (let i = 0; i < lots.length; i++) await prisma.stockBalance.update({ where: { id: lots[i].id }, data: { expiryDate: daysFromNow(days[i]) } });
    }
  }

  // ---------------------------------------------------------------- 10. Imports, platform settings
  if ((await prisma.importBatch.count()) === 0) {
    const pend = await prisma.outlet.findMany({ where: { status: "inactive" }, take: 2, select: { name: true } });
    const custRows = [
      ...pend.map((p, i) => ({ line: i + 2, key: p.name, outcome: "valid", message: "Will be created" })),
      { line: 4, key: "Atlantis Mart", outcome: "rejected", message: "Unknown branch “Atlantis Branch”" },
      { line: 5, key: pend[0]?.name ?? "Repeat Store", outcome: "duplicate", message: "Repeated in this file" },
    ];
    await prisma.importBatch.create({ data: { dataset: "customers", filename: "new-customers-oct.csv", totalRows: custRows.length, valid: pend.length, rejected: 2, imported: pend.length, status: "imported", rows: JSON.stringify(custRows), createdBy: "Maria Santos", createdAt: daysAgo(4), importedAt: daysAgo(4) } });
    const skuRows = products.slice(0, 3).map((p, i) => ({ line: i + 2, key: p.sku, outcome: "valid", message: "Will be created" }));
    await prisma.importBatch.create({ data: { dataset: "prices", filename: "price-list-november.csv", totalRows: skuRows.length + 1, valid: skuRows.length, rejected: 1, imported: skuRows.length, status: "imported", rows: JSON.stringify([...skuRows, { line: 5, key: "NOPE-1", outcome: "rejected", message: "Unknown SKU" }]), createdBy: "Maria Santos", createdAt: daysAgo(2), importedAt: daysAgo(2) } });
    await prisma.importBatch.create({ data: { dataset: "products", filename: "seasonal-skus.csv", totalRows: 2, valid: 2, rejected: 0, imported: 0, status: "validated", rows: JSON.stringify([{ line: 2, key: "SEAS-001", outcome: "valid", message: "Will be created" }, { line: 3, key: "SEAS-002", outcome: "valid", message: "Will be created" }]), createdBy: "Maria Santos", createdAt: daysAgo(0) } });
  }
  if ((await prisma.appSetting.count()) === 0) {
    const rows: [string, string][] = [["approval.headOfficeTypes", "ar_reversal,cheque_bounce"]];
    for (const [key, value] of rows) await prisma.appSetting.create({ data: { key, value, updatedBy: "Maria Santos" } });
  }

  console.log("Sample data for every feature seeded.");
}
