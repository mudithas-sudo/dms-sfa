"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { assertCan } from "@/lib/rbac";

// Redirect back to a screen with a message the page shows in a banner.
function fail(path: string, message: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}error=${encodeURIComponent(message)}`);
}

function ok(path: string, message: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}notice=${encodeURIComponent(message)}`);
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const strOrNull = (f: FormData, k: string) => str(f, k) || null;
const num = (f: FormData, k: string, d = 0) => {
  const n = Number(f.get(k));
  return Number.isFinite(n) && String(f.get(k) ?? "") !== "" ? n : d;
};

async function actorName(fallback = "Admin") {
  const { userId } = await getSession();
  return userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? fallback : fallback;
}

// ---------------------------------------------------------------------------
// Branch (distributor) management
// ---------------------------------------------------------------------------

// A branch with open work cannot be switched off: its history stays, only new activity is blocked.
async function branchOpenItems(branchId: string): Promise<string[]> {
  const [openOrders, openPos, vanStock] = await Promise.all([
    prisma.salesOrder.count({ where: { branchId, status: { in: ["draft", "confirmed"] } } }),
    prisma.purchaseOrder.count({ where: { branchId, status: { in: ["pending", "partially_received", "exception"] } } }),
    prisma.stockBalance.aggregate({
      where: { locationType: "van", van: { branchId } },
      _sum: { qtyGood: true, qtyDamaged: true },
    }),
  ]);
  const reasons: string[] = [];
  if (openOrders) reasons.push(`${openOrders} open order(s)`);
  if (openPos) reasons.push(`${openPos} purchase order(s) with pending receipts`);
  const vanUnits = (vanStock._sum.qtyGood ?? 0) + (vanStock._sum.qtyDamaged ?? 0);
  if (vanUnits > 0) reasons.push(`${vanUnits} unit(s) of stock held in vans`);
  return reasons;
}

export async function createBranch(formData: FormData) {
  await assertCan("master_data", "edit");
  const name = str(formData, "name");
  const code = strOrNull(formData, "code");
  const address = str(formData, "address");
  if (!name || !address) fail("/admin/branches/new", "Branch name and address are required.");
  if (code && (await prisma.branch.findUnique({ where: { code } }))) fail("/admin/branches/new", `Branch code ${code} is already used — codes are unique system-wide.`);

  const status = str(formData, "status") || "active";
  const branch = await prisma.branch.create({
    data: {
      name, code, address,
      contactPerson: strOrNull(formData, "contactPerson"),
      contactPhone: strOrNull(formData, "contactPhone"),
      contactEmail: strOrNull(formData, "contactEmail"),
      region: strOrNull(formData, "region"),
      status,
      activatedAt: status === "active" ? new Date() : null,
    },
  });
  await logAudit("Branch", branch.id, "create", `Created branch "${name}"`, { after: branch });
  revalidatePath("/admin/branches");
  redirect("/admin/branches");
}

export async function updateBranch(formData: FormData) {
  await assertCan("master_data", "edit");
  const id = str(formData, "id");
  const name = str(formData, "name");
  const code = strOrNull(formData, "code");
  const address = str(formData, "address");
  const status = str(formData, "status") || "active";
  const back = `/admin/branches/${id}`;
  const before = await prisma.branch.findUniqueOrThrow({ where: { id } });

  if (code && code !== before.code && (await prisma.branch.findUnique({ where: { code } }))) fail(back, `Branch code ${code} is already used.`);
  if (before.status === "active" && status === "inactive") {
    const open = await branchOpenItems(id);
    if (open.length) fail(back, `This branch cannot be deactivated while it has ${open.join(", ")}. Clear them first.`);
  }
  const after = await prisma.branch.update({
    where: { id },
    data: {
      name, code, address,
      contactPerson: strOrNull(formData, "contactPerson"),
      contactPhone: strOrNull(formData, "contactPhone"),
      contactEmail: strOrNull(formData, "contactEmail"),
      region: strOrNull(formData, "region"),
      status,
      activatedAt: before.status !== "active" && status === "active" ? new Date() : before.activatedAt,
      deactivatedAt: before.status === "active" && status === "inactive" ? new Date() : status === "active" ? null : before.deactivatedAt,
    },
  });
  await logAudit("Branch", id, status !== before.status ? (status === "active" ? "activate" : "deactivate") : "update", `Updated branch "${name}"`, { before, after });
  revalidatePath("/admin/branches");
  redirect("/admin/branches");
}

// ---------------------------------------------------------------------------
// Customer (outlet) master
// ---------------------------------------------------------------------------

async function nextOutletCode() {
  const last = await prisma.outlet.findFirst({ where: { code: { startsWith: "OUT-" } }, orderBy: { code: "desc" }, select: { code: true } });
  const n = last?.code ? Number(last.code.replace("OUT-", "")) : 0;
  return `OUT-${String(n + 1).padStart(4, "0")}`;
}

// Likely duplicates: same name at the same address, or another outlet within ~30 m.
export async function findDuplicateOutlets(name: string, address: string, lat: number, lng: number, excludeId?: string) {
  const all = await prisma.outlet.findMany({
    where: excludeId ? { id: { not: excludeId } } : {},
    select: { id: true, name: true, address: true, lat: true, lng: true, code: true, status: true },
  });
  const n = name.toLowerCase();
  const a = address.toLowerCase();
  return all.filter((o) => {
    const sameName = o.name.toLowerCase() === n;
    const sameAddress = o.address.toLowerCase() === a;
    const metersApart = Math.hypot((o.lat - lat) * 111000, (o.lng - lng) * 111000 * Math.cos((lat * Math.PI) / 180));
    return (sameName && sameAddress) || (sameName && metersApart < 100) || metersApart < 30;
  });
}

