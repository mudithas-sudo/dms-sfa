import { prisma } from "@/lib/prisma";
import { csvToObjects } from "@/lib/csv";
import { paymentTermOptions } from "@/lib/reference";

// Bulk import for migration: every row is validated on its own, nothing is saved until the user confirms, and the
// batch keeps a line-by-line record so what was loaded can be reconciled against the source file.

export type Dataset = "customers" | "products" | "prices";

export const DATASETS: Record<Dataset, { label: string; columns: string[]; required: string[]; sample: string[][]; help: string }> = {
  customers: {
    label: "Customers (outlets)",
    columns: ["name", "branch", "channel", "sub_channel", "address", "lat", "lng", "owner", "phone", "payment_terms", "credit_limit", "visit_day", "tin"],
    required: ["name", "branch", "channel", "sub_channel", "address"],
    sample: [["Mabuhay Sari-sari Store", "Cebu Branch", "General Trade", "Sari-Sari Store", "12 Colon St, Cebu City", "10.2958", "123.9021", "Aling Maria", "09171234567", "credit_15", "30000", "tuesday", "123-456-789-000"]],
    help: "Branch and channel are matched by name (or branch code). payment_terms uses a code from Financial Reference Data (cash, credit_15, credit_30…). Customers are loaded as active and approved — this is a migration of existing customers.",
  },
  products: {
    label: "Products (SKUs)",
    columns: ["sku", "name", "uom", "category", "brand", "unit_price", "units_per_pack", "min_order_qty", "has_expiry"],
    required: ["sku", "name", "uom", "category", "unit_price"],
    sample: [["SNK-1010", "Crispy Corn Snack 70g", "PC", "Snacks", "Golden Crunch", "38.50", "24", "1", "yes"]],
    help: "A SKU that already exists is rejected as a duplicate — the ERP owns the SKU master, so the import never overwrites it.",
  },
  prices: {
    label: "Base price list",
    columns: ["sku", "price", "start_date", "end_date", "branch"],
    required: ["sku", "price", "start_date"],
    sample: [["SNK-1010", "41.00", "2026-11-01", "", ""]],
    help: "Creates an effective-dated base price per SKU (all branches, or one branch when the branch column is filled). Dates are YYYY-MM-DD.",
  },
};

export interface RowResult {
  line: number; // line in the file (header = 1)
  key: string;
  outcome: "valid" | "rejected" | "duplicate";
  message: string;
  data?: Record<string, string>;
}

const num = (s: string) => (s === "" ? NaN : Number(s));

