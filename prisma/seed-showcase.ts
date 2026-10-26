import { PrismaClient } from "@prisma/client";
import { priceOrder } from "@/lib/pricing";
import { allocateOrder, dispatchAllocations, nextInvoiceNumber, outletPosition, vatOf, dueDateFor } from "@/lib/orders";

// Top-up for a live demonstration. Run it the day before (or the morning of) a presentation:
//   npx tsx prisma/seed-showcase.ts
// It adds only what goes stale or is missing, and is safe to run again:
//   1. deliveries waiting to be dispatched and on the road at every branch (backend orders, which is what the
//      Deliveries screen lists), so the tracking cards and the delivery-run map have something to show
//   2. today's field activity for every representative, anchored to UTC midnight like the app's own "today"
// The orders are built with the same library functions the screens use, so stock, receivables and documents agree.

const DAY = 86400000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);
const pad = (n: number, w = 4) => String(n).padStart(w, "0");

function binFor(productId: string) {
  let h = 0;
  for (const c of productId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `Aisle ${String.fromCharCode(65 + (h % 6))} · Rack ${((h >> 3) % 12) + 1}`;
}

const prisma = new PrismaClient();

async function main() {
  const branches = await prisma.branch.findMany({ orderBy: { name: "asc" } });
  const products = await prisma.product.findMany({ where: { status: "active" }, orderBy: { sku: "asc" } });
  const users = await prisma.user.findMany();
  const roleOf = (role: string, branchId: string) => users.find((u) => u.role === role && u.branchId === branchId);
  const vat = Number((await prisma.referenceItem.findFirst({ where: { kind: "tax_rate", isDefault: true } }))?.value ?? 12) / 100;
  let orderSeq = Number(((await prisma.salesOrder.findFirst({ orderBy: { orderNumber: "desc" }, select: { orderNumber: true } }))?.orderNumber ?? "SO-000000").replace("SO-", ""));

  // ---------------------------------------------------------------- 1. Deliveries on the way
  for (let bi = 0; bi < branches.length; bi++) {
    const b = branches[bi];
    const open = await prisma.invoice.count({ where: { branchId: b.id, status: { not: "voided" }, deliveryStatus: { in: ["pending_delivery", "out_for_delivery"] }, salesOrder: { source: "backend" } } });
    if (open >= 4) continue;
    const ops = roleOf("branch_ops", b.id)?.name ?? "Branch Ops";
    const outlets = await prisma.outlet.findMany({ where: { branchId: b.id, status: "active", onboardingStatus: "approved", creditStatus: "active" }, orderBy: { code: "asc" } });
    const supervisor = roleOf("supervisor", b.id)!;
    // four drops: two waiting at the warehouse, two already on the truck
    const plan: { outlet: number; items: [number, number][]; onRoad: boolean; age: number }[] = [
      { outlet: 1, items: [[bi + 2, 12], [bi + 5, 6]], onRoad: false, age: 1 },
      { outlet: 4, items: [[bi + 3, 20]], onRoad: false, age: 2 },
      { outlet: 6, items: [[bi + 7, 10], [bi + 9, 8]], onRoad: true, age: 2 },
      { outlet: 8, items: [[bi + 11, 16]], onRoad: true, age: 3 },
    ];
    for (const d of plan.slice(open)) {
      const outlet = outlets[d.outlet % outlets.length];
      const pricing = await priceOrder(outlet.id, d.items.map(([pi, qty]) => ({ productId: products[pi % products.length].id, qty })));
      const order = await prisma.salesOrder.create({
        data: {
          orderNumber: `SO-${pad(++orderSeq, 6)}`, outletId: outlet.id, branchId: b.id, salespersonId: supervisor.id, source: "backend", orderType: "pre_sales",
          status: "confirmed", allocationStatus: "not_allocated", orderDate: daysAgo(d.age), requestedDeliveryDate: daysFromNow(1),
          subtotal: pricing.subtotal, discountTotal: pricing.discountTotal, total: pricing.total, paymentTerms: outlet.paymentTerms, deliveryAddress: outlet.address,
          remarks: "Phone order keyed in at the branch",
        },
      });
      for (const l of pricing.lines) await prisma.salesOrderLine.create({ data: { salesOrderId: order.id, productId: l.productId, qty: l.qty, unitPrice: l.unitPrice, discount: l.discount, lineTotal: l.lineTotal, promotionId: l.promotionId } });
      await allocateOrder(order.id, "partial_backorder");

      // picklist, picked
      const full = await prisma.salesOrder.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true } });
      const last = await prisma.picklist.findFirst({ orderBy: { picklistNumber: "desc" } });
      const seq = last ? Number(last.picklistNumber.replace(/\D/g, "")) + 1 : 1;
      const pl = await prisma.picklist.create({ data: { picklistNumber: `PL-${pad(seq, 5)}`, branchId: b.id, generatedBy: ops, status: "picked", pickedBy: ops, pickedAt: daysAgo(d.age - 0.5 > 0 ? d.age - 0.5 : 0.2), createdAt: daysAgo(d.age) } });
      for (const line of full.lines) {
        const allocs = await prisma.orderAllocation.findMany({ where: { salesOrderLineId: line.id, status: "reserved" } });
        let picked = 0;
        for (const a of allocs) {
          const row = await prisma.stockBalance.findFirst({ where: { warehouseId: a.warehouseId, productId: a.productId, lotNumber: a.lotNumber } });
          await prisma.picklistLine.create({ data: { picklistId: pl.id, salesOrderId: order.id, salesOrderLineId: line.id, productId: line.productId, lotNumber: a.lotNumber, expiryDate: row?.expiryDate ?? null, location: binFor(line.productId), qtyToPick: a.qty, qtyPicked: a.qty } });
          picked += a.qty;
        }
        await prisma.salesOrderLine.update({ where: { id: line.id }, data: { qtyPicked: picked } });
      }

      // invoice
      const o2 = await prisma.salesOrder.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true, outlet: true } });
      const lines = o2.lines.map((l) => ({ l, qty: l.qtyPicked ?? l.qty })).filter((x) => x.qty > 0).map((x) => ({ ...x, amount: Math.round((x.l.lineTotal * x.qty) / x.l.qty) }));
      if (!lines.length) continue;
      const amount = lines.reduce((s, x) => s + x.amount, 0);
      const pos = await outletPosition(outlet.id);
      const { seq: iseq, number } = await nextInvoiceNumber(b.id);
      const invoice = await prisma.invoice.create({
        data: { invoiceNumber: number, branchSeq: iseq, salesOrderId: order.id, outletId: outlet.id, branchId: b.id, invoiceDate: daysAgo(d.age - 0.4 > 0 ? d.age - 0.4 : 0.1), dueDate: dueDateFor(o2.paymentTerms ?? outlet.paymentTerms, daysAgo(d.age)), amount, taxAmount: vatOf(amount, vat), status: "unpaid", deliveryStatus: d.onRoad ? "out_for_delivery" : "pending_delivery" },
      });
      for (const x of lines) await prisma.invoiceLine.create({ data: { invoiceId: invoice.id, productId: x.l.productId, qty: x.qty, unitPrice: x.l.unitPrice, lineTotal: x.amount } });
      await prisma.aRLedgerEntry.create({ data: { outletId: outlet.id, invoiceId: invoice.id, type: "invoice", amount, balance: pos.outstanding + amount, reference: invoice.invoiceNumber, entryDate: daysAgo(d.age) } });
      await dispatchAllocations(order.id, ops, { number: invoice.invoiceNumber, id: invoice.id });
      await prisma.salesOrder.update({ where: { id: order.id }, data: { status: "invoiced", allocationStatus: "dispatched" } });
      await prisma.picklist.update({ where: { id: pl.id }, data: { status: "picked" } });
    }
    console.log(`${b.name}: deliveries on the way topped up`);
  }

  // ---------------------------------------------------------------- 2. Today in the field
  const now0 = new Date();
  const todayStart = new Date(Date.UTC(now0.getUTCFullYear(), now0.getUTCMonth(), now0.getUTCDate()));
  if ((await prisma.attendance.count({ where: { dayDate: todayStart } })) === 0) {
    const reps = users.filter((u) => u.role === "sales_rep");
    const outcomes = ["order_taken", "collection_only", "order_taken", "no_order"];
    for (let ri = 0; ri < reps.length; ri++) {
      const rep = reps[ri];
      const stops = rep.routeId ? await prisma.routeStop.findMany({ where: { routeId: rep.routeId }, include: { outlet: true }, orderBy: { sequence: "asc" }, take: 4 }) : [];
      const first = stops[0]?.outlet;
      const start = new Date(todayStart.getTime() + (8 * 60 + 2 + ri * 4) * 60000);
      await prisma.attendance.create({ data: { userId: rep.id, dayDate: todayStart, startAt: start, startLat: first?.lat ?? 14.6, startLng: first?.lng ?? 121, status: "in_progress", startVariance: ri % 5 === 4 ? "late" : "on_time" } });
      for (let si = 0; si < Math.min(Math.max(1, stops.length - 2), 2); si++) {
        const o = stops[si].outlet;
        const checkin = new Date(todayStart.getTime() + (8 * 60 + 40 + si * 75 + ri * 3) * 60000);
        const outcome = outcomes[(ri + si) % outcomes.length];
        await prisma.fieldVisit.create({ data: { outletId: o.id, salespersonId: rep.id, checkinAt: checkin, checkinLat: o.lat ?? 14.6, checkinLng: o.lng ?? 121, checkoutAt: new Date(checkin.getTime() + (18 + si * 4) * 60000), checkoutLat: o.lat ?? 14.6, checkoutLng: o.lng ?? 121, status: "completed", visitType: "planned", outcome, noOrderReason: outcome === "no_order" ? "Well stocked this week" : null, serviceRating: 4 + ((ri + si) % 2), distanceM: 12 + si * 7 } });
      }
    }
    console.log("Today's field activity added");
  }
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