export async function createOutlet(formData: FormData) {
  await assertCan("master_data", "edit");
  const { userId } = await getSession();
  const name = str(formData, "name");
  const branchId = str(formData, "branchId");
  const channelId = str(formData, "channelId");
  const subChannel = str(formData, "subChannel");
  const address = str(formData, "address");
  const lat = num(formData, "lat", 14.5995);
  const lng = num(formData, "lng", 120.9842);
  const params = new URLSearchParams();
  for (const [k, v] of formData.entries()) if (typeof v === "string" && !k.startsWith("$") && k !== "confirmDuplicate") params.set(k, v);

  // Mandatory before an outlet can be submitted.
  if (!name || !branchId || !channelId || !subChannel || !address || !str(formData, "routeId") || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    params.set("error", "Name, address, GPS location, channel, sub-channel, route and branch are mandatory.");
    redirect(`/admin/outlets/new?${params.toString()}`);
  }

  if (formData.get("confirmDuplicate") !== "1") {
    const dups = await findDuplicateOutlets(name, address, lat, lng);
    if (dups.length) {
      params.set("duplicates", dups.map((d) => d.id).join(","));
      redirect(`/admin/outlets/new?${params.toString()}`);
    }
  }

  const code = await nextOutletCode();
  const outlet = await prisma.outlet.create({
    data: {
      name, code, branchId, channelId, subChannel, address, lat, lng,
      routeId: strOrNull(formData, "routeId"),
      contactPerson: strOrNull(formData, "contactPerson"),
      ownerName: strOrNull(formData, "ownerName"),
      phone: strOrNull(formData, "phone"),
      landline: strOrNull(formData, "landline"),
      email: strOrNull(formData, "email"),
      visitDay: strOrNull(formData, "visitDay"),
      paymentTerms: str(formData, "paymentTerms") || "credit_30",
      creditLimit: num(formData, "creditLimit", 0),
      businessRegRef: strOrNull(formData, "businessRegRef"),
      remarks: strOrNull(formData, "remarks"),
      // New outlets are validated and approved before they can be sold to.
      status: "inactive",
      onboardingStatus: "pending",
      createdById: userId,
    },
  });
  await logAudit("Outlet", outlet.id, "create", `Created outlet "${name}" (${code}) — pending approval`, { after: outlet });
  await notify({ role: "supervisor", branchId, title: "New outlet awaiting approval", body: `${name} (${code}) was created and needs approval.`, link: "/supervisor/onboarding", kind: "approval" });
  revalidatePath("/admin/outlets");
  ok("/admin/outlets", `${name} (${code}) was saved as Pending Approval. It becomes sellable once an approver other than the creator approves it.`);
}

export async function updateOutlet(formData: FormData) {
  await assertCan("master_data", "edit");
  const id = str(formData, "id");
  const back = `/admin/outlets/${id}`;
  const before = await prisma.outlet.findUniqueOrThrow({ where: { id } });
  const name = str(formData, "name");
  const branchId = str(formData, "branchId");
  const channelId = str(formData, "channelId");
  const subChannel = str(formData, "subChannel");
  const routeId = strOrNull(formData, "routeId");
  const address = str(formData, "address");
  const lat = num(formData, "lat", before.lat);
  const lng = num(formData, "lng", before.lng);
  if (!name || !address || !channelId || !subChannel || !branchId || !routeId) fail(back, "Name, address, channel, sub-channel, route and branch are mandatory.");

  const dups = formData.get("confirmDuplicate") === "1" ? [] : await findDuplicateOutlets(name, address, lat, lng, id);
  if (dups.length) fail(back, `Possible duplicate of ${dups.map((d) => `${d.name} (${d.code ?? d.id})`).join(", ")}. Tick "Save anyway" to continue.`);

  const status = str(formData, "status") || before.status;
  const reclassified = channelId !== before.channelId;
  const effectiveFrom = reclassified ? new Date(str(formData, "channelEffectiveFrom") || new Date().toISOString().slice(0, 10)) : before.channelEffectiveFrom;

  const after = await prisma.outlet.update({
    where: { id },
    data: {
      name, branchId, channelId, subChannel, routeId, address, lat, lng, status,
      contactPerson: strOrNull(formData, "contactPerson"),
      ownerName: strOrNull(formData, "ownerName"),
      phone: strOrNull(formData, "phone"),
      landline: strOrNull(formData, "landline"),
      email: strOrNull(formData, "email"),
      visitDay: strOrNull(formData, "visitDay"),
      paymentTerms: str(formData, "paymentTerms") || before.paymentTerms,
      creditLimit: num(formData, "creditLimit", before.creditLimit),
      creditStatus: str(formData, "creditStatus") || before.creditStatus,
      businessRegRef: strOrNull(formData, "businessRegRef"),
      remarks: strOrNull(formData, "remarks"),
      blockedReason: status === "blocked" ? strOrNull(formData, "blockedReason") ?? "Blocked by administrator" : null,
      previousChannelId: reclassified ? before.channelId : before.previousChannelId,
      channelEffectiveFrom: effectiveFrom,
    },
  });
  if (reclassified) {
    await logAudit("Outlet", id, "reclassify", `Reclassified "${name}" to a new channel, effective ${effectiveFrom?.toISOString().slice(0, 10)}`, { before: { channelId: before.channelId, subChannel: before.subChannel }, after: { channelId, subChannel } });
  }
  if (routeId !== before.routeId) {
    await logAudit("Outlet", id, "route_move", `Moved "${name}" between routes`, { before: { routeId: before.routeId }, after: { routeId } });
    // keep the beat plan consistent: an outlet belongs to one route at a time
    await prisma.routeStop.deleteMany({ where: { outletId: id } });
    if (routeId) {
      const count = await prisma.routeStop.count({ where: { routeId } });
      await prisma.routeStop.create({ data: { routeId, outletId: id, sequence: count + 1 } });
    }
  }
  await logAudit("Outlet", id, status !== before.status ? status : "update", `Updated outlet "${name}"`, { before, after });
  revalidatePath("/admin/outlets");
  redirect("/admin/outlets");
}

