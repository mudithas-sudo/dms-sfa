import { PrismaClient } from "@prisma/client";
import { seedExtras } from "./seed-extra";

const prisma = new PrismaClient();

// Deterministic RNG so re-seeding produces the same demo dataset every time.
let seedState = 42;
function rand() {
  seedState = (seedState * 1103515245 + 12345) & 0x7fffffff;
  return seedState / 0x7fffffff;
}
function randInt(min: number, max: number) {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function pick<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)];
}
function pickMany<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    out.push(copy.splice(randInt(0, copy.length - 1), 1)[0]);
  }
  return out;
}
function daysAgo(n: number) {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}
function daysFromNow(n: number) {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}
function jitter(base: number, spread: number) {
  return base + (rand() - 0.5) * spread;
}
function pad(n: number, len: number) {
  return String(n).padStart(len, "0");
}

async function main() {
  console.log("Clearing existing data...");
  // Break self/cross-referential FKs before bulk deletes so statement-level
  // FK checks never see a dangling reference mid-clear.
  await prisma.user.updateMany({ data: { supervisorId: null, routeId: null } });
  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.photo.deleteMany();
  await prisma.orderAllocation.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.vanReconciliationLine.deleteMany();
  await prisma.vanReconciliation.deleteMany();
  await prisma.vanStockCountLine.deleteMany();
  await prisma.vanStockCount.deleteMany();
  await prisma.openingBalanceLine.deleteMany();
  await prisma.openingBalanceBatch.deleteMany();
  await prisma.target.deleteMany();
  await prisma.exportLog.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.deviceRegistration.deleteMany();
  await prisma.approvedHardware.deleteMany();
  await prisma.integrationMessage.deleteMany();
  await prisma.duplicateLog.deleteMany();
  await prisma.biExtract.deleteMany();
  await prisma.appSetting.deleteMany();
  await prisma.financialDocument.deleteMany();
  await prisma.customerChangeRequest.deleteMany();
  await prisma.scheduledReportRun.deleteMany();
  await prisma.claimLine.deleteMany();
  await prisma.undeliveredBalance.deleteMany();
  await prisma.picklistLine.deleteMany();
  await prisma.picklist.deleteMany();
  await prisma.replenishmentLine.deleteMany();
  await prisma.goodsReceiptAttachment.deleteMany();
  await prisma.fieldVisit.deleteMany();
  await prisma.fieldNote.deleteMany();
  await prisma.task.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.expenseRequest.deleteMany();
  await prisma.scheduledReport.deleteMany();
  await prisma.marketReturn.deleteMany();
  await prisma.creditNote.deleteMany();
  await prisma.stockCountLine.deleteMany();
  await prisma.stockCount.deleteMany();
  await prisma.vanLoadLine.deleteMany();
  await prisma.vanLoad.deleteMany();
  await prisma.vanReturn.deleteMany();
  await prisma.replenishmentRequest.deleteMany();
  await prisma.stockTransfer.deleteMany();
  await prisma.stockAdjustment.deleteMany();
  await prisma.stockDamageEvent.deleteMany();
  await prisma.supplierReturn.deleteMany();
  await prisma.pricingRule.deleteMany();
  await prisma.territory.deleteMany();
  await prisma.aRLedgerEntry.deleteMany();
  await prisma.claimStatusHistory.deleteMany();
  await prisma.claim.deleteMany();
  await prisma.approvalRequest.deleteMany();
  await prisma.deliveryReceiptLine.deleteMany();
  await prisma.deliveryReceipt.deleteMany();
  await prisma.invoiceLine.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.salesOrderLine.deleteMany();
  await prisma.salesOrder.deleteMany();
  await prisma.promotion.deleteMany();
  await prisma.goodsReceiptLine.deleteMany();
  await prisma.goodsReceipt.deleteMany();
  await prisma.purchaseOrderLine.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.stockBalance.deleteMany();
  await prisma.van.deleteMany();
  await prisma.warehouse.deleteMany();
  await prisma.routeStop.deleteMany();
  await prisma.outlet.deleteMany();
  await prisma.route.deleteMany();
  await prisma.subChannel.deleteMany();
  await prisma.channel.deleteMany();
  await prisma.product.deleteMany();
  await prisma.user.deleteMany();
  await prisma.branch.deleteMany();

  console.log("Seeding branches...");
  const branchDefs = [
    { name: "Metro Manila Branch", address: "128 Aurora Blvd, Quezon City, NCR", city: "Manila", lat: 14.676, lng: 121.0437 },
    { name: "Cebu Branch", address: "45 Osmeña Blvd, Cebu City, Cebu", city: "Cebu", lat: 10.3157, lng: 123.8854 },
    { name: "Davao Branch", address: "12 Roxas Ave, Davao City, Davao del Sur", city: "Davao", lat: 7.1907, lng: 125.4553 },
  ];
  const branches: Awaited<ReturnType<typeof prisma.branch.create>>[] = [];
  for (const b of branchDefs) {
    branches.push(await prisma.branch.create({ data: { name: b.name, address: b.address } }));
  }

  console.log("Seeding channels & routes...");
  const channelDefs = [
    { name: "General Trade", subChannels: ["Sari-Sari Store", "Carinderia"] },
    { name: "Modern Trade", subChannels: ["Supermarket", "Convenience Store"] },
    { name: "Key Accounts", subChannels: ["Restaurant Chain", "Hotel & Resort"] },
  ];
  const channels = [];
  for (const c of channelDefs) {
    const channelRow = await prisma.channel.create({ data: { name: c.name } });
    for (const sc of c.subChannels) {
      await prisma.subChannel.create({ data: { name: sc, channelId: channelRow.id } });
    }
    channels.push({ row: channelRow, subChannels: c.subChannels });
  }
  const routeNames = ["Route A", "Route B", "Route C", "Route D", "Route E"];
  const routes = [];
  for (const r of routeNames) {
    routes.push(await prisma.route.create({ data: { name: r } }));
  }

  console.log("Seeding products...");
  const productDefs: { sku: string; name: string; uom: string; category: string; hasExpiry: boolean; unitPrice: number }[] = [
    { sku: "BEV-001", name: "Sunrise Cola 330ml", uom: "CS", category: "Beverages", hasExpiry: true, unitPrice: 420 },
    { sku: "BEV-002", name: "Sunrise Cola 1.5L", uom: "CS", category: "Beverages", hasExpiry: true, unitPrice: 610 },
    { sku: "BEV-003", name: "Tropical Fruit Juice 250ml", uom: "CS", category: "Beverages", hasExpiry: true, unitPrice: 380 },
    { sku: "BEV-004", name: "Mountain Spring Water 500ml", uom: "CS", category: "Beverages", hasExpiry: true, unitPrice: 210 },
    { sku: "BEV-005", name: "Coffee 3-in-1 Sachet (10s)", uom: "PACK", category: "Beverages", hasExpiry: true, unitPrice: 95 },
    { sku: "SNK-001", name: "Golden Crunch Chips 60g", uom: "CS", category: "Snacks", hasExpiry: true, unitPrice: 340 },
    { sku: "SNK-002", name: "Choco Sandwich Biscuit 100g", uom: "CS", category: "Snacks", hasExpiry: true, unitPrice: 290 },
    { sku: "SNK-003", name: "Butter Crackers 200g", uom: "CS", category: "Snacks", hasExpiry: true, unitPrice: 260 },
    { sku: "SNK-004", name: "Peanut Snack Mix 80g", uom: "CS", category: "Snacks", hasExpiry: true, unitPrice: 245 },
    { sku: "DRY-001", name: "Creamy Milk UHT 1L", uom: "CS", category: "Dairy", hasExpiry: true, unitPrice: 720 },
    { sku: "DRY-002", name: "Yogurt Drink 180ml", uom: "CS", category: "Dairy", hasExpiry: true, unitPrice: 480 },
    { sku: "DRY-003", name: "Evaporated Milk 370ml", uom: "CS", category: "Dairy", hasExpiry: true, unitPrice: 560 },
    { sku: "FOD-001", name: "Instant Noodles Chicken 55g", uom: "CS", category: "Instant Foods", hasExpiry: true, unitPrice: 260 },
    { sku: "FOD-002", name: "Instant Noodles Beef 55g", uom: "CS", category: "Instant Foods", hasExpiry: true, unitPrice: 260 },
    { sku: "FOD-003", name: "Canned Corned Beef 150g", uom: "CS", category: "Instant Foods", hasExpiry: true, unitPrice: 620 },
    { sku: "FOD-004", name: "Canned Sardines in Tomato Sauce 155g", uom: "CS", category: "Instant Foods", hasExpiry: true, unitPrice: 410 },
    { sku: "FOD-005", name: "Instant Brewed Rice Porridge 50g", uom: "PACK", category: "Instant Foods", hasExpiry: true, unitPrice: 88 },
    { sku: "PCR-001", name: "Fresh Mint Toothpaste 150g", uom: "CS", category: "Personal Care", hasExpiry: true, unitPrice: 510 },
    { sku: "PCR-002", name: "Herbal Shampoo Sachet (12s)", uom: "PACK", category: "Personal Care", hasExpiry: true, unitPrice: 72 },
    { sku: "PCR-003", name: "Antibacterial Soap Bar 90g", uom: "CS", category: "Personal Care", hasExpiry: true, unitPrice: 330 },
    { sku: "PCR-004", name: "Roll-On Deodorant 50ml", uom: "CS", category: "Personal Care", hasExpiry: true, unitPrice: 590 },
    { sku: "HHD-001", name: "Clean Wash Detergent Powder 1kg", uom: "CS", category: "Household", hasExpiry: false, unitPrice: 640 },
    { sku: "HHD-002", name: "Dish Washing Liquid 250ml", uom: "CS", category: "Household", hasExpiry: false, unitPrice: 380 },
    { sku: "HHD-003", name: "Fabric Softener 1L", uom: "CS", category: "Household", hasExpiry: false, unitPrice: 420 },
    { sku: "HHD-004", name: "Multi-Surface Cleaner 500ml", uom: "CS", category: "Household", hasExpiry: false, unitPrice: 350 },
  ];
  const products = [];
  for (const p of productDefs) {
    products.push(await prisma.product.create({ data: p }));
  }

  console.log("Seeding users...");
  const admin = await prisma.user.create({ data: { name: "Maria Santos", role: "admin" } });
  await prisma.user.create({ data: { name: "Carlos Dizon", role: "management" } });

  const branchStaffDefs = [
    { ops: "Ramon Cruz", sup: "Liza Fernandez", reps: ["Juan Dela Cruz", "Ana Reyes", "Mark Villanueva"] },
    { ops: "Pedro Aguilar", sup: "Grace Lim", reps: ["Josephine Tan", "Rico Delos Santos", "Nina Abad"] },
    { ops: "Danilo Ramos", sup: "Cecilia Uy", reps: ["Ferdinand Garcia", "Michelle Ong", "Bayani Torres"] },
  ];

  const branchOps: Record<string, Awaited<ReturnType<typeof prisma.user.create>>> = {};
  const supervisors: Record<string, Awaited<ReturnType<typeof prisma.user.create>>> = {};
  const repsByBranch: Record<string, Awaited<ReturnType<typeof prisma.user.create>>[]> = {};

  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i];
    const def = branchStaffDefs[i];
    branchOps[branch.id] = await prisma.user.create({ data: { name: def.ops, role: "branch_ops", branchId: branch.id } });
    supervisors[branch.id] = await prisma.user.create({ data: { name: def.sup, role: "supervisor", branchId: branch.id } });
    repsByBranch[branch.id] = [];
    for (let r = 0; r < def.reps.length; r++) {
      repsByBranch[branch.id].push(
        await prisma.user.create({
          data: {
            name: def.reps[r],
            role: "sales_rep",
            branchId: branch.id,
            supervisorId: supervisors[branch.id].id,
            routeId: routes[(i * def.reps.length + r) % routes.length].id,
          },
        }),
      );
    }
  }

  console.log("Seeding warehouses & vans...");
  const warehouseByBranch: Record<string, Awaited<ReturnType<typeof prisma.warehouse.create>>> = {};
  const vansByBranch: Record<string, Awaited<ReturnType<typeof prisma.van.create>>[]> = {};
  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i];
    warehouseByBranch[branch.id] = await prisma.warehouse.create({
      data: { name: `${branch.name} Central Warehouse`, branchId: branch.id },
    });
    vansByBranch[branch.id] = [];
    const reps = repsByBranch[branch.id];
    for (let v = 0; v < 2; v++) {
      vansByBranch[branch.id].push(
        await prisma.van.create({
          data: {
            code: `VAN-${branchDefs[i].city.slice(0, 3).toUpperCase()}-${v + 1}`,
            plateNo: `${pick(["NAB", "SJK", "WLT", "RCP"])}-${randInt(1000, 9999)}`,
            driverName: reps[v % reps.length].name,
            assignedUserId: reps[v % reps.length].id,
            branchId: branch.id,
          },
        }),
      );
    }
  }

  console.log("Seeding outlets...");
  const outletNamePool = [
    "Aling Nena's Store", "Mang Tomas Sari-Sari", "Bayanihan Mini Mart", "Kabayan Grocery",
    "Lola Rosa Store", "Tindahan ni Ka Ely", "Barangay Corner Store", "Ilaw ng Tahanan Store",
    "Mabuhay Sari-Sari", "Pag-Asa Grocery", "Lucky Star Store", "Bahay Kubo Carinderia",
    "Fiesta Food Corner", "Tita Baby's Eatery", "Manong Del's Carinderia",
    "MetroFresh Supermarket", "SaveWise Express", "QuickStop Convenience", "DailyMart Convenience",
    "ValuePlus Supermarket", "CityMart Grocery", "SunMart Express",
    "Golden Spoon Restaurant Group", "Fiesta Hotel & Resorts", "Seaside Grill Chain",
    "Harbor View Hotel", "Plaza Diner Group", "Coastal Breeze Resort",
    "Mindanao Grill House", "Crossroads Eatery",
  ];
  const outlets = [];
  let outletSeq = 1;
  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i];
    const city = branchDefs[i];
    const outletsForBranch = pickMany(outletNamePool, 10);
    for (const baseName of outletsForBranch) {
      const channelEntry = pick(channels);
      const subChannel = pick(channelEntry.subChannels);
      const isModernOrKey = channelEntry.row.name !== "General Trade";
      outlets.push(
        await prisma.outlet.create({
          data: {
            name: `${baseName} - ${city.city} ${outletSeq}`,
            branchId: branch.id,
            channelId: channelEntry.row.id,
            subChannel,
            routeId: pick(routes).id,
            address: `${randInt(1, 200)} ${pick(["Rizal St", "Mabini St", "Bonifacio Ave", "Quezon Rd", "Luna St"])}, ${city.city}`,
            lat: jitter(city.lat, 0.15),
            lng: jitter(city.lng, 0.15),
            creditLimit: isModernOrKey ? randInt(150000, 400000) : randInt(20000, 80000),
            status: "active",
          },
        }),
      );
      outletSeq++;
    }
  }

  console.log("Seeding beat plans (route stops) and outlet onboarding queue...");
  for (const route of routes) {
    const stopsForRoute = outlets.filter((o) => o.routeId === route.id);
    for (let s = 0; s < stopsForRoute.length; s++) {
      await prisma.routeStop.create({
        data: { routeId: route.id, outletId: stopsForRoute[s].id, sequence: s + 1 },
      });
    }
  }

  // A few outlets awaiting admin approval / rejected, for the onboarding queue demo.
  const onboardingBranch = branches[0];
  const onboardingChannel = pick(channels);
  await prisma.outlet.create({
    data: {
      name: `New Horizon Grocery - ${branchDefs[0].city} ${outletSeq++}`,
      branchId: onboardingBranch.id,
      channelId: onboardingChannel.row.id,
      subChannel: pick(onboardingChannel.subChannels),
      address: `${randInt(1, 200)} Sampaguita St, ${branchDefs[0].city}`,
      lat: jitter(branchDefs[0].lat, 0.15),
      lng: jitter(branchDefs[0].lng, 0.15),
      creditLimit: 30000,
      status: "inactive",
      onboardingStatus: "pending",
    },
  });
  await prisma.outlet.create({
    data: {
      name: `Riverside Trading Post - ${branchDefs[0].city} ${outletSeq++}`,
      branchId: onboardingBranch.id,
      channelId: onboardingChannel.row.id,
      subChannel: pick(onboardingChannel.subChannels),
      address: `${randInt(1, 200)} Rio St, ${branchDefs[0].city}`,
      lat: jitter(branchDefs[0].lat, 0.15),
      lng: jitter(branchDefs[0].lng, 0.15),
      creditLimit: 30000,
      status: "inactive",
      onboardingStatus: "rejected",
      onboardingReason: "Incomplete business permit documentation",
    },
  });

  console.log("Seeding warehouse stock balances...");
  const lotCounter = { n: 1 };
  function nextLot() {
    return `LOT-${pad(lotCounter.n++, 5)}`;
  }

  for (const branch of branches) {
    const wh = warehouseByBranch[branch.id];
    for (const product of products) {
      const qty = randInt(150, 900);
      const expiry = product.hasExpiry ? daysFromNow(randInt(60, 400)) : null;
      await prisma.stockBalance.create({
        data: {
          locationType: "warehouse",
          warehouseId: wh.id,
          productId: product.id,
          lotNumber: nextLot(),
          expiryDate: expiry,
          qtyGood: qty,
          qtyDamaged: rand() < 0.15 ? randInt(1, 8) : 0,
        },
      });
    }
  }
  // A couple of near-expiry stock items (within 30 days) for the warehouse-stock screen demo.
  const nearExpiryBranch = branches[0];
  const nearExpiryProducts = pickMany(products.filter((p) => p.hasExpiry), 3);
  for (const product of nearExpiryProducts) {
    await prisma.stockBalance.create({
      data: {
        locationType: "warehouse",
        warehouseId: warehouseByBranch[nearExpiryBranch.id].id,
        productId: product.id,
        lotNumber: nextLot(),
        expiryDate: daysFromNow(randInt(3, 25)),
        qtyGood: randInt(20, 80),
        qtyDamaged: 0,
      },
    });
  }

  console.log("Seeding van stock balances...");
  for (const branch of branches) {
    for (const van of vansByBranch[branch.id]) {
      const vanProducts = pickMany(products, 12);
      for (const product of vanProducts) {
        await prisma.stockBalance.create({
          data: {
            locationType: "van",
            vanId: van.id,
            productId: product.id,
            lotNumber: nextLot(),
            expiryDate: product.hasExpiry ? daysFromNow(randInt(45, 200)) : null,
            qtyGood: randInt(15, 80),
            qtyDamaged: 0,
          },
        });
      }
    }
  }

  console.log("Seeding purchase orders & goods receipts...");
  let poSeq = 1;
  let grSeq = 1;
  for (const branch of branches) {
    const wh = warehouseByBranch[branch.id];
    const statuses = ["received", "received", "partially_received", "pending"];
    for (const status of statuses) {
      const orderDate = daysAgo(randInt(3, 25));
      const lines = pickMany(products, randInt(4, 7));
      const po = await prisma.purchaseOrder.create({
        data: {
          poNumber: `PO-${pad(poSeq++, 5)}`,
          branchId: branch.id,
          status,
          orderDate,
          expectedDate: new Date(orderDate.getTime() + 5 * 86400000),
        },
      });
      for (const product of lines) {
        await prisma.purchaseOrderLine.create({
          data: {
            purchaseOrderId: po.id,
            productId: product.id,
            qtyOrdered: randInt(50, 300),
            unitCost: Math.round(product.unitPrice * 0.7),
          },
        });
      }
      if (status === "received" || status === "partially_received") {
        const gr = await prisma.goodsReceipt.create({
          data: {
            grNumber: `GR-${pad(grSeq++, 5)}`,
            purchaseOrderId: po.id,
            warehouseId: wh.id,
            receivedDate: new Date(orderDate.getTime() + 4 * 86400000),
            receivedBy: branchOps[branch.id].name,
          },
        });
        const poLines = await prisma.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
        for (const line of poLines) {
          const receivedQty = status === "received" ? line.qtyOrdered : Math.round(line.qtyOrdered * 0.6);
          await prisma.goodsReceiptLine.create({
            data: {
              goodsReceiptId: gr.id,
              productId: line.productId,
              qtyExpected: line.qtyOrdered,
              qtyReceived: receivedQty,
              lotNumber: nextLot(),
              expiryDate: daysFromNow(randInt(90, 365)),
            },
          });
        }
      }
    }
  }

  console.log("Seeding sales orders, invoices, deliveries, AR ledger over the last 30 days...");
  let orderSeq = 1;
  let invoiceSeq = 1;
  let drSeq = 1;
  const promotionsHolder: Awaited<ReturnType<typeof prisma.promotion.create>>[] = [];

  // Promotions must exist before we reference them on order lines.
  const promoDefs = [
    { name: "Beverages Volume Discount", type: "volume_discount", product: products.find((p) => p.sku === "BEV-001")!, value: 5, freeQty: undefined, startOffset: 30, endOffset: 10 },
    { name: "Buy 10 Get 1 Free - Snacks", type: "free_good", product: products.find((p) => p.sku === "SNK-001")!, value: 0, freeQty: 1, startOffset: 20, endOffset: 15 },
    { name: "Dairy Price-Off Promo", type: "price_off", product: products.find((p) => p.sku === "DRY-001")!, value: 8, freeQty: undefined, startOffset: 15, endOffset: 5 },
    { name: "Household Rebate Program", type: "rebate", product: products.find((p) => p.sku === "HHD-001")!, value: 3, freeQty: undefined, startOffset: 45, endOffset: -5 },
  ];
  const generalTradeChannel = channels.find((c) => c.row.name === "General Trade")!.row;
  for (const p of promoDefs) {
    promotionsHolder.push(
      await prisma.promotion.create({
        data: {
          name: p.name,
          type: p.type,
          eligibilityRule: `Product=${p.product.sku} AND Qty>=10`,
          minQty: 10,
          productId: p.product.id,
          channelId: p.name === "Beverages Volume Discount" ? generalTradeChannel.id : undefined,
          discountValue: p.value,
          freeQty: p.freeQty,
          startDate: daysAgo(p.startOffset),
          endDate: p.endOffset >= 0 ? daysFromNow(p.endOffset) : daysAgo(-p.endOffset),
          status: p.endOffset >= 0 ? "active" : "expired",
        },
      }),
    );
  }

  const arByOutlet: Record<string, number> = {};

  for (const branch of branches) {
    const branchOutlets = outlets.filter((o) => o.branchId === branch.id);
    const reps = repsByBranch[branch.id];

    for (let day = 29; day >= 0; day--) {
      const ordersToday = randInt(1, 3);
      for (let k = 0; k < ordersToday; k++) {
        const outlet = pick(branchOutlets);
        const rep = pick(reps);
        const lines = pickMany(products, randInt(2, 5));
        let subtotal = 0;
        let discountTotal = 0;
        const orderDate = daysAgo(day);

        const statusRoll = rand();
        const status = day === 0
          ? pick(["draft", "confirmed"])
          : statusRoll < 0.08
            ? "voided"
            : statusRoll < 0.35
              ? "confirmed"
              : "delivered"; // most historical orders are fully processed for realistic dashboards

        const order = await prisma.salesOrder.create({
          data: {
            orderNumber: `SO-${pad(orderSeq++, 6)}`,
            outletId: outlet.id,
            branchId: branch.id,
            salespersonId: rep.id,
            status,
            orderDate,
            requestedDeliveryDate: new Date(orderDate.getTime() + randInt(1, 3) * 86400000),
            subtotal: 0,
            discountTotal: 0,
            total: 0,
          },
        });

        for (const product of lines) {
          const qty = randInt(5, 40);
          const applicablePromo = promotionsHolder.find(
            (p) => p.productId === product.id && p.startDate <= orderDate && p.endDate >= orderDate,
          );
          const lineDiscount = applicablePromo ? Math.round(product.unitPrice * qty * (applicablePromo.discountValue / 100)) : 0;
          const lineTotal = product.unitPrice * qty - lineDiscount;
          subtotal += product.unitPrice * qty;
          discountTotal += lineDiscount;
          await prisma.salesOrderLine.create({
            data: {
              salesOrderId: order.id,
              productId: product.id,
              qty,
              unitPrice: product.unitPrice,
              discount: lineDiscount,
              lineTotal,
              promotionId: applicablePromo?.id,
            },
          });
        }

        const total = subtotal - discountTotal;
        await prisma.salesOrder.update({ where: { id: order.id }, data: { subtotal, discountTotal, total } });

        if (status === "delivered" || status === "confirmed") {
          const invoiceStatusRoll = rand();
          const invoiceDate = orderDate;
          const dueDate = new Date(invoiceDate.getTime() + 30 * 86400000);
          const isOverdue = dueDate < new Date() && invoiceStatusRoll > 0.75;
          const invoiceStatus =
            status === "confirmed"
              ? "unpaid"
              : isOverdue
                ? "overdue"
                : invoiceStatusRoll < 0.5
                  ? "paid"
                  : invoiceStatusRoll < 0.8
                    ? "partially_paid"
                    : "unpaid";

          const invoice = await prisma.invoice.create({
            data: {
              invoiceNumber: `INV-${pad(invoiceSeq++, 6)}`,
              salesOrderId: order.id,
              outletId: outlet.id,
              branchId: branch.id,
              invoiceDate,
              dueDate,
              amount: total,
              status: invoiceStatus,
            },
          });

          const invoiceLines = await prisma.salesOrderLine.findMany({ where: { salesOrderId: order.id } });
          for (const l of invoiceLines) {
            await prisma.invoiceLine.create({
              data: { invoiceId: invoice.id, productId: l.productId, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal },
            });
          }

          if (status === "delivered") {
            const isPartial = rand() < 0.12 && invoiceLines.length > 1;
            const shortLineIndex = isPartial ? randInt(0, invoiceLines.length - 1) : -1;
            const dr = await prisma.deliveryReceipt.create({
              data: {
                drNumber: `DR-${pad(drSeq++, 6)}`,
                invoiceId: invoice.id,
                deliveredAt: new Date(invoiceDate.getTime() + 86400000),
                receivedBy: `${outlet.name} staff`,
                status: isPartial ? "partial" : "delivered",
              },
            });
            for (let li = 0; li < invoiceLines.length; li++) {
              const l = invoiceLines[li];
              const qtyDelivered = li === shortLineIndex ? Math.max(1, l.qty - randInt(1, Math.min(3, l.qty))) : l.qty;
              await prisma.deliveryReceiptLine.create({
                data: { deliveryReceiptId: dr.id, productId: l.productId, qtyOrdered: l.qty, qtyDelivered },
              });
            }
          }

          arByOutlet[outlet.id] = (arByOutlet[outlet.id] ?? 0) + total;
          await prisma.aRLedgerEntry.create({
            data: {
              outletId: outlet.id,
              invoiceId: invoice.id,
              type: "invoice",
              amount: total,
              balance: arByOutlet[outlet.id],
              entryDate: invoiceDate,
              reference: invoice.invoiceNumber,
            },
          });

          if (invoiceStatus === "paid" || invoiceStatus === "partially_paid") {
            const paidAmount = invoiceStatus === "paid" ? total : Math.round(total * 0.5);
            arByOutlet[outlet.id] -= paidAmount;
            await prisma.aRLedgerEntry.create({
              data: {
                outletId: outlet.id,
                invoiceId: invoice.id,
                type: "payment",
                method: pick(["cash", "cheque"]),
                amount: paidAmount,
                balance: arByOutlet[outlet.id],
                entryDate: new Date(invoiceDate.getTime() + randInt(2, 20) * 86400000),
                reference: `OR-${randInt(10000, 99999)}`,
              },
            });
          }
        }
      }
    }
  }

  console.log("Seeding aged overdue invoices for AR aging demo...");
  // The rolling 30-day order history above never produces an overdue invoice
  // (30-day payment terms always land in the future), so add a few older,
  // explicitly overdue invoices to populate the 31-60 / 60+ AR aging buckets.
  const agedOverdueDefs = [
    { branchIdx: 0, daysPastDue: 10 },
    { branchIdx: 0, daysPastDue: 45 },
    { branchIdx: 1, daysPastDue: 75 },
  ];
  for (const def of agedOverdueDefs) {
    const branch = branches[def.branchIdx];
    const branchOutlets = outlets.filter((o) => o.branchId === branch.id);
    const outlet = pick(branchOutlets);
    const rep = pick(repsByBranch[branch.id]);
    const product = pick(products);
    const qty = randInt(20, 60);
    const total = product.unitPrice * qty;
    const dueDate = daysAgo(def.daysPastDue);
    const invoiceDate = new Date(dueDate.getTime() - 30 * 86400000);

    const order = await prisma.salesOrder.create({
      data: {
        orderNumber: `SO-${pad(orderSeq++, 6)}`,
        outletId: outlet.id,
        branchId: branch.id,
        salespersonId: rep.id,
        status: "delivered",
        orderDate: invoiceDate,
        subtotal: total,
        discountTotal: 0,
        total,
      },
    });
    await prisma.salesOrderLine.create({
      data: { salesOrderId: order.id, productId: product.id, qty, unitPrice: product.unitPrice, discount: 0, lineTotal: total },
    });

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-${pad(invoiceSeq++, 6)}`,
        salesOrderId: order.id,
        outletId: outlet.id,
        branchId: branch.id,
        invoiceDate,
        dueDate,
        amount: total,
        status: "overdue",
      },
    });
    await prisma.invoiceLine.create({
      data: { invoiceId: invoice.id, productId: product.id, qty, unitPrice: product.unitPrice, lineTotal: total },
    });

    arByOutlet[outlet.id] = (arByOutlet[outlet.id] ?? 0) + total;
    await prisma.aRLedgerEntry.create({
      data: {
        outletId: outlet.id,
        invoiceId: invoice.id,
        type: "invoice",
        amount: total,
        balance: arByOutlet[outlet.id],
        entryDate: invoiceDate,
        reference: invoice.invoiceNumber,
      },
    });
  }

  console.log("Seeding claims...");
  const claimStatuses = ["settled", "approved", "reviewed", "submitted"];
  let claimSeq = 1;
  for (let i = 0; i < claimStatuses.length; i++) {
    const status = claimStatuses[i];
    const promo = promotionsHolder[i % promotionsHolder.length];
    const branch = branches[i % branches.length];
    const submitter = supervisors[branch.id];
    const claim = await prisma.claim.create({
      data: {
        claimNumber: `CLM-${pad(claimSeq++, 4)}`,
        promotionId: promo.id,
        submittedById: submitter.id,
        amount: randInt(8000, 45000),
        status,
        submittedAt: daysAgo(randInt(5, 20)),
        notes: `Trade claim for ${promo.name}`,
      },
    });
    const historySteps = ["submitted", "reviewed", "approved", "settled"].slice(
      0,
      ["submitted", "reviewed", "approved", "settled"].indexOf(status) + 1,
    );
    for (const step of historySteps) {
      await prisma.claimStatusHistory.create({
        data: {
          claimId: claim.id,
          status: step,
          changedBy: submitter.name,
          changedAt: daysAgo(randInt(1, 20)),
          reason: step === "approved" ? "Meets promo eligibility criteria" : null,
        },
      });
    }
  }

  console.log("Seeding approval requests (credit limit + discount overrides)...");
  const exceptionBranch = branches[0];
  const exceptionOrder = await prisma.salesOrder.findFirst({
    where: { branchId: exceptionBranch.id },
    orderBy: { orderDate: "desc" },
    include: { outlet: true },
  });
  const exceptionOutlet = exceptionOrder?.outlet ?? outlets.find((o) => o.branchId === exceptionBranch.id)!;
  await prisma.approvalRequest.create({
    data: {
      type: "credit_limit_exception",
      salesOrderId: exceptionOrder?.id,
      requestedBy: repsByBranch[exceptionBranch.id][0].name,
      amount: exceptionOutlet.creditLimit + 15000,
      reason: `Order exceeds ${exceptionOutlet.name}'s credit limit of ₱${exceptionOutlet.creditLimit.toLocaleString()} due to seasonal restock`,
      status: "pending",
    },
  });
  await prisma.approvalRequest.create({
    data: {
      type: "discount_override",
      requestedBy: repsByBranch[branches[1].id][0].name,
      amount: 12500,
      reason: "Requesting extra 5% discount to match competitor promo at key account outlet",
      status: "pending",
    },
  });
  await prisma.approvalRequest.create({
    data: {
      type: "stock_shortage",
      requestedBy: repsByBranch[branches[1].id][1].name,
      amount: 0,
      reason: "Order for Kabayan Grocery includes 40 CS Sunrise Cola 330ml but van only has 22 CS remaining",
      status: "pending",
    },
  });
  await prisma.approvalRequest.create({
    data: {
      type: "price_promo_mismatch",
      requestedBy: repsByBranch[branches[2].id][0].name,
      amount: 3200,
      reason: "Line price does not match the active promo discount for Golden Crunch Chips 60g — needs supervisor confirmation before invoicing",
      status: "pending",
    },
  });

  console.log("Seeding a voided order (no-hard-delete demonstration)...");
  const voidBranch = branches[1];
  const voidOutlet = outlets.find((o) => o.branchId === voidBranch.id)!;
  const voidRep = repsByBranch[voidBranch.id][0];
  const voidProduct = products[0];
  const voidQty = 15;
  const voidTotal = voidProduct.unitPrice * voidQty;
  const voidOrderDate = daysAgo(6);
  const voidOrder = await prisma.salesOrder.create({
    data: {
      orderNumber: `SO-${pad(orderSeq++, 6)}`,
      outletId: voidOutlet.id,
      branchId: voidBranch.id,
      salespersonId: voidRep.id,
      status: "invoiced",
      orderDate: voidOrderDate,
      subtotal: voidTotal,
      discountTotal: 0,
      total: voidTotal,
    },
  });
  await prisma.salesOrderLine.create({
    data: { salesOrderId: voidOrder.id, productId: voidProduct.id, qty: voidQty, unitPrice: voidProduct.unitPrice, discount: 0, lineTotal: voidTotal },
  });
  const voidInvoice = await prisma.invoice.create({
    data: {
      invoiceNumber: `INV-${pad(invoiceSeq++, 6)}`,
      salesOrderId: voidOrder.id,
      outletId: voidOutlet.id,
      branchId: voidBranch.id,
      invoiceDate: voidOrderDate,
      dueDate: new Date(voidOrderDate.getTime() + 30 * 86400000),
      amount: voidTotal,
      status: "unpaid",
    },
  });
  await prisma.invoiceLine.create({
    data: { invoiceId: voidInvoice.id, productId: voidProduct.id, qty: voidQty, unitPrice: voidProduct.unitPrice, lineTotal: voidTotal },
  });
  arByOutlet[voidOutlet.id] = (arByOutlet[voidOutlet.id] ?? 0) + voidTotal;
  await prisma.aRLedgerEntry.create({
    data: { outletId: voidOutlet.id, invoiceId: voidInvoice.id, type: "invoice", amount: voidTotal, balance: arByOutlet[voidOutlet.id], entryDate: voidOrderDate, reference: voidInvoice.invoiceNumber },
  });
  const voidApproval = await prisma.approvalRequest.create({
    data: {
      type: "order_void",
      salesOrderId: voidOrder.id,
      requestedBy: voidRep.name,
      amount: voidTotal,
      reason: "Outlet reported the delivery never arrived — order raised in error",
      status: "approved",
      decidedBy: supervisors[voidBranch.id].name,
      decisionNote: "Confirmed with warehouse: goods were never dispatched.",
      createdAt: daysAgo(2),
      decidedAt: daysAgo(1),
    },
  });
  await prisma.salesOrder.update({
    where: { id: voidOrder.id },
    data: { status: "voided", voidReason: voidApproval.reason },
  });
  await prisma.invoice.update({ where: { id: voidInvoice.id }, data: { status: "voided" } });
  arByOutlet[voidOutlet.id] -= voidTotal;
  await prisma.aRLedgerEntry.create({
    data: {
      outletId: voidOutlet.id,
      invoiceId: voidInvoice.id,
      type: "void_reversal",
      amount: -voidTotal,
      balance: arByOutlet[voidOutlet.id],
      entryDate: daysAgo(1),
      reference: `VOID-${voidInvoice.invoiceNumber}`,
    },
  });

  console.log("Seeding stock counts, van loads, field visits, audit log...");
  for (const branch of branches) {
    const wh = warehouseByBranch[branch.id];
    const stockRows = await prisma.stockBalance.findMany({ where: { warehouseId: wh.id }, take: 6 });
    const count = await prisma.stockCount.create({
      data: { warehouseId: wh.id, countedBy: branchOps[branch.id].name, countedAt: daysAgo(2), status: "closed" },
    });
    for (const row of stockRows) {
      const variance = rand() < 0.3 ? -randInt(1, 5) : 0;
      await prisma.stockCountLine.create({
        data: {
          stockCountId: count.id,
          productId: row.productId,
          lotNumber: row.lotNumber,
          systemQty: row.qtyGood,
          countedQty: row.qtyGood + variance,
          variance,
        },
      });
    }

    for (const van of vansByBranch[branch.id]) {
      const load = await prisma.vanLoad.create({
        data: {
          vanId: van.id,
          warehouseId: wh.id,
          loadedAt: daysAgo(1),
          loadedBy: branchOps[branch.id].name,
          status: "approved",
          approvedBy: branchOps[branch.id].name,
          decidedAt: daysAgo(1),
          confirmedAt: daysAgo(1),
        },
      });
      const vanStock = await prisma.stockBalance.findMany({ where: { vanId: van.id }, take: 5 });
      for (const row of vanStock) {
        await prisma.vanLoadLine.create({
          data: { vanLoadId: load.id, productId: row.productId, qty: row.qtyGood, lotNumber: row.lotNumber },
        });
      }
    }

    const branchOutlets = outlets.filter((o) => o.branchId === branch.id);
    for (const rep of repsByBranch[branch.id]) {
      for (let d = 4; d >= 1; d--) {
        const outlet = pick(branchOutlets);
        const checkin = daysAgo(d);
        checkin.setHours(randInt(8, 11), randInt(0, 59));
        const checkout = new Date(checkin.getTime() + randInt(20, 60) * 60000);
        await prisma.fieldVisit.create({
          data: {
            outletId: outlet.id,
            salespersonId: rep.id,
            checkinAt: checkin,
            checkinLat: jitter(outlet.lat, 0.001),
            checkinLng: jitter(outlet.lng, 0.001),
            checkoutAt: checkout,
            feedback: pick([
              "Outlet fully stocked, good shelf visibility.",
              "Requested more stock of beverages for weekend rush.",
              "Competitor promo spotted, flagged to supervisor.",
              "Outlet renovating, limited shelf space this week.",
            ]),
            photoPlaceholder: true,
            status: "completed",
          },
        });

        if (d === 1) {
          // Yesterday's full day, so the mobile Attendance screen has a closed-out record.
          const dayStart = daysAgo(d);
          dayStart.setHours(8, randInt(0, 30));
          const dayEnd = daysAgo(d);
          dayEnd.setHours(17, randInt(0, 45));
          await prisma.attendance.create({
            data: {
              userId: rep.id,
              dayDate: daysAgo(d),
              startAt: dayStart,
              startLat: jitter(branch.id === branches[0].id ? 14.676 : branch.id === branches[1].id ? 10.3157 : 7.1907, 0.05),
              startLng: jitter(branch.id === branches[0].id ? 121.0437 : branch.id === branches[1].id ? 123.8854 : 125.4553, 0.05),
              endAt: dayEnd,
              endLat: jitter(outlet.lat, 0.01),
              endLng: jitter(outlet.lng, 0.01),
              status: "completed",
            },
          });
        }
      }
      // One in-progress visit for today to populate the SFA home dashboard.
      const todayOutlet = pick(branchOutlets);

      // Today's day is still open for one rep per branch, so /sfa/attendance has a live example.
      if (repsByBranch[branch.id][0].id === rep.id) {
        const todayStart = new Date();
        todayStart.setHours(8, 15);
        await prisma.attendance.create({
          data: { userId: rep.id, dayDate: new Date(), startAt: todayStart, startLat: todayOutlet.lat, startLng: todayOutlet.lng, status: "in_progress" },
        });
      }
      await prisma.fieldVisit.create({
        data: {
          outletId: todayOutlet.id,
          salespersonId: rep.id,
          checkinAt: new Date(),
          checkinLat: jitter(todayOutlet.lat, 0.001),
          checkinLng: jitter(todayOutlet.lng, 0.001),
          status: "in_progress",
        },
      });
    }
  }

  console.log("Seeding stock transfers, adjustments, and van returns...");
  // Look up real lot numbers rather than guessing them — the shared lotCounter
  // increments across every branch/product combination, not per branch.
  async function lotFor(warehouseId: string, sku: string) {
    const row = await prisma.stockBalance.findFirstOrThrow({
      where: { warehouseId, product: { sku } },
    });
    return row.lotNumber;
  }

  {
    const fromWh = warehouseByBranch[branches[0].id];
    const toWh = warehouseByBranch[branches[1].id];
    const transferProduct = products.find((p) => p.sku === "BEV-001")!;
    await prisma.stockTransfer.create({
      data: {
        fromWarehouseId: fromWh.id,
        toWarehouseId: toWh.id,
        productId: transferProduct.id,
        lotNumber: await lotFor(fromWh.id, "BEV-001"),
        qty: 80,
        status: "pending",
        requestedBy: branchOps[branches[0].id].name,
      },
    });
    await prisma.stockTransfer.create({
      data: {
        fromWarehouseId: toWh.id,
        toWarehouseId: fromWh.id,
        productId: products.find((p) => p.sku === "SNK-001")!.id,
        lotNumber: await lotFor(toWh.id, "SNK-001"),
        qty: 40,
        status: "completed",
        requestedBy: branchOps[branches[1].id].name,
        approvedBy: supervisors[branches[1].id].name,
        createdAt: daysAgo(3),
        decidedAt: daysAgo(2),
      },
    });

    const adjWh = warehouseByBranch[branches[2].id];
    const adjProduct = products.find((p) => p.sku === "DRY-002")!;
    await prisma.stockAdjustment.create({
      data: {
        warehouseId: adjWh.id,
        productId: adjProduct.id,
        lotNumber: await lotFor(adjWh.id, "DRY-002"),
        qtyDelta: -12,
        reasonCode: "damage",
        status: "pending",
        requestedBy: branchOps[branches[2].id].name,
        notes: "12 units found leaking during shelf check",
      },
    });
    await prisma.stockAdjustment.create({
      data: {
        warehouseId: adjWh.id,
        productId: products.find((p) => p.sku === "HHD-002")!.id,
        lotNumber: await lotFor(adjWh.id, "HHD-002"),
        qtyDelta: 5,
        reasonCode: "count_correction",
        status: "approved",
        requestedBy: branchOps[branches[2].id].name,
        approvedBy: supervisors[branches[2].id].name,
        createdAt: daysAgo(4),
        decidedAt: daysAgo(3),
      },
    });

    const returnVan = vansByBranch[branches[0].id][0];
    await prisma.vanReturn.create({
      data: {
        vanId: returnVan.id,
        warehouseId: fromWh.id,
        productId: products.find((p) => p.sku === "BEV-004")!.id,
        lotNumber: await lotFor(fromWh.id, "BEV-004"),
        qty: 6,
        condition: "good",
        reason: "Unsold end-of-day surplus",
        status: "completed",
        returnedBy: returnVan.driverName,
        createdAt: daysAgo(1),
      },
    });
    await prisma.vanReturn.create({
      data: {
        vanId: returnVan.id,
        warehouseId: fromWh.id,
        productId: products.find((p) => p.sku === "DRY-001")!.id,
        lotNumber: await lotFor(fromWh.id, "DRY-001"),
        qty: 3,
        condition: "damaged",
        reason: "Crushed cases from van transit",
        status: "completed",
        returnedBy: returnVan.driverName,
        createdAt: daysAgo(1),
      },
    });
  }

  console.log("Seeding van replenishment requests...");
  await prisma.replenishmentRequest.create({
    data: {
      vanId: vansByBranch[branches[0].id][1].id,
      branchId: branches[0].id,
      productId: products.find((p) => p.sku === "BEV-002")!.id,
      qtyRequested: 30,
      status: "pending",
      requestedBy: repsByBranch[branches[0].id][1].name,
    },
  });
  await prisma.replenishmentRequest.create({
    data: {
      vanId: vansByBranch[branches[1].id][0].id,
      branchId: branches[1].id,
      productId: products.find((p) => p.sku === "SNK-002")!.id,
      qtyRequested: 20,
      status: "fulfilled",
      requestedBy: repsByBranch[branches[1].id][0].name,
      createdAt: daysAgo(3),
      decidedAt: daysAgo(2),
    },
  });

  console.log("Seeding tasks, field notes, and workforce requests...");
  const taskOutlet = outlets.find((o) => o.branchId === branches[0].id)!;
  await prisma.task.create({
    data: {
      title: "Set up new end-cap display",
      description: "Install the Q4 promo end-cap for Sunrise Cola at the store entrance.",
      assignedToId: repsByBranch[branches[0].id][0].id,
      assignedById: supervisors[branches[0].id].id,
      outletId: taskOutlet.id,
      dueDate: daysFromNow(2),
      status: "pending",
    },
  });
  await prisma.task.create({
    data: {
      title: "Collect signed credit application",
      description: "Outlet requested a credit limit increase; get the signed form.",
      assignedToId: repsByBranch[branches[1].id][0].id,
      assignedById: supervisors[branches[1].id].id,
      outletId: outlets.find((o) => o.branchId === branches[1].id)!.id,
      dueDate: daysAgo(1),
      status: "completed",
      completedAt: daysAgo(1),
    },
  });

  for (const branch of branches) {
    const rep = repsByBranch[branch.id][0];
    const noteOutlet = outlets.find((o) => o.branchId === branch.id)!;
    await prisma.fieldNote.create({
      data: {
        outletId: noteOutlet.id,
        salespersonId: rep.id,
        type: "shelf_audit",
        notes: "Facing count: 12 units Sunrise Cola, 8 units Golden Crunch Chips. Planogram compliant.",
        photoPlaceholder: true,
        createdAt: daysAgo(2),
      },
    });
    await prisma.fieldNote.create({
      data: {
        outletId: noteOutlet.id,
        salespersonId: rep.id,
        type: "competitor",
        notes: "Competitor running a 2-for-1 promo on canned beverages this week — flagged for pricing review.",
        photoPlaceholder: true,
        createdAt: daysAgo(3),
      },
    });
  }
  await prisma.fieldNote.create({
    data: {
      outletId: outlets.find((o) => o.branchId === branches[2].id)!.id,
      salespersonId: repsByBranch[branches[2].id][0].id,
      type: "merchandising",
      notes: "Requested additional wire shelving for household category — current shelf is overcrowded.",
      photoPlaceholder: true,
      createdAt: daysAgo(1),
    },
  });

  await prisma.leaveRequest.create({
    data: {
      userId: repsByBranch[branches[0].id][2].id,
      startDate: daysFromNow(5),
      endDate: daysFromNow(6),
      reason: "Family event",
      status: "pending",
    },
  });
  await prisma.leaveRequest.create({
    data: {
      userId: repsByBranch[branches[1].id][2].id,
      startDate: daysAgo(10),
      endDate: daysAgo(9),
      reason: "Medical appointment",
      status: "approved",
      approvedBy: supervisors[branches[1].id].name,
      createdAt: daysAgo(12),
      decidedAt: daysAgo(11),
    },
  });

  await prisma.expenseRequest.create({
    data: {
      userId: repsByBranch[branches[0].id][1].id,
      amount: 850,
      category: "fuel",
      description: "Fuel top-up for route coverage — receipt attached",
      receiptPlaceholder: true,
      status: "pending",
    },
  });
  await prisma.expenseRequest.create({
    data: {
      userId: repsByBranch[branches[2].id][0].id,
      amount: 320,
      category: "meals",
      description: "Client meeting lunch",
      receiptPlaceholder: true,
      status: "approved",
      approvedBy: supervisors[branches[2].id].name,
      createdAt: daysAgo(6),
      decidedAt: daysAgo(5),
    },
  });

  console.log("Seeding a market return + credit note...");
  const mrOutlet = outlets.find((o) => o.branchId === branches[0].id)!;
  const mrProduct = products.find((p) => p.sku === "DRY-002")!;
  const settledCreditNote = await prisma.creditNote.create({
    data: {
      noteNumber: "CN-0001",
      outletId: mrOutlet.id,
      amount: mrProduct.unitPrice * 4,
      reason: "Damaged stock returned by outlet",
      status: "issued",
      issuedBy: supervisors[branches[0].id].name,
      issuedAt: daysAgo(3),
    },
  });
  await prisma.marketReturn.create({
    data: {
      outletId: mrOutlet.id,
      productId: mrProduct.id,
      qty: 4,
      reason: "Damaged in transit",
      photoPlaceholder: true,
      status: "processed",
      capturedBy: repsByBranch[branches[0].id][0].name,
      createdAt: daysAgo(3),
      creditNoteId: settledCreditNote.id,
    },
  });
  arByOutlet[mrOutlet.id] = (arByOutlet[mrOutlet.id] ?? 0) - settledCreditNote.amount;
  await prisma.aRLedgerEntry.create({
    data: {
      outletId: mrOutlet.id,
      type: "credit_note",
      amount: -settledCreditNote.amount,
      balance: arByOutlet[mrOutlet.id],
      entryDate: daysAgo(3),
      reference: settledCreditNote.noteNumber,
    },
  });
  await prisma.marketReturn.create({
    data: {
      outletId: outlets.find((o) => o.branchId === branches[1].id)!.id,
      productId: products.find((p) => p.sku === "FOD-004")!.id,
      qty: 6,
      reason: "Near-expiry stock rejected by outlet",
      photoPlaceholder: true,
      status: "pending",
      capturedBy: repsByBranch[branches[1].id][1].name,
      createdAt: daysAgo(1),
    },
  });

  console.log("Seeding a fixed customer discount and scheduled reports...");
  const standingDiscountOutlet = outlets.find((o) => o.branchId === branches[0].id)!;
  await prisma.pricingRule.create({
    data: {
      name: `${standingDiscountOutlet.name} — Standing 4% Discount`,
      level: "customer",
      outletId: standingDiscountOutlet.id,
      priceType: "discount_percent",
      value: 4,
      startDate: daysAgo(60),
      status: "active",
    },
  });
  await prisma.scheduledReport.create({
    data: {
      name: "Weekly Sales Summary",
      reportType: "sales-by-dimension", frequency: "weekly", relativeDates: "previous_week", ownerId: admin.id,
      scheduleDescription: "Every Monday 8:00 AM",
      recipientEmails: "management@companyfnb.example, admin@companyfnb.example",
      status: "active",
      lastRunAt: daysAgo(6),
      createdBy: admin.name,
    },
  });
  await prisma.scheduledReport.create({
    data: {
      name: "Monthly AR Aging",
      reportType: "receivables-ageing", frequency: "monthly", relativeDates: "previous_month", ownerId: admin.id,
      scheduleDescription: "1st of every month, 7:00 AM",
      recipientEmails: "finance@companyfnb.example",
      status: "active",
      lastRunAt: daysAgo(28),
      createdBy: admin.name,
    },
  });
  await prisma.scheduledReport.create({
    data: {
      name: "Inventory Valuation",
      reportType: "stock-on-hand", frequency: "daily", ownerId: admin.id,
      scheduleDescription: "Every Friday 6:00 PM",
      recipientEmails: "ops@companyfnb.example",
      status: "inactive",
      createdBy: admin.name,
    },
  });

  const auditEntries = [
    { entity: "Product", action: "update", user: admin, summary: "Updated unit price for Sunrise Cola 330ml" },
    { entity: "Promotion", action: "create", user: admin, summary: "Created promotion 'Beverages Volume Discount'" },
    { entity: "Outlet", action: "create", user: admin, summary: "Added new outlet to Cebu Branch route" },
    { entity: "Branch", action: "update", user: admin, summary: "Updated address for Davao Branch" },
  ];
  for (let i = 0; i < auditEntries.length; i++) {
    const e = auditEntries[i];
    await prisma.auditLog.create({
      data: { entity: e.entity, entityId: "seed", action: e.action, userId: e.user.id, summary: e.summary, createdAt: daysAgo(i + 1) },
    });
  }
  await prisma.auditLog.create({
    data: {
      entity: "SalesOrder",
      entityId: voidOrder.id,
      action: "void",
      userId: admin.id,
      summary: `Voided ${voidOrder.orderNumber} — outlet reported delivery never arrived`,
      beforeData: JSON.stringify({ status: "invoiced" }),
      afterData: JSON.stringify({ status: "voided", voidReason: voidApproval.reason }),
      createdAt: daysAgo(1),
    },
  });
  await prisma.auditLog.create({
    data: {
      entity: "Outlet",
      entityId: mrOutlet.id,
      action: "update",
      userId: supervisors[branches[0].id].id,
      summary: `Issued credit note ${settledCreditNote.noteNumber} for damaged stock return`,
      beforeData: JSON.stringify({ note: "none" }),
      afterData: JSON.stringify({ creditNote: settledCreditNote.noteNumber, amount: settledCreditNote.amount }),
      createdAt: daysAgo(3),
    },
  });

  await seedExtras(prisma);
  console.log("Seed complete.");
  console.log(`Branches: ${branches.length}, Outlets: ${outlets.length}, Products: ${products.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
