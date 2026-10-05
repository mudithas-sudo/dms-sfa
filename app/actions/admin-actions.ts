"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

async function logAudit(
  entity: string,
  entityId: string,
  action: string,
  summary: string,
  snapshot?: { before?: unknown; after?: unknown },
) {
  const { userId } = await getSession();
  if (!userId) return;
  await prisma.auditLog.create({
    data: {
      entity,
      entityId,
      action,
      userId,
      summary,
      beforeData: snapshot?.before !== undefined ? JSON.stringify(snapshot.before) : undefined,
      afterData: snapshot?.after !== undefined ? JSON.stringify(snapshot.after) : undefined,
    },
  });
}

export async function createBranch(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim() || null;
  const address = String(formData.get("address") ?? "").trim();
  const contactPerson = String(formData.get("contactPerson") ?? "").trim() || null;
  const contactPhone = String(formData.get("contactPhone") ?? "").trim() || null;
  const status = String(formData.get("status") ?? "active");
  if (!name || !address) return;

  const branch = await prisma.branch.create({ data: { name, code, address, contactPerson, contactPhone, status } });
  await logAudit("Branch", branch.id, "create", `Created branch "${name}"`, { after: branch });
  revalidatePath("/admin/branches");
  redirect("/admin/branches");
}

export async function updateBranch(formData: FormData) {
  const id = String(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim() || null;
  const address = String(formData.get("address") ?? "").trim();
  const contactPerson = String(formData.get("contactPerson") ?? "").trim() || null;
  const contactPhone = String(formData.get("contactPhone") ?? "").trim() || null;
  const status = String(formData.get("status") ?? "active");

  const before = await prisma.branch.findUniqueOrThrow({ where: { id } });
  const after = await prisma.branch.update({ where: { id }, data: { name, code, address, contactPerson, contactPhone, status } });
  await logAudit("Branch", id, "update", `Updated branch "${name}"`, { before, after });
  revalidatePath("/admin/branches");
  redirect("/admin/branches");
}

export async function createOutlet(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const branchId = String(formData.get("branchId"));
  const channelId = String(formData.get("channelId"));
  const subChannel = String(formData.get("subChannel") ?? "").trim();
  const routeId = String(formData.get("routeId") ?? "") || null;
  const address = String(formData.get("address") ?? "").trim();
  const contactPerson = String(formData.get("contactPerson") ?? "").trim() || null;
  const creditLimit = Number(formData.get("creditLimit") ?? 0);
  const lat = Number(formData.get("lat") ?? 14.5995);
  const lng = Number(formData.get("lng") ?? 120.9842);
  if (!name || !branchId || !channelId) return;

  const outlet = await prisma.outlet.create({
    data: { name, branchId, channelId, subChannel, routeId, address, contactPerson, creditLimit, lat, lng },
  });
  await logAudit("Outlet", outlet.id, "create", `Created outlet "${name}"`, { after: outlet });
  revalidatePath("/admin/outlets");
  redirect("/admin/outlets");
}

export async function updateOutlet(formData: FormData) {
  const id = String(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  const branchId = String(formData.get("branchId"));
  const channelId = String(formData.get("channelId"));
  const subChannel = String(formData.get("subChannel") ?? "").trim();
  const routeId = String(formData.get("routeId") ?? "") || null;
  const address = String(formData.get("address") ?? "").trim();
  const contactPerson = String(formData.get("contactPerson") ?? "").trim() || null;
  const lat = Number(formData.get("lat") ?? 0);
  const lng = Number(formData.get("lng") ?? 0);
  const creditLimit = Number(formData.get("creditLimit") ?? 0);
  const status = String(formData.get("status") ?? "active");

  const before = await prisma.outlet.findUniqueOrThrow({ where: { id } });
  const after = await prisma.outlet.update({
    where: { id },
    data: { name, branchId, channelId, subChannel, routeId, address, contactPerson, lat, lng, creditLimit, status },
  });
  await logAudit("Outlet", id, "update", `Updated outlet "${name}"`, { before, after });
  revalidatePath("/admin/outlets");
  redirect("/admin/outlets");
}

export async function createProduct(formData: FormData) {
  const sku = String(formData.get("sku") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const uom = String(formData.get("uom") ?? "").trim();
  const packSize = String(formData.get("packSize") ?? "").trim() || null;
  const category = String(formData.get("category") ?? "").trim();
  const hasExpiry = formData.get("hasExpiry") === "on";
  const unitPrice = Number(formData.get("unitPrice") ?? 0);
  if (!sku || !name) return;

  const product = await prisma.product.create({
    data: { sku, name, uom, packSize, category, hasExpiry, unitPrice },
  });
  await logAudit("Product", product.id, "create", `Created product "${name}" (${sku})`, { after: product });
  revalidatePath("/admin/products");
  redirect("/admin/products");
}

export async function updateProduct(formData: FormData) {
  const id = String(formData.get("id"));
  const sku = String(formData.get("sku") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const uom = String(formData.get("uom") ?? "").trim();
  const packSize = String(formData.get("packSize") ?? "").trim() || null;
  const category = String(formData.get("category") ?? "").trim();
  const hasExpiry = formData.get("hasExpiry") === "on";
  const unitPrice = Number(formData.get("unitPrice") ?? 0);
  const status = String(formData.get("status") ?? "active");

  const before = await prisma.product.findUniqueOrThrow({ where: { id } });
  const after = await prisma.product.update({
    where: { id },
    data: { sku, name, uom, packSize, category, hasExpiry, unitPrice, status },
  });
  await logAudit("Product", id, "update", `Updated product "${name}"`, { before, after });
  revalidatePath("/admin/products");
  redirect("/admin/products");
}

export async function createPricingRule(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const level = String(formData.get("level") ?? "channel");
  const channelId = String(formData.get("channelId") ?? "") || null;
  const outletId = String(formData.get("outletId") ?? "") || null;
  const productId = String(formData.get("productId") ?? "") || null;
  const priceType = String(formData.get("priceType") ?? "discount_percent");
  const value = Number(formData.get("value") ?? 0);
  const startDate = new Date(String(formData.get("startDate")));
  const endDateRaw = String(formData.get("endDate") ?? "");
  // A channel rule needs a channel and a customer rule needs an outlet —
  // otherwise it would save fine but never match any order.
  if (!name || (level === "channel" && !channelId) || (level === "customer" && !outletId)) return;

  const rule = await prisma.pricingRule.create({
    data: {
      name,
      level,
      channelId: level === "channel" ? channelId : null,
      outletId: level === "customer" ? outletId : null,
      productId,
      priceType,
      value,
      startDate,
      endDate: endDateRaw ? new Date(endDateRaw) : null,
    },
  });
  await logAudit("PricingRule", rule.id, "create", `Created pricing rule "${name}"`, { after: rule });
  revalidatePath("/admin/pricing");
  redirect("/admin/pricing");
}

export async function createCustomerDiscount(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const outletId = String(formData.get("outletId") ?? "") || null;
  const value = Number(formData.get("value") ?? 0);
  const startDate = new Date(String(formData.get("startDate")));
  if (!name || !outletId) return;

  const rule = await prisma.pricingRule.create({
    data: { name, level: "customer", outletId, priceType: "discount_percent", value, startDate },
  });
  await logAudit("PricingRule", rule.id, "create", `Created standing customer discount "${name}"`, { after: rule });
  revalidatePath("/admin/customer-discounts");
  redirect("/admin/customer-discounts");
}

export async function createPromotion(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "volume_discount");
  const eligibilityRule = String(formData.get("eligibilityRule") ?? "").trim();
  const minQtyRaw = String(formData.get("minQty") ?? "").trim();
  const productId = String(formData.get("productId") ?? "") || null;
  const channelId = String(formData.get("channelId") ?? "") || null;
  const discountValue = Number(formData.get("discountValue") ?? 0);
  const freeQtyRaw = String(formData.get("freeQty") ?? "").trim();
  const startDate = new Date(String(formData.get("startDate")));
  const endDate = new Date(String(formData.get("endDate")));
  if (!name) return;

  const promo = await prisma.promotion.create({
    data: {
      name,
      type,
      eligibilityRule,
      minQty: minQtyRaw ? Number(minQtyRaw) : null,
      productId,
      channelId,
      discountValue,
      freeQty: freeQtyRaw ? Number(freeQtyRaw) : null,
      startDate,
      endDate,
      status: endDate >= new Date() ? "active" : "expired",
    },
  });
  await logAudit("Promotion", promo.id, "create", `Created promotion "${name}"`, { after: promo });
  revalidatePath("/admin/promotions");
  redirect("/admin/promotions");
}

// ---------------------------------------------------------------------------
// Outlet onboarding (new customer -> pending -> approved/rejected)
// ---------------------------------------------------------------------------

export async function decideOutletOnboarding(formData: FormData) {
  const outletId = String(formData.get("outletId"));
  const decision = String(formData.get("decision")); // approved | rejected
  const reason = String(formData.get("reason") ?? "");
  const outlet = await prisma.outlet.findUniqueOrThrow({ where: { id: outletId } });

  await prisma.outlet.update({
    where: { id: outletId },
    data: {
      onboardingStatus: decision,
      onboardingReason: decision === "rejected" ? reason : null,
      status: decision === "approved" ? "active" : "inactive",
    },
  });
  await logAudit("Outlet", outletId, "update", `${decision === "approved" ? "Approved" : "Rejected"} onboarding for "${outlet.name}"`, {
    before: { onboardingStatus: outlet.onboardingStatus },
    after: { onboardingStatus: decision, reason: decision === "rejected" ? reason : undefined },
  });
  revalidatePath("/admin/outlets/onboarding");
}

// ---------------------------------------------------------------------------
// Channel & sub-channel master
// ---------------------------------------------------------------------------

export async function createChannel(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  // Channel names are unique — adding an existing one is a no-op, not an error page.
  if (await prisma.channel.findUnique({ where: { name } })) return;

  const channel = await prisma.channel.create({ data: { name } });
  await logAudit("Channel", channel.id, "create", `Added channel "${name}"`, { after: channel });
  revalidatePath("/admin/channels");
}

export async function createSubChannel(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const channelId = String(formData.get("channelId"));
  if (!name || !channelId) return;

  const subChannel = await prisma.subChannel.create({ data: { name, channelId } });
  await logAudit("SubChannel", subChannel.id, "create", `Added sub-channel "${name}"`, { after: subChannel });
  revalidatePath("/admin/channels");
}

// ---------------------------------------------------------------------------
// Territory & route master (beat plan builder)
// ---------------------------------------------------------------------------

export async function createTerritory(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim() || null;
  if (!name) return;
  const territory = await prisma.territory.create({ data: { name, code } });
  await logAudit("Territory", territory.id, "create", `Created territory "${name}"`, { after: territory });
  revalidatePath("/admin/territories");
}

export async function updateTerritory(formData: FormData) {
  const id = String(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  const status = String(formData.get("status") ?? "active");
  const before = await prisma.territory.findUniqueOrThrow({ where: { id } });
  const after = await prisma.territory.update({ where: { id }, data: { name, status } });
  await logAudit("Territory", id, "update", `Updated territory "${name}"`, { before, after });
  revalidatePath("/admin/territories");
}

export async function createRoute(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const territoryId = String(formData.get("territoryId") ?? "") || null;
  if (!name) return;
  const route = await prisma.route.create({ data: { name, territoryId } });
  await logAudit("Route", route.id, "create", `Created route "${name}"`, { after: route });
  revalidatePath("/admin/routes");
}

export async function addRouteStop(formData: FormData) {
  const routeId = String(formData.get("routeId"));
  const outletId = String(formData.get("outletId"));
  if (!outletId) return;

  const currentCount = await prisma.routeStop.count({ where: { routeId } });
  const stop = await prisma.routeStop.create({ data: { routeId, outletId, sequence: currentCount + 1 } });
  await logAudit("RouteStop", stop.id, "create", `Added beat-plan stop #${currentCount + 1}`);
  revalidatePath(`/admin/routes/${routeId}`);
}

export async function removeRouteStop(formData: FormData) {
  const stopId = String(formData.get("stopId"));
  const routeId = String(formData.get("routeId"));
  await prisma.routeStop.delete({ where: { id: stopId } });

  // Re-sequence the remaining stops so the beat plan stays contiguous (1..n).
  const remaining = await prisma.routeStop.findMany({ where: { routeId }, orderBy: { sequence: "asc" } });
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].sequence !== i + 1) {
      await prisma.routeStop.update({ where: { id: remaining[i].id }, data: { sequence: i + 1 } });
    }
  }
  await logAudit("RouteStop", stopId, "delete", "Removed beat-plan stop");
  revalidatePath(`/admin/routes/${routeId}`);
}

// ---------------------------------------------------------------------------
// Sales personnel master (route / supervisor assignment)
// ---------------------------------------------------------------------------

export async function createPersonnel(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();
  const branchId = String(formData.get("branchId") ?? "") || null;
  if (!name || !role) return;

  const user = await prisma.user.create({ data: { name, role, branchId } });
  await logAudit("User", user.id, "create", `Created personnel "${name}" (${role})`, { after: user });
  revalidatePath("/admin/personnel");
}

export async function updatePersonnelAssignment(formData: FormData) {
  const userId = String(formData.get("userId"));
  const branchId = String(formData.get("branchId") ?? "") || null;
  const routeId = String(formData.get("routeId") ?? "") || null;
  const supervisorId = String(formData.get("supervisorId") ?? "") || null;

  const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const after = await prisma.user.update({ where: { id: userId }, data: { branchId, routeId, supervisorId } });
  await logAudit("User", userId, "update", `Updated branch/route/supervisor assignment for "${before.name}"`, {
    before: { branchId: before.branchId, routeId: before.routeId, supervisorId: before.supervisorId },
    after: { branchId: after.branchId, routeId: after.routeId, supervisorId: after.supervisorId },
  });
  revalidatePath("/admin/personnel");
}

// ---------------------------------------------------------------------------
// Scheduled report configuration (demo only — no real cron)
// ---------------------------------------------------------------------------

export async function createScheduledReport(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const reportType = String(formData.get("reportType"));
  const scheduleDescription = String(formData.get("scheduleDescription") ?? "").trim();
  const recipientEmails = String(formData.get("recipientEmails") ?? "").trim();
  if (!name || !scheduleDescription) return;

  const { userId } = await getSession();
  const creator = userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? "Admin" : "Admin";

  const report = await prisma.scheduledReport.create({
    data: { name, reportType, scheduleDescription, recipientEmails, createdBy: creator },
  });
  await logAudit("ScheduledReport", report.id, "create", `Created scheduled report "${name}"`, { after: report });
  revalidatePath("/admin/scheduled-reports");
}

export async function toggleScheduledReport(formData: FormData) {
  const id = String(formData.get("id"));
  const nextStatus = String(formData.get("nextStatus"));
  await prisma.scheduledReport.update({ where: { id }, data: { status: nextStatus } });
  revalidatePath("/admin/scheduled-reports");
}

// ---------------------------------------------------------------------------
// Warehouse & van master (distinct, identifiable inventory locations)
// ---------------------------------------------------------------------------

export async function createWarehouse(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const branchId = String(formData.get("branchId"));
  if (!name || !branchId) return;

  const warehouse = await prisma.warehouse.create({ data: { name, branchId } });
  await logAudit("Warehouse", warehouse.id, "create", `Created warehouse "${name}"`, { after: warehouse });
  revalidatePath("/admin/warehouses-vans");
}

export async function updateWarehouse(formData: FormData) {
  const id = String(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  const branchId = String(formData.get("branchId"));
  if (!name || !branchId) return;

  const before = await prisma.warehouse.findUniqueOrThrow({ where: { id } });
  const after = await prisma.warehouse.update({ where: { id }, data: { name, branchId } });
  await logAudit("Warehouse", id, "update", `Updated warehouse "${name}"`, { before, after });
  revalidatePath("/admin/warehouses-vans");
}

export async function createVan(formData: FormData) {
  const code = String(formData.get("code") ?? "").trim();
  const plateNo = String(formData.get("plateNo") ?? "").trim();
  const branchId = String(formData.get("branchId"));
  const assignedUserId = String(formData.get("assignedUserId") ?? "") || null;
  if (!code || !plateNo || !branchId) return;

  const assignedUser = assignedUserId ? await prisma.user.findUnique({ where: { id: assignedUserId } }) : null;
  const van = await prisma.van.create({
    data: { code, plateNo, branchId, assignedUserId, driverName: assignedUser?.name ?? "Unassigned" },
  });
  await logAudit("Van", van.id, "create", `Created van "${code}"`, { after: van });
  revalidatePath("/admin/warehouses-vans");
}

export async function updateVan(formData: FormData) {
  const id = String(formData.get("id"));
  const code = String(formData.get("code") ?? "").trim();
  const plateNo = String(formData.get("plateNo") ?? "").trim();
  const branchId = String(formData.get("branchId"));
  const assignedUserId = String(formData.get("assignedUserId") ?? "") || null;
  if (!code || !plateNo || !branchId) return;

  const assignedUser = assignedUserId ? await prisma.user.findUnique({ where: { id: assignedUserId } }) : null;
  const before = await prisma.van.findUniqueOrThrow({ where: { id } });
  const after = await prisma.van.update({
    where: { id },
    data: { code, plateNo, branchId, assignedUserId, driverName: assignedUser?.name ?? "Unassigned" },
  });
  await logAudit("Van", id, "update", `Updated van "${code}"`, { before, after });
  revalidatePath("/admin/warehouses-vans");
}