export async function setOutletBlocked(formData: FormData) {
  await assertCan("master_data", "edit");
  const id = str(formData, "id");
  const block = formData.get("block") === "1";
  const reason = str(formData, "reason");
  const before = await prisma.outlet.findUniqueOrThrow({ where: { id } });
  if (block && !reason) fail("/admin/outlets", "A reason is required to block an outlet.");
  const after = await prisma.outlet.update({
    where: { id },
    data: block
      ? { status: "blocked", blockedReason: reason, creditStatus: "blocked" }
      : { status: "active", blockedReason: null, creditStatus: "active" },
  });
  await logAudit("Outlet", id, block ? "block" : "release", `${block ? "Blocked" : "Released"} outlet "${before.name}"${block ? ` — ${reason}` : ""}`, { before: { status: before.status }, after: { status: after.status } });
  revalidatePath("/admin/outlets");
  redirect("/admin/outlets");
}

// ---------------------------------------------------------------------------
// Outlet onboarding (new customer -> pending -> approved / returned / rejected)
// ---------------------------------------------------------------------------

export async function decideOutletOnboarding(formData: FormData) {
  const outletId = str(formData, "outletId");
  const decision = str(formData, "decision"); // approved | rejected | returned
  const reason = str(formData, "reason");
  const back = str(formData, "back") || "/admin/outlets/onboarding";
  const { userId } = await getSession();
  const outlet = await prisma.outlet.findUniqueOrThrow({ where: { id: outletId } });
  if (outlet.onboardingStatus !== "pending") fail(back, "This outlet is no longer pending.");

  // Separation of duties: the person who created or registered the outlet cannot approve it.
  if (userId && outlet.createdById === userId) fail(back, "You created this outlet, so you cannot approve it. Another approver must review it.");
  if ((decision === "rejected" || decision === "returned") && !reason) fail(back, "A reason is required to reject or return an outlet.");

  const data: Record<string, unknown> = {
    onboardingStatus: decision,
    onboardingReason: decision === "approved" ? null : reason,
    approvedById: userId,
  };
  if (decision === "approved") {
    // The reviewer — not the rep — assigns channel, route, price terms and credit terms.
    data.status = "active";
    const channelId = str(formData, "channelId");
    if (channelId) data.channelId = channelId;
    if (str(formData, "subChannel")) data.subChannel = str(formData, "subChannel");
    if (str(formData, "routeId")) data.routeId = str(formData, "routeId");
    if (str(formData, "paymentTerms")) data.paymentTerms = str(formData, "paymentTerms");
    if (str(formData, "creditLimit")) data.creditLimit = num(formData, "creditLimit");
    if (str(formData, "visitDay")) data.visitDay = str(formData, "visitDay");
    if (!outlet.code) data.code = await nextOutletCode();
  } else {
    data.status = "inactive";
  }
  await prisma.outlet.update({ where: { id: outletId }, data });

  if (decision === "approved" && (data.routeId || outlet.routeId)) {
    const routeId = (data.routeId as string) ?? outlet.routeId!;
    const hasStop = await prisma.routeStop.count({ where: { outletId, routeId } });
    if (!hasStop) {
      await prisma.routeStop.create({ data: { routeId, outletId, sequence: (await prisma.routeStop.count({ where: { routeId } })) + 1 } });
    }
  }
  const verb = decision === "approved" ? "Approved" : decision === "returned" ? "Returned for correction" : "Rejected";
  await logAudit("Outlet", outletId, decision === "approved" ? "approve" : decision === "returned" ? "return" : "reject", `${verb} onboarding for "${outlet.name}"${reason ? ` — ${reason}` : ""}`, {
    before: { onboardingStatus: outlet.onboardingStatus },
    after: { onboardingStatus: decision, reason: reason || undefined },
  });
  if (outlet.createdById) {
    await notify({ userId: outlet.createdById, title: `Outlet ${verb.toLowerCase()}`, body: `${outlet.name}: ${verb.toLowerCase()}${reason ? ` — ${reason}` : ""}`, link: "/sfa/customers/new", kind: "info" });
  }
  revalidatePath("/admin/outlets/onboarding");
  revalidatePath("/supervisor/onboarding");
  redirect(back);
}

// ---------------------------------------------------------------------------
// Product / SKU master (core definition owned by the ERP)
// ---------------------------------------------------------------------------

async function logErpMessage(docType: string, reference: string) {
  await prisma.integrationMessage.create({
    data: { connector: "erp", direction: "inbound", docType, reference, status: "ok", payload: JSON.stringify({ received: new Date().toISOString() }) },
  });
}