export async function validateFile(dataset: Dataset, text: string): Promise<{ results: RowResult[]; missingColumns: string[] }> {
  const spec = DATASETS[dataset];
  const { headers, rows } = csvToObjects(text);
  const missingColumns = spec.required.filter((c) => !headers.includes(c));
  if (missingColumns.length) return { results: [], missingColumns };
  const results: RowResult[] = [];

  if (dataset === "customers") {
    const [branches, channels, outlets, terms] = await Promise.all([
      prisma.branch.findMany(),
      prisma.channel.findMany({ include: { subChannels: true } }),
      prisma.outlet.findMany({ select: { name: true, address: true, lat: true, lng: true } }),
      paymentTermOptions(),
    ]);
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      const line = i + 2;
      const key = r.name || `row ${line}`;
      const fail = (message: string): RowResult => ({ line, key, outcome: "rejected", message });
      const missing = spec.required.filter((c) => !r[c]);
      if (missing.length) return results.push(fail(`Missing ${missing.join(", ")}`));
      const branch = branches.find((b) => b.name.toLowerCase() === r.branch.toLowerCase() || (b.code ?? "").toLowerCase() === r.branch.toLowerCase());
      if (!branch) return results.push(fail(`Unknown branch "${r.branch}"`));
      if (branch.status !== "active") return results.push(fail(`Branch "${branch.name}" is inactive`));
      const channel = channels.find((c) => c.name.toLowerCase() === r.channel.toLowerCase());
      if (!channel) return results.push(fail(`Unknown channel "${r.channel}"`));
      if (!channel.subChannels.some((s) => s.name.toLowerCase() === r.sub_channel.toLowerCase())) return results.push(fail(`Sub-channel "${r.sub_channel}" does not exist under ${channel.name}`));
      if (r.payment_terms && !terms.some((t) => t.id === r.payment_terms)) return results.push(fail(`Unknown payment terms "${r.payment_terms}"`));
      if (r.credit_limit && !(num(r.credit_limit) >= 0)) return results.push(fail("Credit limit must be a number"));
      if (r.lat && !(Math.abs(num(r.lat)) <= 90)) return results.push(fail("Latitude must be between -90 and 90"));
      if (r.lng && !(Math.abs(num(r.lng)) <= 180)) return results.push(fail("Longitude must be between -180 and 180"));
      if (r.visit_day && !["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].includes(r.visit_day.toLowerCase())) return results.push(fail(`Unknown visit day "${r.visit_day}"`));
      const sig = `${r.name.toLowerCase()}|${r.address.toLowerCase()}`;
      const lat = num(r.lat);
      const lng = num(r.lng);
      const dup = seen.has(sig) || outlets.some((o) => (o.name.toLowerCase() === r.name.toLowerCase() && o.address.toLowerCase() === r.address.toLowerCase()) || (Number.isFinite(lat) && Number.isFinite(lng) && Math.hypot((o.lat - lat) * 111000, (o.lng - lng) * 111000) < 30));
      if (dup) return results.push({ line, key, outcome: "duplicate", message: seen.has(sig) ? "Repeated in this file" : "A customer with this name and address (or the same GPS spot) already exists" });
      seen.add(sig);
      results.push({ line, key, outcome: "valid", message: `Will be created in ${branch.name}`, data: r });
    });
  } else if (dataset === "products") {
    const existing = new Set((await prisma.product.findMany({ select: { sku: true } })).map((p) => p.sku.toLowerCase()));
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      const line = i + 2;
      const key = r.sku || `row ${line}`;
      const missing = spec.required.filter((c) => !r[c]);
      if (missing.length) return results.push({ line, key, outcome: "rejected", message: `Missing ${missing.join(", ")}` });
      if (!(num(r.unit_price) >= 0)) return results.push({ line, key, outcome: "rejected", message: "Unit price must be a number" });
      if (r.units_per_pack && !(Math.floor(num(r.units_per_pack)) >= 1)) return results.push({ line, key, outcome: "rejected", message: "Units per pack must be 1 or more" });
      if (r.min_order_qty && !(Math.floor(num(r.min_order_qty)) >= 1)) return results.push({ line, key, outcome: "rejected", message: "Minimum order quantity must be 1 or more" });
      const k = r.sku.toLowerCase();
      if (existing.has(k) || seen.has(k)) return results.push({ line, key, outcome: "duplicate", message: seen.has(k) ? "SKU repeated in this file" : "SKU already exists — the ERP owns the SKU master" });
      seen.add(k);
      results.push({ line, key, outcome: "valid", message: "Will be created", data: r });
    });
  } else {
    const [products, branches] = await Promise.all([prisma.product.findMany({ select: { sku: true } }), prisma.branch.findMany()]);
    const skus = new Set(products.map((p) => p.sku.toLowerCase()));
    rows.forEach((r, i) => {
      const line = i + 2;
      const key = r.sku || `row ${line}`;
      const fail = (message: string): RowResult => ({ line, key, outcome: "rejected", message });
      const missing = spec.required.filter((c) => !r[c]);
      if (missing.length) return results.push(fail(`Missing ${missing.join(", ")}`));
      if (!skus.has(r.sku.toLowerCase())) return results.push(fail(`Unknown SKU "${r.sku}"`));
      if (!(num(r.price) > 0)) return results.push(fail("Price must be above zero"));
      const sd = new Date(r.start_date);
      if (Number.isNaN(sd.getTime())) return results.push(fail("Start date must be YYYY-MM-DD"));
      if (r.end_date) {
        const ed = new Date(r.end_date);
        if (Number.isNaN(ed.getTime())) return results.push(fail("End date must be YYYY-MM-DD"));
        if (ed < sd) return results.push(fail("End date is before the start date"));
      }
      if (r.branch && !branches.some((b) => b.name.toLowerCase() === r.branch.toLowerCase() || (b.code ?? "").toLowerCase() === r.branch.toLowerCase())) return results.push(fail(`Unknown branch "${r.branch}"`));
      results.push({ line, key, outcome: "valid", message: `Base price ₱${num(r.price).toLocaleString()} from ${r.start_date}`, data: r });
    });
  }
  return { results, missingColumns: [] };
}

