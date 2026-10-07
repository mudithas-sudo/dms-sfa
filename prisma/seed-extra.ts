import { PrismaClient } from "@prisma/client";

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