// In the live system products arrive from the ERP; this form simulates one message of that feed.
export async function createProduct(formData: FormData) {
  await assertCan("master_data", "edit");
  const sku = str(formData, "sku");
  const name = str(formData, "name");
  if (!sku || !name) fail("/admin/products/new", "SKU and name are required.");
  if (await prisma.product.findUnique({ where: { sku } })) fail("/admin/products/new", `SKU ${sku} already exists. The ERP is the source of SKU codes — the DMS does not create competing ones.`);

  const product = await prisma.product.create({
    data: {
      sku, name,
      uom: str(formData, "uom") || "PC",
      packSize: strOrNull(formData, "packSize"),
      category: str(formData, "category") || "General",
      brand: strOrNull(formData, "brand"),
      hasExpiry: formData.get("hasExpiry") === "on",
      unitPrice: num(formData, "unitPrice"),
      unitsPerPack: Math.max(1, num(formData, "unitsPerPack", 1)),
      sellingUnits: strOrNull(formData, "sellingUnits"),
      minOrderQty: Math.max(1, num(formData, "minOrderQty", 1)),
      shelfLifeDays: formData.get("shelfLifeDays") ? num(formData, "shelfLifeDays") : null,
      shortName: strOrNull(formData, "shortName"),
      displayOrder: formData.get("displayOrder") ? num(formData, "displayOrder") : null,
    },
  });
  await logErpMessage("product_master", sku);
  await logAudit("Product", product.id, "create", `Received product "${name}" (${sku}) from the ERP`, { after: product });
  revalidatePath("/admin/products");
  redirect("/admin/products");
}

export async function updateProduct(formData: FormData) {
  await assertCan("master_data", "edit");
  const id = str(formData, "id");
  const back = `/admin/products/${id}`;
  const before = await prisma.product.findUniqueOrThrow({ where: { id } });

  // ERP-owned fields (code, name, category, brand, UoM, pack) are read-only here; only local details change.
  const hasExpiry = formData.get("hasExpiry") === "on";
  if (before.hasExpiry && !hasExpiry) {
    const tracked = await prisma.stockBalance.aggregate({ where: { productId: id }, _sum: { qtyGood: true, qtyDamaged: true, qtyQuarantine: true } });
    const units = (tracked._sum.qtyGood ?? 0) + (tracked._sum.qtyDamaged ?? 0) + (tracked._sum.qtyQuarantine ?? 0);
    if (units > 0) fail(back, `Lot / expiry tracking cannot be switched off while ${units} tracked unit(s) are on hand.`);
  }
  const status = str(formData, "status") || before.status;
  const after = await prisma.product.update({
    where: { id },
    data: {
      shortName: strOrNull(formData, "shortName"),
      displayOrder: formData.get("displayOrder") ? num(formData, "displayOrder") : null,
      minOrderQty: Math.max(1, num(formData, "minOrderQty", before.minOrderQty)),
      shelfLifeDays: formData.get("shelfLifeDays") ? num(formData, "shelfLifeDays") : null,
      sellingUnits: strOrNull(formData, "sellingUnits"),
      unitsPerPack: Math.max(1, num(formData, "unitsPerPack", before.unitsPerPack)),
      hasExpiry,
      unitPrice: num(formData, "unitPrice", before.unitPrice),
      status,
    },
  });
  await logAudit("Product", id, status !== before.status ? status : "update", `Updated local details of product "${before.name}"`, { before, after });
  revalidatePath("/admin/products");
  redirect("/admin/products");
}

// ---------------------------------------------------------------------------
// Pricing engine rules (channel / customer / SKU / base price) — effective-dated
// ---------------------------------------------------------------------------

export async function createPricingRule(formData: FormData) {
  await assertCan("master_data", "edit");
  const name = str(formData, "name");
  const level = str(formData, "level") || "channel";
  const channelId = strOrNull(formData, "channelId");
  const outletId = strOrNull(formData, "outletId");
  const productId = strOrNull(formData, "productId");
  const scopeCategory = strOrNull(formData, "scopeCategory");
  const startDate = new Date(str(formData, "startDate"));
  const endDateRaw = str(formData, "endDate");
  const needs =
    (level === "channel" && !channelId) ||
    (level === "customer" && !outletId) ||
    ((level === "sku" || level === "base") && !productId && !scopeCategory) ||
    (level === "base" && !productId);
  if (!name || needs || Number.isNaN(startDate.getTime())) {
    fail("/admin/pricing", "Complete the rule: a name, start date, and the channel / customer / SKU the level requires.");
  }
  if (endDateRaw && new Date(endDateRaw) < startDate) fail("/admin/pricing", "The end date cannot be before the start date.");

  const rule = await prisma.pricingRule.create({
    data: {
      name, level,
      channelId: level === "channel" ? channelId : null,
      outletId: level === "customer" ? outletId : null,
      productId, scopeCategory,
      branchId: strOrNull(formData, "branchId"),
      priceType: level === "base" ? "fixed_price" : str(formData, "priceType") || "discount_percent",
      value: num(formData, "value"),
      startDate,
      endDate: endDateRaw ? new Date(endDateRaw) : null,
      remarks: strOrNull(formData, "remarks"),
    },
  });
  await logAudit("PricingRule", rule.id, "create", `Created pricing rule "${name}"`, { after: rule });
  revalidatePath("/admin/pricing");
  ok("/admin/pricing", `Rule "${name}" saved${startDate > new Date() ? ` — it starts on ${startDate.toISOString().slice(0, 10)}; existing orders keep the price they were created with` : ""}.`);
}

export async function endPricingRule(formData: FormData) {
  await assertCan("master_data", "edit");
  const id = str(formData, "id");
  const before = await prisma.pricingRule.findUniqueOrThrow({ where: { id } });
  const after = await prisma.pricingRule.update({ where: { id }, data: { endDate: new Date(), status: "expired", approvalStatus: "ended" } });
  await logAudit("PricingRule", id, "end", `Ended pricing rule "${before.name}"`, { before, after });
  revalidatePath("/admin/pricing");
  revalidatePath("/admin/customer-discounts");
  redirect(str(formData, "back") || "/admin/pricing");
}