async function nextOutletCodes(n: number) {
  const last = await prisma.outlet.findFirst({ where: { code: { startsWith: "OUT-" } }, orderBy: { code: "desc" }, select: { code: true } });
  const start = last?.code ? Number(last.code.replace("OUT-", "")) : 0;
  return Array.from({ length: n }, (_, i) => `OUT-${String(start + i + 1).padStart(4, "0")}`);
}

export async function applyRows(dataset: Dataset, valid: RowResult[], by: string): Promise<{ imported: number; failed: { line: number; message: string }[] }> {
  let imported = 0;
  const failed: { line: number; message: string }[] = [];
  if (dataset === "customers") {
    const [branches, channels] = await Promise.all([prisma.branch.findMany(), prisma.channel.findMany()]);
    const codes = await nextOutletCodes(valid.length);
    for (let i = 0; i < valid.length; i++) {
      const r = valid[i].data!;
      try {
        const branch = branches.find((b) => b.name.toLowerCase() === r.branch.toLowerCase() || (b.code ?? "").toLowerCase() === r.branch.toLowerCase())!;
        const channel = channels.find((c) => c.name.toLowerCase() === r.channel.toLowerCase())!;
        await prisma.outlet.create({
          data: {
            name: r.name, code: codes[i], branchId: branch.id, channelId: channel.id, subChannel: r.sub_channel, address: r.address,
            lat: Number(r.lat) || 0, lng: Number(r.lng) || 0, ownerName: r.owner || null, phone: r.phone || null, paymentTerms: r.payment_terms || "credit_30",
            creditLimit: Number(r.credit_limit) || 0, visitDay: r.visit_day ? r.visit_day.toLowerCase() : null, tin: r.tin || null,
            status: "active", onboardingStatus: "approved", remarks: `Imported (${by})`,
          },
        });
        imported++;
      } catch (e) {
        failed.push({ line: valid[i].line, message: e instanceof Error ? e.message.slice(0, 120) : "Could not save" });
      }
    }
  } else if (dataset === "products") {
    for (const v of valid) {
      const r = v.data!;
      try {
        await prisma.product.create({ data: { sku: r.sku, name: r.name, uom: r.uom, category: r.category, brand: r.brand || null, unitPrice: Number(r.unit_price), unitsPerPack: Math.max(1, Math.floor(Number(r.units_per_pack) || 1)), minOrderQty: Math.max(1, Math.floor(Number(r.min_order_qty) || 1)), hasExpiry: !/^(no|n|false|0)$/i.test(r.has_expiry || "yes"), status: "active" } });
        imported++;
      } catch (e) {
        failed.push({ line: v.line, message: e instanceof Error ? e.message.slice(0, 120) : "Could not save" });
      }
    }
  } else {
    const [products, branches] = await Promise.all([prisma.product.findMany({ select: { id: true, sku: true } }), prisma.branch.findMany()]);
    for (const v of valid) {
      const r = v.data!;
      try {
        const product = products.find((p) => p.sku.toLowerCase() === r.sku.toLowerCase())!;
        const branch = r.branch ? branches.find((b) => b.name.toLowerCase() === r.branch.toLowerCase() || (b.code ?? "").toLowerCase() === r.branch.toLowerCase()) : null;
        await prisma.pricingRule.create({ data: { name: `Imported base price ${product.sku}`, level: "base", productId: product.id, branchId: branch?.id ?? null, priceType: "fixed_price", value: Number(r.price), startDate: new Date(r.start_date), endDate: r.end_date ? new Date(r.end_date) : null, remarks: `Imported (${by})` } });
        imported++;
      } catch (e) {
        failed.push({ line: v.line, message: e instanceof Error ? e.message.slice(0, 120) : "Could not save" });
      }
    }
  }
  return { imported, failed };
}

// After an import: does each loaded row now exist in the system? (the reconciliation check)
export async function reconcile(dataset: Dataset, rows: RowResult[]) {
  const keys = rows.filter((r) => r.outcome === "valid").map((r) => r.key);
  let present = 0;
  if (dataset === "customers") {
    const found = await prisma.outlet.findMany({ where: { name: { in: keys } }, select: { name: true } });
    present = new Set(found.map((f) => f.name)).size;
  } else if (dataset === "products") {
    present = await prisma.product.count({ where: { sku: { in: keys } } });
  } else {
    const found = await prisma.pricingRule.findMany({ where: { name: { in: keys.map((k) => `Imported base price ${k}`) } }, select: { name: true } });
    present = new Set(found.map((f) => f.name)).size;
  }
  return { expected: new Set(keys).size, present };
}
