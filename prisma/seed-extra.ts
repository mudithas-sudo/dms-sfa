import { PrismaClient } from "@prisma/client";
import { seedDemo } from "./seed-demo";

// Additive demo data for the v2.0 proposal features. Idempotent: it fills new fields on
// existing rows and adds records only when they are missing, so it can be run on top of the
// main seed (called from seed.ts) or on its own against a database that is already loaded.

const BRAND_BY_CATEGORY: Record<string, string> = {
  Beverages: "Sunrise",
  Snacks: "Golden Crunch",
  Dairy: "Farm Fresh",
  "Household Care": "CleanHome",
  Household: "CleanHome",
  "Personal Care": "FreshCare",
  "Canned Goods": "Island Harvest",
  Biscuits: "Sweet Bite",
  Noodles: "Quick Bowl",
};
const SHELF_DAYS: Record<string, number> = { Beverages: 270, Snacks: 180, Dairy: 120, Biscuits: 240, "Canned Goods": 720, Noodles: 300 };
const VISIT_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export async function seedExtras(prisma: PrismaClient) {
  console.log("Seeding v2.0 proposal extras...");

  // ---- Branches
  const branches = await prisma.branch.findMany({ orderBy: { name: "asc" } });
  const REGION: Record<string, string> = { Manila: "Luzon", Cebu: "Visayas", Davao: "Mindanao" };
  for (const b of branches) {
    const key = Object.keys(REGION).find((k) => b.name.includes(k));
    await prisma.branch.update({
      where: { id: b.id },
      data: {
        region: b.region ?? (key ? REGION[key] : null),
        contactEmail: b.contactEmail ?? `${(b.code ?? b.name).toLowerCase().replace(/[^a-z0-9]+/g, ".")}@companyfb.ph`,
        activatedAt: b.activatedAt ?? b.createdAt,
      },
    });
  }

  // ---- Channels & sub-channels
  const channels = await prisma.channel.findMany({ include: { subChannels: true } });
  for (const c of channels) {
    if (!c.code) {
      const code = c.name.split(" ").map((w) => w[0]).join("").toUpperCase();
      await prisma.channel.update({ where: { id: c.id }, data: { code } }).catch(() => undefined);
    }
    for (const [i, s] of c.subChannels.entries()) {
      if (!s.code) await prisma.subChannel.update({ where: { id: s.id }, data: { code: `${(c.code ?? c.name.slice(0, 2)).toUpperCase()}-${i + 1}` } });
    }
  }

  // ---- Territories / routes
  const routes = await prisma.route.findMany({ orderBy: { name: "asc" } });
  for (const [i, r] of routes.entries()) {
    await prisma.route.update({
      where: { id: r.id },
      data: { code: r.code ?? `R-${String.fromCharCode(65 + i)}`, visitDay: r.visitDay ?? VISIT_DAYS[i % VISIT_DAYS.length], frequency: r.frequency || "weekly" },
    });
  }

  // ---- Outlets: codes, contacts, terms
  const outlets = await prisma.outlet.findMany({ orderBy: { createdAt: "asc" } });
  let n = 0;
  for (const o of outlets) {
    n += 1;
    const terms = n % 7 === 0 ? "cash" : n % 5 === 0 ? "credit_15" : n % 3 === 0 ? "credit_45" : "credit_30";
    await prisma.outlet.update({
      where: { id: o.id },
      data: {
        code: o.code ?? `OUT-${String(n).padStart(4, "0")}`,
        ownerName: o.ownerName ?? o.contactPerson,
        phone: o.phone ?? `09${String(170000000 + n * 7919).slice(0, 9)}`,
        paymentTerms: terms,
        visitDay: o.visitDay,
      },
    });
  }

  // ---- Products: brand, shelf life, units
  const products = await prisma.product.findMany({ orderBy: { sku: "asc" } });
  for (const [i, p] of products.entries()) {
    await prisma.product.update({
      where: { id: p.id },
      data: {
        brand: p.brand ?? BRAND_BY_CATEGORY[p.category] ?? "Company F&B",
        shelfLifeDays: p.shelfLifeDays ?? (p.hasExpiry ? SHELF_DAYS[p.category] ?? 365 : null),
        displayOrder: p.displayOrder ?? i + 1,
        sellingUnits: p.sellingUnits ?? "PC,CS",
        unitsPerPack: p.unitsPerPack > 1 ? p.unitsPerPack : p.uom === "CS" ? 24 : 12,
        minOrderQty: p.minOrderQty,
      },
    });
  }

  // ---- Users: employee codes, contacts, MFA enrolment for existing privileged users
  const users = await prisma.user.findMany({ orderBy: { name: "asc" } });
  for (const [i, u] of users.entries()) {
    await prisma.user.update({
      where: { id: u.id },
      data: {
        employeeCode: u.employeeCode ?? `E-${1001 + i}`,
        phone: u.phone ?? `0917${String(1000000 + i * 3737).slice(0, 7)}`,
        email: u.email ?? `${u.name.toLowerCase().replace(/[^a-z]+/g, ".")}@companyfb.ph`,
        mfaEnrolled: true,
      },
    });
  }

  // ---- Warehouses / vans
  const warehouses = await prisma.warehouse.findMany({ include: { branch: true }, orderBy: { name: "asc" } });
  for (const [i, w] of warehouses.entries()) {
    await prisma.warehouse.update({
      where: { id: w.id },
      data: { code: w.code ?? `WH-${(w.branch.code ?? w.branch.name.slice(0, 3)).toUpperCase().replace(/[^A-Z0-9]/g, "")}-${String(i + 1).padStart(2, "0")}`, address: w.address ?? w.branch.address },
    }).catch(() => undefined);
  }

  // ---- Approved hardware + registered devices
  if ((await prisma.approvedHardware.count()) === 0) {
    await prisma.approvedHardware.createMany({
      data: [
        { kind: "device", model: "Samsung Galaxy A15" },
        { kind: "device", model: "Samsung Galaxy A25" },
        { kind: "device", model: "Xiaomi Redmi Note 13" },
        { kind: "device", model: "Oppo A58" },
        { kind: "printer", model: "Zebra ZQ320 (Bluetooth)" },
        { kind: "printer", model: "Zebra iMZ220 (Bluetooth)" },
        { kind: "printer", model: "Bixolon SPP-R200III (Bluetooth)" },
      ],
    });
  }
  if ((await prisma.deviceRegistration.count()) === 0) {
    const reps = await prisma.user.findMany({ where: { role: { in: ["sales_rep", "supervisor"] } }, orderBy: { name: "asc" } });
    const models = ["Samsung Galaxy A15", "Samsung Galaxy A25", "Xiaomi Redmi Note 13", "Oppo A58"];
    const hours = (h: number) => new Date(Date.now() - h * 3600000);
    for (const [i, u] of reps.entries()) {
      const scenario = i % 6;
      await prisma.deviceRegistration.create({
        data: {
          userId: u.id,
          deviceModel: models[i % models.length],
          deviceId: `ANDR-${(7000 + i * 131).toString(16).toUpperCase()}`,
          printerModel: u.role === "sales_rep" ? "Zebra ZQ320 (Bluetooth)" : null,
          status: scenario === 4 ? "pending" : "approved",
          lastSyncAt: scenario === 5 ? null : scenario === 3 ? hours(52) : hours(1 + i),
          pendingItems: scenario === 1 ? 4 : 0,
          oldestPendingAt: scenario === 1 ? hours(2) : null,
          errorItems: scenario === 2 ? 2 : 0,
          lastError: scenario === 2 ? "Order SFA-4471 rejected: customer is blocked in the DMS" : null,
        },
      });
    }
  }

  // ---- Integration message log (with a few failures waiting in the error queue)
  if ((await prisma.integrationMessage.count()) === 0) {
    const ago = (h: number) => new Date(Date.now() - h * 3600000);
    const rows: { connector: string; direction: string; docType: string; reference: string; status: string; error?: string; createdAt: Date }[] = [];
    for (let i = 0; i < 6; i++) rows.push({ connector: "erp", direction: "inbound", docType: "purchase_order", reference: `PO-${(200 + i).toString().padStart(6, "0")}`, status: "ok", createdAt: ago(20 - i * 3) });
    for (let i = 0; i < 4; i++) rows.push({ connector: "erp", direction: "inbound", docType: "product_master", reference: `SKU-UPD-${i + 1}`, status: "ok", createdAt: ago(30 - i) });
    for (let i = 0; i < 5; i++) rows.push({ connector: "erp", direction: "outbound", docType: "financial_posting", reference: `INV-${(900 + i).toString().padStart(6, "0")}`, status: "ok", createdAt: ago(10 - i) });
    rows.push({ connector: "erp", direction: "outbound", docType: "financial_posting", reference: "INV-000931", status: "error", error: "ERP rejected the posting: customer account is closed in the ERP", createdAt: ago(5) });
    rows.push({ connector: "erp", direction: "inbound", docType: "purchase_order", reference: "PO-000214", status: "error", error: "Unknown SKU SKU-9999 — could not be matched to a product", createdAt: ago(7) });
    for (let i = 0; i < 5; i++) rows.push({ connector: "sfa", direction: "inbound", docType: "order", reference: `SFA-${(4460 + i)}`, status: "ok", createdAt: ago(4 + i) });
    rows.push({ connector: "sfa", direction: "inbound", docType: "order", reference: "SFA-4471", status: "error", error: "Rejected: customer is blocked in the DMS (held for supervisor review)", createdAt: ago(3) });
    for (let i = 0; i < 3; i++) rows.push({ connector: "trade_promotion", direction: "inbound", docType: "promotion_setup", reference: `PROMO-${i + 1}`, status: "ok", createdAt: ago(40 - i) });
    rows.push({ connector: "trade_promotion", direction: "outbound", docType: "claim_submission", reference: "CLM-0003", status: "ok", createdAt: ago(48) });
    for (let i = 0; i < 3; i++) rows.push({ connector: "merchandising", direction: "inbound", docType: "shop_stock", reference: `MERCH-${i + 1}`, status: "ok", createdAt: ago(12 + i) });
    rows.push({ connector: "merchandising", direction: "inbound", docType: "near_expiry", reference: "MERCH-NE-1", status: "error", error: "Unmatched outlet code OUT-9999 — held for correction", createdAt: ago(6) });
    await prisma.integrationMessage.createMany({ data: rows.map((r) => ({ ...r, error: r.error ?? null })) });
  }
  if ((await prisma.biExtract.count()) === 0) {
    const ds: [string, number][] = [["sales", 1840], ["inventory", 612], ["purchasing", 96], ["claims", 12], ["receivables", 1033], ["master_data", 55]];
    await prisma.biExtract.createMany({ data: ds.map(([dataset, rowCount], i) => ({ dataset, rowCount, consumer: "Company F and B BI environment", createdAt: new Date(Date.now() - (i + 1) * 3600000) })) });
  }


  // ---- Movement ledger: opening position for the stock that existed before the ledger
  if ((await prisma.stockMovement.count()) === 0) {
    const rows = await prisma.stockBalance.findMany({ include: { goodsReceiptLine: { include: { goodsReceipt: true } } } });
    const data: {
      locationType: string; warehouseId: string | null; vanId: string | null; productId: string; lotNumber: string; bucket: string;
      qty: number; balanceAfter: number; type: string; refType: string | null; refId: string | null; refNumber: string | null; userName: string; note: string; createdAt: Date;
    }[] = [];
    for (const r of rows) {
      const gr = r.goodsReceiptLine?.goodsReceipt;
      const base = {
        locationType: r.locationType, warehouseId: r.warehouseId, vanId: r.vanId, productId: r.productId, lotNumber: r.lotNumber,
        type: gr ? "receipt" : "opening", refType: gr ? "GoodsReceipt" : null, refId: gr?.id ?? null, refNumber: gr?.grNumber ?? null,
        userName: gr?.receivedBy ?? "System", note: gr ? "Posted receipt" : "Opening position", createdAt: gr?.receivedDate ?? r.updatedAt,
      };
      if (r.qtyGood + r.qtyReserved > 0) data.push({ ...base, bucket: "good", qty: r.qtyGood, balanceAfter: r.qtyGood });
      if (r.qtyDamaged > 0) data.push({ ...base, bucket: "damaged", qty: r.qtyDamaged, balanceAfter: r.qtyDamaged });
    }
    for (let i = 0; i < data.length; i += 500) await prisma.stockMovement.createMany({ data: data.slice(i, i + 500) });
  }


  // ---- Orders: source / type and allocations for stock already reserved before the allocation ledger
  const untyped = await prisma.salesOrder.count({ where: { source: "sfa", orderType: "pre_sales", validationResult: null } });
  if (untyped > 0 && (await prisma.orderAllocation.count()) === 0) {
    const orders = await prisma.salesOrder.findMany({ include: { lines: true, outlet: true } });
    for (const o of orders) {
      const backend = o.lines.some((l) => l.reservedLotNumber);
      await prisma.salesOrder.update({
        where: { id: o.id },
        data: {
          source: backend ? "backend" : "sfa",
          orderType: backend ? "pre_sales" : "van_sale",
          paymentTerms: o.outlet.paymentTerms,
          allocationStatus: backend ? (o.status === "confirmed" ? "fully_allocated" : "dispatched") : "not_allocated",
        },
      });
      if (!backend) continue;
      const wh = await prisma.warehouse.findFirst({ where: { branchId: o.branchId, type: "saleable" } });
      if (!wh) continue;
      for (const l of o.lines) {
        if (!l.reservedLotNumber) continue;
        await prisma.orderAllocation.create({
          data: { salesOrderLineId: l.id, warehouseId: wh.id, productId: l.productId, lotNumber: l.reservedLotNumber, qty: l.qtyDelivered ?? l.qty, status: o.status === "confirmed" ? "reserved" : "dispatched" },
        });
      }
    }
    // orders held for approval before the new statuses existed
    await prisma.salesOrder.updateMany({ where: { status: "draft", creditHoldReason: { not: null } }, data: { status: "on_hold" } });
  }
  // Invoices: branch series numbers, tax and delivery status for the existing documents
  const noSeq = await prisma.invoice.findMany({ where: { branchSeq: null }, include: { branch: true }, orderBy: { invoiceDate: "asc" } });
  if (noSeq.length) {
    const counters = new Map<string, number>();
    for (const inv of noSeq) {
      const n = (counters.get(inv.branchId) ?? 0) + 1;
      counters.set(inv.branchId, n);
      await prisma.invoice.update({ where: { id: inv.id }, data: { branchSeq: n, taxAmount: Math.round((inv.amount - inv.amount / 1.12) * 100) / 100 } });
    }
  }

  // ---- Notifications (demo)
  if ((await prisma.notification.count()) === 0) {
    await prisma.notification.createMany({
      data: [
        { role: "supervisor", title: "Approvals waiting", body: "Credit-limit and discount exceptions are waiting in the approval queue.", link: "/supervisor/approvals", kind: "approval" },
        { role: "branch_ops", title: "Near-expiry lots", body: "Several lots entered the Warning band today.", link: "/branch/near-expiry", kind: "alert" },
        { role: "admin", title: "Integration errors", body: "3 gateway messages are waiting in the error queue.", link: "/admin/integrations", kind: "alert" },
      ],
    });
  }

  // ---- Targets for scorecards (current month)
  if ((await prisma.target.count()) === 0) {
    const period = new Date().toISOString().slice(0, 7);
    const reps = await prisma.user.findMany({ where: { role: "sales_rep" } });
    for (const r of reps) {
      await prisma.target.createMany({
        data: [
          { userId: r.id, metric: "sales_value", period, targetValue: 450000 },
          { userId: r.id, metric: "visit_compliance", period, targetValue: 90 },
          { userId: r.id, metric: "productive_call_rate", period, targetValue: 65 },
          { userId: r.id, metric: "collection", period, targetValue: 300000 },
          { userId: r.id, metric: "new_customers", period, targetValue: 3 },
          { userId: r.id, metric: "task_completion", period, targetValue: 85 },
        ],
      });
    }
  }
  // ---- Promotions: ownership, new promotion types in different lifecycle states
  const admin = await prisma.user.findFirst({ where: { role: "admin" } });
  await prisma.promotion.updateMany({ where: { createdBy: null }, data: { createdBy: admin?.name ?? "Administrator", approvedBy: admin?.name ?? "Administrator" } });
  if ((await prisma.promotion.count({ where: { type: { in: ["bundle", "qty_slab", "value_based"] } } })) === 0) {
    const byName = async (n: string) => (await prisma.product.findFirst({ where: { name: { startsWith: n } } }))?.id;
    const crackers = await byName("Butter Crackers");
    const choco = await byName("Choco Sandwich");
    const soap = await byName("Antibacterial");
    const chips = await byName("Golden Crunch Chips");
    const start = new Date();
    start.setDate(start.getDate() - 10);
    const end = new Date();
    end.setDate(end.getDate() + 50);
    const base = { startDate: start, endDate: end, createdBy: admin?.name ?? "Administrator", approvedBy: admin?.name ?? "Administrator", eligibilityRule: "All outlets", discountValue: 0 };
    if (crackers && choco) {
      await prisma.promotion.create({ data: { ...base, name: "Snack Duo Bundle", code: "PR-BUN-01", type: "bundle", status: "active", config: JSON.stringify({ items: [{ productId: crackers, qty: 2 }, { productId: choco, qty: 2 }], bundlePrice: 950, maxBundles: 10 }), priority: 5, stacking: "none", budget: 150000 } });
    }
    if (soap) {
      await prisma.promotion.create({ data: { ...base, name: "Soap Volume Slabs", code: "PR-SLB-01", type: "qty_slab", status: "active", productId: soap, config: JSON.stringify({ slabs: [{ minQty: 5, discountPct: 3 }, { minQty: 10, discountPct: 6, freeQty: 1 }] }), maxDiscountCap: 1500, stacking: "with_fixed_discount" } });
    }
    await prisma.promotion.create({ data: { ...base, name: "Big Basket 2% Off", code: "PR-VAL-01", type: "value_based", status: "approved", minOrderValue: 30000, config: JSON.stringify({ valueOffPct: 2 }), maxDiscountCap: 2500, stacking: "with_promotions", daysOfWeek: "monday,tuesday,wednesday,thursday,friday" } });
    if (chips) {
      await prisma.promotion.create({ data: { ...base, name: "Chips Weekend Free Goods (draft)", type: "free_good", status: "draft", productId: chips, minQty: 6, freeQty: 1, approvedBy: null, config: JSON.stringify({ repeat: true }) } });
    }
  }

  // ---- Claims: bring the sample claims onto the new lifecycle and amounts
  await prisma.claim.updateMany({ where: { status: "reviewed" }, data: { status: "under_review" } });
  const claims = await prisma.claim.findMany({ where: { eligibleAmount: null } });
  for (const c of claims) {
    await prisma.claim.update({ where: { id: c.id }, data: { eligibleAmount: c.amount, documents: JSON.stringify(["Signed delivery receipts", "Promotion mechanics sheet"]), ...(c.status === "settled" ? { settlementReference: "CM-2026-0114" } : {}) } });
  }

  // ---- A pending customer change request to review
  if ((await prisma.customerChangeRequest.count()) === 0) {
    const rep = await prisma.user.findFirst({ where: { role: "sales_rep" }, orderBy: { name: "asc" } });
    const outlet = rep ? await prisma.outlet.findFirst({ where: { branchId: rep.branchId ?? undefined, status: "active" }, orderBy: { name: "asc" } }) : null;
    if (rep && outlet) {
      await prisma.customerChangeRequest.create({ data: { outletId: outlet.id, requestedBy: rep.name, field: "phone", currentValue: outlet.phone, proposedValue: "0917-555-0142", reason: "Owner got a new mobile number" } });
    }
  }

  // ---- Financial reference data (payment terms, banks, tax rates)
  if ((await prisma.referenceItem.count()) === 0) {
    const terms: [string, string, number][] = [["cash", "Cash on delivery", 0], ["credit_15", "Credit — 15 days", 15], ["credit_30", "Credit — 30 days", 30], ["credit_45", "Credit — 45 days", 45], ["credit_60", "Credit — 60 days (key accounts)", 60]];
    for (const [code, label, value] of terms) await prisma.referenceItem.create({ data: { kind: "payment_term", code, label, value } });
    for (const b of ["BDO Unibank", "BPI", "Metrobank", "Land Bank of the Philippines", "Security Bank", "PNB", "UnionBank", "China Bank"]) await prisma.referenceItem.create({ data: { kind: "bank", code: b.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40), label: b } });
    await prisma.referenceItem.create({ data: { kind: "tax_rate", code: "vat12", label: "Value-added tax", value: 12, isDefault: true } });
    await prisma.referenceItem.create({ data: { kind: "tax_rate", code: "vat0", label: "Zero-rated sales", value: 0 } });
  }

  // ---- Customer TINs (a few left blank so the e-invoice rejection path can be shown)
  const noTin = await prisma.outlet.findMany({ where: { tin: null, status: "active" }, orderBy: { code: "asc" } });
  for (let i = 0; i < noTin.length; i++) {
    if (i % 7 === 6) continue;
    const n = 100000000 + ((i + 1) * 7919317) % 899999999;
    await prisma.outlet.update({ where: { id: noTin[i].id }, data: { tin: `${String(n).slice(0, 3)}-${String(n).slice(3, 6)}-${String(n).slice(6, 9)}-000` } });
  }

  // ---- ERP reference on the purchase orders that already exist
  const poNoRef = await prisma.purchaseOrder.findMany({ where: { erpReference: null, source: "erp" } });
  for (const po of poNoRef) await prisma.purchaseOrder.update({ where: { id: po.id }, data: { erpReference: `ERP-${po.poNumber.replace("PO-", "")}` } });

  // ---- Key-account activities, logged by each branch's supervisor
  if ((await prisma.keyAccountActivity.count()) === 0) {
    const kam = await prisma.user.findMany({ where: { role: "supervisor" } });
    const kaChannel = await prisma.channel.findFirst({ where: { name: { contains: "Key" } } });
    for (const u of kam) {
      const accts = kaChannel ? await prisma.outlet.findMany({ where: { channelId: kaChannel.id, branchId: u.branchId ?? undefined, status: "active" }, take: 3 }) : [];
      for (let i = 0; i < accts.length; i++) {
        const when = new Date();
        when.setDate(when.getDate() - (3 + i * 9));
        const due = new Date();
        due.setDate(due.getDate() + (i === 0 ? -2 : 6));
        await prisma.keyAccountActivity.create({ data: { outletId: accts[i].id, userId: u.id, type: ["business_review", "negotiation", "promo_check"][i % 3], summary: ["Quarterly business review — volumes and delivery performance", "Negotiated the festive-season price list and payment terms", "Checked chiller and end-cap execution for the running promotion"][i % 3], outcome: ["Agreed to review the delivery window", "Pending buyer sign-off", "Display compliant"][i % 3], nextAction: ["Send the revised delivery schedule", "Follow up the signed price list", "Photograph the end-cap after restock"][i % 3], nextDue: due, createdAt: when } });
      }
    }
  }

  // ---- Head-office view: approvals carry their branch, central-warehouse returns, more customer returns, a write-off for head office
  const noBranch = await prisma.approvalRequest.findMany({ where: { branchId: null } });
  if (noBranch.length) {
    const people = await prisma.user.findMany({ select: { name: true, branchId: true } });
    for (const a of noBranch) {
      const so = a.salesOrderId ? await prisma.salesOrder.findUnique({ where: { id: a.salesOrderId }, select: { branchId: true } }) : null;
      const bId = so?.branchId ?? people.find((u) => u.name === a.requestedBy)?.branchId ?? null;
      if (bId) await prisma.approvalRequest.update({ where: { id: a.id }, data: { branchId: bId } });
    }
  }
  const claimsNoBranch = await prisma.claim.findMany({ where: { branchId: null }, include: { submittedBy: true } });
  for (const c of claimsNoBranch) if (c.submittedBy.branchId) await prisma.claim.update({ where: { id: c.id }, data: { branchId: c.submittedBy.branchId } });

  if ((await prisma.supplierReturn.count()) === 0) {
    const whs = await prisma.warehouse.findMany({ orderBy: { name: "asc" } });
    const plan: [number, string, number, string][] = [
      [0, "expired", 48, "shipped"], [0, "damaged", 24, "pending"],
      [1, "expired", 60, "received"], [1, "damaged", 12, "posted_to_erp"],
      [2, "expired", 36, "approved"], [2, "recalled", 20, "shipped"],
    ];
    let seq = 1;
    for (const [wi, reason, qty, status] of plan) {
      const wh = whs[wi];
      if (!wh) continue;
      const lots = await prisma.stockBalance.findMany({ where: { warehouseId: wh.id, locationType: "warehouse" }, orderBy: { expiryDate: "asc" }, take: 6 });
      const lot = lots[seq % Math.max(1, lots.length)];
      if (!lot) continue;
      const ops = await prisma.user.findFirst({ where: { role: "branch_ops", branchId: wh.branchId } });
      const sent = new Date();
      sent.setDate(sent.getDate() - (2 + seq));
      const shipped = ["shipped", "received", "posted_to_erp"].includes(status);
      const received = status === "received" || status === "posted_to_erp";
      await prisma.supplierReturn.create({
        data: {
          returnNumber: `RTN-${String(seq).padStart(4, "0")}`, warehouseId: wh.id, productId: lot.productId, lotNumber: lot.lotNumber, qty, reason, status,
          requestedBy: ops?.name ?? "Branch Ops", approvedBy: status === "pending" ? null : "Branch manager", expiryDate: lot.expiryDate, createdAt: sent,
          dispatchedAt: shipped ? sent : null,
          qtyReceived: received ? (status === "received" ? qty - 6 : qty) : null, receivedBy: received ? "Central warehouse" : null, receivedAt: received ? new Date() : null,
          discrepancyNote: status === "received" ? `Received ${qty - 6} of ${qty} — 6 units crushed in transit` : null,
          erpReference: status === "posted_to_erp" ? `ERP-RTN-${String(seq).padStart(4, "0")}` : null, postedToErpAt: status === "posted_to_erp" ? new Date() : null,
        },
      });
      seq++;
    }
  }

  if ((await prisma.marketReturn.count()) < 5) {
    const brs = await prisma.branch.findMany({ orderBy: { name: "asc" } });
    const prods = await prisma.product.findMany({ where: { status: "active" }, orderBy: { sku: "asc" }, take: 8 });
    const extra: [number, number, number, string, boolean][] = [[0, 1, 10, "Expired on the shelf — beyond the return window", true], [2, 2, 8, "Damaged cartons at delivery", false], [2, 3, 5, "Wrong item delivered", false]];
    for (const [bi, pi, qty, reason, outside] of extra) {
      const outlet = await prisma.outlet.findFirst({ where: { branchId: brs[bi]?.id, status: "active" }, orderBy: { code: "desc" } });
      const rep = await prisma.user.findFirst({ where: { role: "sales_rep", branchId: brs[bi]?.id } });
      if (!outlet || !prods[pi]) continue;
      await prisma.marketReturn.create({ data: { outletId: outlet.id, productId: prods[pi].id, qty, reason, outsidePolicy: outside, photoPlaceholder: true, status: "pending", capturedBy: rep?.name ?? "Rep", createdAt: new Date(Date.now() - (pi + 1) * 86400000) } });
    }
  }

  if ((await prisma.financialDocument.count()) === 0) {
    const b = await prisma.branch.findFirst({ orderBy: { name: "desc" } });
    const od = b ? await prisma.invoice.findFirst({ where: { branchId: b.id, status: { in: ["unpaid", "partially_paid", "overdue"] }, dueDate: { lt: new Date() } }, include: { outlet: true }, orderBy: { dueDate: "asc" } }) : null;
    const sup = b ? await prisma.user.findFirst({ where: { role: "supervisor", branchId: b.id } }) : null;
    if (b && od && sup) {
      const doc = await prisma.financialDocument.create({ data: { docNumber: "WO-00001", type: "write_off", outletId: od.outletId, invoiceId: od.id, amount: 3500, reason: "Customer closed the store — balance uncollectible", requestedBy: sup.name } });
      await prisma.approvalRequest.create({ data: { type: "fin_doc", refId: doc.id, outletId: od.outletId, branchId: b.id, requestedBy: sup.name, amount: 3500, reason: `WO-00001 — write off for ${od.outlet.name}: customer closed the store · needs head office finance approval` } });
    }
  }

  await seedDemo(prisma);

  console.log("v2.0 extras seeded.");
}

// Allow `tsx prisma/seed-extra.ts` to run on its own.
if (process.argv[1] && /seed-extra\.(ts|js)$/.test(process.argv[1])) {
  const prisma = new PrismaClient();
  seedExtras(prisma)
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