// Standing customer discount — approved before it applies, with scope and a kept history.
export async function createCustomerDiscount(formData: FormData) {
  await assertCan("master_data", "edit");
  const name = str(formData, "name");
  const outletId = strOrNull(formData, "outletId");
  const value = num(formData, "value");
  const startDate = new Date(str(formData, "startDate"));
  if (!name || !outletId || value <= 0 || Number.isNaN(startDate.getTime())) fail("/admin/customer-discounts", "Customer, a discount above 0% and a start date are required.");
  const endRaw = str(formData, "endDate");
  const requester = await actorName();
  const outlet = await prisma.outlet.findUniqueOrThrow({ where: { id: outletId } });

  const rule = await prisma.pricingRule.create({
    data: {
      name, level: "customer", kind: "fixed_discount", outletId,
      productId: strOrNull(formData, "productId"),
      scopeCategory: strOrNull(formData, "scopeCategory"),
      priceType: "discount_percent", value, startDate,
      endDate: endRaw ? new Date(endRaw) : null,
      remarks: strOrNull(formData, "remarks"),
      approvalStatus: "pending_approval",
    },
  });
  await prisma.approvalRequest.create({
    data: {
      type: "fixed_discount", refId: rule.id, requestedBy: requester, amount: value,
      reason: `Standing ${value}% discount for ${outlet.name} from ${startDate.toISOString().slice(0, 10)}${str(formData, "remarks") ? ` — ${str(formData, "remarks")}` : ""}`,
      branchId: outlet.branchId, outletId,
    },
  });
  await logAudit("PricingRule", rule.id, "create", `Requested standing customer discount "${name}" — pending approval`, { after: rule });
  await notify({ role: "supervisor", branchId: outlet.branchId, title: "Fixed discount awaiting approval", body: `${outlet.name}: ${value}% standing discount`, link: "/supervisor/approvals", kind: "approval" });
  revalidatePath("/admin/customer-discounts");
  ok("/admin/customer-discounts", "The discount was submitted for approval. It applies to orders only once approved.");
}

// ---------------------------------------------------------------------------
// Channel & sub-channel master
// ---------------------------------------------------------------------------

export async function createChannel(formData: FormData) {
  await assertCan("master_data", "edit");
  const name = str(formData, "name");
  const code = strOrNull(formData, "code");
  if (!name) fail("/admin/channels", "A channel name is required.");
  if (await prisma.channel.findUnique({ where: { name } })) fail("/admin/channels", `Channel "${name}" already exists.`);
  if (code && (await prisma.channel.findUnique({ where: { code } }))) fail("/admin/channels", `Channel code ${code} is already used.`);

  const channel = await prisma.channel.create({ data: { name, code } });
  await logAudit("Channel", channel.id, "create", `Added channel "${name}"`, { after: channel });
  revalidatePath("/admin/channels");
  redirect("/admin/channels");
}

export async function createSubChannel(formData: FormData) {
  await assertCan("master_data", "edit");
  const name = str(formData, "name");
  const channelId = str(formData, "channelId");
  if (!name || !channelId) fail("/admin/channels", "A sub-channel name is required.");
  const dupe = await prisma.subChannel.findFirst({ where: { channelId, name: { equals: name, mode: "insensitive" } } });
  if (dupe) fail("/admin/channels", `Sub-channel "${name}" already exists under that channel.`);

  const subChannel = await prisma.subChannel.create({ data: { name, channelId, code: strOrNull(formData, "code") } });
  await logAudit("SubChannel", subChannel.id, "create", `Added sub-channel "${name}"`, { after: subChannel });
  revalidatePath("/admin/channels");
  redirect("/admin/channels");
}

// A channel / sub-channel in use can be made inactive but never deleted; inactive entries cannot be assigned to new outlets.
export async function setChannelStatus(formData: FormData) {
  await assertCan("master_data", "edit");
  const kind = str(formData, "kind"); // channel | subChannel
  const id = str(formData, "id");
  const status = str(formData, "status");
  if (kind === "channel") {
    const before = await prisma.channel.findUniqueOrThrow({ where: { id } });
    await prisma.channel.update({ where: { id }, data: { status } });
    await logAudit("Channel", id, status === "inactive" ? "deactivate" : "activate", `${status === "inactive" ? "Deactivated" : "Activated"} channel "${before.name}"`, { before: { status: before.status }, after: { status } });
  } else {
    const before = await prisma.subChannel.findUniqueOrThrow({ where: { id } });
    await prisma.subChannel.update({ where: { id }, data: { status } });
    await logAudit("SubChannel", id, status === "inactive" ? "deactivate" : "activate", `${status === "inactive" ? "Deactivated" : "Activated"} sub-channel "${before.name}"`, { before: { status: before.status }, after: { status } });
  }
  revalidatePath("/admin/channels");
  redirect("/admin/channels");
}

// ---------------------------------------------------------------------------
// Territory & route master (beat plan builder)
// ---------------------------------------------------------------------------

export async function createTerritory(formData: FormData) {
  await assertCan("master_data", "edit");
  const name = str(formData, "name");
  const code = strOrNull(formData, "code");
  if (!name) fail("/admin/territories", "A territory name is required.");
  if (code && (await prisma.territory.findUnique({ where: { code } }))) fail("/admin/territories", `Territory code ${code} is already used.`);
  const territory = await prisma.territory.create({ data: { name, code } });
  await logAudit("Territory", territory.id, "create", `Created territory "${name}"`, { after: territory });
  revalidatePath("/admin/territories");
  redirect("/admin/territories");
}

export async function updateTerritory(formData: FormData) {
  await assertCan("master_data", "edit");
  const id = str(formData, "id");
  const name = str(formData, "name");
  const status = str(formData, "status") || "active";
  const before = await prisma.territory.findUniqueOrThrow({ where: { id } });
  const after = await prisma.territory.update({ where: { id }, data: { name, status } });
  await logAudit("Territory", id, "update", `Updated territory "${name}"`, { before, after });
  revalidatePath("/admin/territories");
  redirect("/admin/territories");
}

export async function createRoute(formData: FormData) {
  await assertCan("master_data", "edit");
  const name = str(formData, "name");
  if (!name) fail("/admin/routes", "A route name is required.");
  const route = await prisma.route.create({
    data: {
      name,
      code: strOrNull(formData, "code"),
      territoryId: strOrNull(formData, "territoryId"),
      visitDay: strOrNull(formData, "visitDay"),
      frequency: str(formData, "frequency") || "weekly",
    },
  });
  await logAudit("Route", route.id, "create", `Created route "${name}"`, { after: route });
  revalidatePath("/admin/routes");
  redirect("/admin/routes");
}

export async function updateRoute(formData: FormData) {
  await assertCan("master_data", "edit");
  const id = str(formData, "id");
  const back = `/admin/routes/${id}`;
  const before = await prisma.route.findUniqueOrThrow({ where: { id } });
  const status = str(formData, "status") || before.status;
  if (before.status === "active" && status === "inactive") {
    const outlets = await prisma.outlet.count({ where: { routeId: id } });
    const stops = await prisma.routeStop.count({ where: { routeId: id } });
    if (outlets || stops) fail(back, `A route cannot be made inactive while ${Math.max(outlets, stops)} outlet(s) are still assigned to it. Move or split them first.`);
  }
  const after = await prisma.route.update({
    where: { id },
    data: {
      name: str(formData, "name") || before.name,
      code: strOrNull(formData, "code"),
      territoryId: strOrNull(formData, "territoryId"),
      visitDay: strOrNull(formData, "visitDay"),
      frequency: str(formData, "frequency") || before.frequency,
      status,
    },
  });
  await logAudit("Route", id, "update", `Updated route "${after.name}"`, { before, after });
  revalidatePath("/admin/routes");
  redirect(back);
}

// An outlet belongs to one active route at a time — adding it here moves it and records both routes.
export async function addRouteStop(formData: FormData) {
  await assertCan("master_data", "edit");
  const routeId = str(formData, "routeId");
  const outletId = str(formData, "outletId");
  const back = `/admin/routes/${routeId}`;
  if (!outletId) fail(back, "Choose an outlet to add.");
  const route = await prisma.route.findUniqueOrThrow({ where: { id: routeId } });
  if (route.status !== "active") fail(back, "This route is inactive.");
  const outlet = await prisma.outlet.findUniqueOrThrow({ where: { id: outletId } });

  const existing = await prisma.routeStop.findMany({ where: { outletId } });
  const previousRoute = outlet.routeId && outlet.routeId !== routeId ? outlet.routeId : null;
  if (existing.some((s) => s.routeId === routeId)) fail(back, "That outlet is already on this route.");
  await prisma.routeStop.deleteMany({ where: { outletId } });
  const count = await prisma.routeStop.count({ where: { routeId } });
  const stop = await prisma.routeStop.create({ data: { routeId, outletId, sequence: count + 1 } });
  await prisma.outlet.update({ where: { id: outletId }, data: { routeId } });
  if (previousRoute) await resequence(previousRoute);
  await logAudit("RouteStop", stop.id, previousRoute ? "route_move" : "create", `${previousRoute ? "Moved" : "Added"} "${outlet.name}" to beat plan stop #${count + 1}`, {
    before: previousRoute ? { routeId: previousRoute } : undefined,
    after: { routeId, sequence: count + 1 },
  });
  revalidatePath(back);
  redirect(back);
}

async function resequence(routeId: string) {
  const remaining = await prisma.routeStop.findMany({ where: { routeId }, orderBy: { sequence: "asc" } });
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].sequence !== i + 1) await prisma.routeStop.update({ where: { id: remaining[i].id }, data: { sequence: i + 1 } });
  }
}

export async function removeRouteStop(formData: FormData) {
  await assertCan("master_data", "edit");
  const stopId = str(formData, "stopId");
  const routeId = str(formData, "routeId");
  const stop = await prisma.routeStop.findUnique({ where: { id: stopId } });
  if (stop) {
    await prisma.routeStop.delete({ where: { id: stopId } });
    await prisma.outlet.update({ where: { id: stop.outletId }, data: { routeId: null } });
    await resequence(routeId);
    await logAudit("RouteStop", stopId, "delete", "Removed beat-plan stop", { before: { routeId, sequence: stop.sequence } });
  }
  revalidatePath(`/admin/routes/${routeId}`);
  redirect(`/admin/routes/${routeId}`);
}

export async function moveRouteStop(formData: FormData) {
  await assertCan("master_data", "edit");
  const stopId = str(formData, "stopId");
  const routeId = str(formData, "routeId");
  const dir = str(formData, "dir"); // up | down
  const stops = await prisma.routeStop.findMany({ where: { routeId }, orderBy: { sequence: "asc" } });
  const i = stops.findIndex((s) => s.id === stopId);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i >= 0 && j >= 0 && j < stops.length) {
    await prisma.routeStop.update({ where: { id: stops[i].id }, data: { sequence: stops[j].sequence } });
    await prisma.routeStop.update({ where: { id: stops[j].id }, data: { sequence: stops[i].sequence } });
    await logAudit("RouteStop", stopId, "resequence", `Moved a beat-plan stop ${dir}`, { before: { sequence: stops[i].sequence }, after: { sequence: stops[j].sequence } });
  }
  revalidatePath(`/admin/routes/${routeId}`);
  redirect(`/admin/routes/${routeId}`);
}

// Split a route when its territory grows: the chosen outlets move to a new route.
export async function splitRoute(formData: FormData) {
  await assertCan("master_data", "edit");
  const routeId = str(formData, "routeId");
  const newName = str(formData, "newName");
  const outletIds = formData.getAll("outletIds").map(String);
  const back = `/admin/routes/${routeId}`;
  if (!newName || outletIds.length === 0) fail(back, "Give the new route a name and select the outlets that move to it.");
  const original = await prisma.route.findUniqueOrThrow({ where: { id: routeId } });
  const created = await prisma.route.create({
    data: { name: newName, territoryId: original.territoryId, visitDay: original.visitDay, frequency: original.frequency },
  });
  let seq = 1;
  for (const outletId of outletIds) {
    await prisma.routeStop.deleteMany({ where: { outletId, routeId } });
    await prisma.routeStop.create({ data: { routeId: created.id, outletId, sequence: seq++ } });
    await prisma.outlet.update({ where: { id: outletId }, data: { routeId: created.id } });
  }
  await resequence(routeId);
  await logAudit("Route", created.id, "split", `Split ${outletIds.length} outlet(s) from "${original.name}" into new route "${newName}"`, { before: { routeId }, after: { routeId: created.id, outletIds } });
  revalidatePath("/admin/routes");
  redirect(`/admin/routes/${created.id}`);
}

// ---------------------------------------------------------------------------
// Sales personnel master
// ---------------------------------------------------------------------------

async function personnelBlockers(userId: string): Promise<string[]> {
  const reasons: string[] = [];
  const van = await prisma.van.findFirst({ where: { assignedUserId: userId } });
  if (van) {
    const stock = await prisma.stockBalance.aggregate({ where: { vanId: van.id }, _sum: { qtyGood: true, qtyDamaged: true } });
    const units = (stock._sum.qtyGood ?? 0) + (stock._sum.qtyDamaged ?? 0);
    if (units > 0) reasons.push(`${units} unit(s) of open van stock on ${van.code}`);
  }
  const cash = await prisma.aRLedgerEntry.aggregate({ where: { type: "payment", method: "cash", collectedBy: userId, depositStatus: "not_deposited" }, _sum: { amount: true } });
  if ((cash._sum.amount ?? 0) > 0) reasons.push(`₱${(cash._sum.amount ?? 0).toLocaleString()} of cash not yet handed in`);
  return reasons;
}

export async function createPersonnel(formData: FormData) {
  await assertCan("users", "edit");
  const name = str(formData, "name");
  const role = str(formData, "role");
  const branchId = strOrNull(formData, "branchId");
  const supervisorId = strOrNull(formData, "supervisorId");
  const employeeCode = strOrNull(formData, "employeeCode");
  if (!name || !role) fail("/admin/personnel", "Name and role are required.");
  // Every sales representative must be linked to a branch and a supervisor.
  if (role === "sales_rep" && (!branchId || !supervisorId)) fail("/admin/personnel", "A sales representative must be linked to a branch and a reporting supervisor.");
  if (employeeCode && (await prisma.user.findUnique({ where: { employeeCode } }))) fail("/admin/personnel", `Employee code ${employeeCode} is already used.`);

  const user = await prisma.user.create({
    data: { name, role, branchId, supervisorId, employeeCode, phone: strOrNull(formData, "phone"), email: strOrNull(formData, "email"), routeId: strOrNull(formData, "routeId") },
  });
  await logAudit("User", user.id, "create", `Created personnel "${name}" (${role})`, { after: user });
  revalidatePath("/admin/personnel");
  redirect("/admin/personnel");
}

export async function updatePersonnel(formData: FormData) {
  await assertCan("users", "edit");
  const userId = str(formData, "userId");
  const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const branchId = strOrNull(formData, "branchId");
  const routeId = strOrNull(formData, "routeId");
  const supervisorId = strOrNull(formData, "supervisorId");
  const active = str(formData, "active") !== "inactive";
  const employeeCode = strOrNull(formData, "employeeCode");

  if (before.role === "sales_rep" && (!branchId || !supervisorId)) fail("/admin/personnel", "A sales representative must keep a branch and a supervisor.");
  if (employeeCode && employeeCode !== before.employeeCode && (await prisma.user.findUnique({ where: { employeeCode } }))) fail("/admin/personnel", `Employee code ${employeeCode} is already used.`);
  if (before.active && !active) {
    const blockers = await personnelBlockers(userId);
    if (blockers.length) fail("/admin/personnel", `${before.name} cannot be deactivated until these are settled: ${blockers.join("; ")}.`);
  }
  const after = await prisma.user.update({
    where: { id: userId },
    data: {
      branchId, routeId, supervisorId, active, employeeCode,
      phone: strOrNull(formData, "phone"),
      email: strOrNull(formData, "email"),
      statusEffectiveFrom: before.active !== active ? new Date(str(formData, "effectiveFrom") || new Date().toISOString().slice(0, 10)) : before.statusEffectiveFrom,
    },
  });
  await logAudit("User", userId, before.active !== active ? (active ? "activate" : "deactivate") : "update", `Updated assignment/status for "${before.name}"`, {
    before: { branchId: before.branchId, routeId: before.routeId, supervisorId: before.supervisorId, active: before.active },
    after: { branchId: after.branchId, routeId: after.routeId, supervisorId: after.supervisorId, active: after.active },
  });
  revalidatePath("/admin/personnel");
  redirect("/admin/personnel");
}

// ---------------------------------------------------------------------------
// Warehouse & van master (distinct, identifiable inventory locations)
// ---------------------------------------------------------------------------

async function locationUnits(where: { warehouseId?: string; vanId?: string }) {
  const s = await prisma.stockBalance.aggregate({ where, _sum: { qtyGood: true, qtyDamaged: true, qtyQuarantine: true } });
  return (s._sum.qtyGood ?? 0) + (s._sum.qtyDamaged ?? 0) + (s._sum.qtyQuarantine ?? 0);
}

export async function createWarehouse(formData: FormData) {
  await assertCan("master_data", "edit");
  const name = str(formData, "name");
  const branchId = str(formData, "branchId");
  const code = strOrNull(formData, "code");
  if (!name || !branchId) fail("/admin/warehouses-vans", "Warehouse name and branch are required.");
  if (code && (await prisma.warehouse.findUnique({ where: { code } }))) fail("/admin/warehouses-vans", `Location code ${code} is already used.`);
  const warehouse = await prisma.warehouse.create({
    data: { name, branchId, code, type: str(formData, "type") || "saleable", address: strOrNull(formData, "address") },
  });
  await logAudit("Warehouse", warehouse.id, "create", `Created warehouse "${name}"`, { after: warehouse });
  revalidatePath("/admin/warehouses-vans");
  redirect("/admin/warehouses-vans");
}

export async function updateWarehouse(formData: FormData) {
  await assertCan("master_data", "edit");
  const id = str(formData, "id");
  const name = str(formData, "name");
  const branchId = str(formData, "branchId");
  const status = str(formData, "status") || "active";
  if (!name || !branchId) fail("/admin/warehouses-vans", "Warehouse name and branch are required.");
  const before = await prisma.warehouse.findUniqueOrThrow({ where: { id } });
  if (before.status === "active" && status === "inactive") {
    const units = await locationUnits({ warehouseId: id });
    if (units > 0) fail("/admin/warehouses-vans", `"${before.name}" still holds ${units} unit(s). A location can be deactivated only when its stock balance is zero.`);
  }
  const after = await prisma.warehouse.update({
    where: { id },
    data: { name, branchId, status, code: strOrNull(formData, "code"), type: str(formData, "type") || before.type, address: strOrNull(formData, "address") },
  });
  await logAudit("Warehouse", id, status !== before.status ? (status === "active" ? "activate" : "deactivate") : "update", `Updated warehouse "${name}"`, { before, after });
  revalidatePath("/admin/warehouses-vans");
  redirect("/admin/warehouses-vans");
}

export async function createVan(formData: FormData) {
  await assertCan("master_data", "edit");
  const code = str(formData, "code");
  const plateNo = str(formData, "plateNo");
  const branchId = str(formData, "branchId");
  const assignedUserId = strOrNull(formData, "assignedUserId");
  if (!code || !plateNo || !branchId) fail("/admin/warehouses-vans", "Van code, plate number and branch are required.");
  if (await prisma.van.findUnique({ where: { code } })) fail("/admin/warehouses-vans", `Van code ${code} is already used.`);
  if (assignedUserId) {
    const taken = await prisma.van.findFirst({ where: { assignedUserId } });
    if (taken) fail("/admin/warehouses-vans", `That user is already assigned to ${taken.code}. A user can have one active van at a time — reassign it first.`);
  }
  const assignedUser = assignedUserId ? await prisma.user.findUnique({ where: { id: assignedUserId } }) : null;
  const van = await prisma.van.create({ data: { code, plateNo, branchId, assignedUserId, driverName: assignedUser?.name ?? "Unassigned" } });
  await logAudit("Van", van.id, "create", `Created van "${code}"`, { after: van });
  revalidatePath("/admin/warehouses-vans");
  redirect("/admin/warehouses-vans");
}

export async function updateVan(formData: FormData) {
  await assertCan("master_data", "edit");
  const id = str(formData, "id");
  const code = str(formData, "code");
  const plateNo = str(formData, "plateNo");
  const branchId = str(formData, "branchId");
  const assignedUserId = strOrNull(formData, "assignedUserId");
  const status = str(formData, "status") || "active";
  if (!code || !plateNo || !branchId) fail("/admin/warehouses-vans", "Van code, plate number and branch are required.");
  const before = await prisma.van.findUniqueOrThrow({ where: { id } });
  if (assignedUserId) {
    const taken = await prisma.van.findFirst({ where: { assignedUserId, id: { not: id } } });
    if (taken) fail("/admin/warehouses-vans", `That user is already assigned to ${taken.code}. A user can have one active van at a time.`);
  }
  if (before.status === "active" && status === "inactive") {
    const units = await locationUnits({ vanId: id });
    if (units > 0) fail("/admin/warehouses-vans", `${before.code} still carries ${units} unit(s). Unload it before deactivating.`);
  }
  const assignedUser = assignedUserId ? await prisma.user.findUnique({ where: { id: assignedUserId } }) : null;
  const after = await prisma.van.update({
    where: { id },
    data: { code, plateNo, branchId, assignedUserId, status, driverName: assignedUser?.name ?? "Unassigned" },
  });
  if (before.assignedUserId !== assignedUserId) {
    await logAudit("Van", id, "reassign", `Reassigned van "${code}" to ${assignedUser?.name ?? "nobody"}`, { before: { assignedUserId: before.assignedUserId }, after: { assignedUserId } });
  }
  await logAudit("Van", id, "update", `Updated van "${code}"`, { before, after });
  revalidatePath("/admin/warehouses-vans");
  redirect("/admin/warehouses-vans");
}

// ---------------------------------------------------------------------------
// (Replaced in later steps: promotions and scheduled reports have dedicated modules.)
// ---------------------------------------------------------------------------

