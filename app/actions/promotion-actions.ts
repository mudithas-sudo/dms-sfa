"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { assertCan } from "@/lib/rbac";
import { sendMessage } from "@/lib/integration";
import { WEEKDAYS, type PromoConfig } from "@/lib/promotions";

function go(path: string, kind: "error" | "notice", message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const numOrNull = (f: FormData, k: string) => {
  const v = str(f, k);
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function actor() {
  const { userId } = await getSession();
  return userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? "User" : "User";
}

const TYPES_NEEDING_PRODUCT_OPTIONAL = ["volume_discount", "free_good", "qty_slab", "price_off", "rebate"];

// Creates a draft, updates a draft, or — when `parentId` is given — starts a new version of a live promotion.
// A running promotion is never edited in place: the change is a new version that goes through approval again,
// and the old version keeps applying (and keeps its claims) until the new one is activated.
export async function savePromotion(formData: FormData) {
  await assertCan("promotions", "edit");
  const id = str(formData, "id");
  const parentId = str(formData, "parentId");
  const back = id ? `/admin/promotions/${id}/edit` : parentId ? `/admin/promotions/new?from=${parentId}` : "/admin/promotions/new";
  const name = str(formData, "name");
  const type = str(formData, "type") || "volume_discount";
  const startRaw = str(formData, "startDate");
  const endRaw = str(formData, "endDate");
  const startDate = new Date(startRaw);
  const endDate = new Date(endRaw);
  if (!name) go(back, "error", "Give the promotion a name.");
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) go(back, "error", "Start and end dates are required.");
  if (endDate < startDate) go(back, "error", "The end date cannot be before the start date.");
  endDate.setHours(23, 59, 59, 0);

  const productId = str(formData, "productId") || null;
  const minQty = numOrNull(formData, "minQty");
  const freeQty = numOrNull(formData, "freeQty");
  const discountValue = numOrNull(formData, "discountValue") ?? 0;
  const minOrderValue = numOrNull(formData, "minOrderValue");
  const cfg: PromoConfig = {};

  if (type === "free_good") {
    if (!minQty || minQty < 1 || !freeQty || freeQty < 1) go(back, "error", "Free goods need a minimum quantity and the free units given.");
    cfg.repeat = formData.get("repeat") === "on";
  } else if (type === "qty_slab") {
    const slabs: NonNullable<PromoConfig["slabs"]> = [];
    for (let i = 1; i <= 4; i++) {
      const q = numOrNull(formData, `slabQty${i}`);
      if (!q) continue;
      const pct = numOrNull(formData, `slabPct${i}`) ?? 0;
      const free = numOrNull(formData, `slabFree${i}`) ?? 0;
      if (pct <= 0 && free <= 0) go(back, "error", `Slab ${i} needs a % off or free units.`);
      if (pct > 100) go(back, "error", `Slab ${i}: the discount cannot be above 100%.`);
      slabs.push({ minQty: q, discountPct: pct || undefined, freeQty: free || undefined });
    }
    if (slabs.length === 0) go(back, "error", "Add at least one quantity slab.");
    if (new Set(slabs.map((s) => s.minQty)).size !== slabs.length) go(back, "error", "Two slabs start at the same quantity.");
    cfg.slabs = slabs.sort((a, b) => a.minQty - b.minQty);
  } else if (type === "bundle") {
    const items: NonNullable<PromoConfig["items"]> = [];
    for (let i = 1; i <= 4; i++) {
      const pid = str(formData, `bundleProduct${i}`);
      const q = numOrNull(formData, `bundleQty${i}`);
      if (pid && q && q > 0) items.push({ productId: pid, qty: q });
    }
    if (items.length < 2) go(back, "error", "A bundle needs at least two products.");
    if (new Set(items.map((i) => i.productId)).size !== items.length) go(back, "error", "A product appears twice in the bundle.");
    const price = numOrNull(formData, "bundlePrice");
    const pct = numOrNull(formData, "bundleDiscountPct");
    if (!price && !pct) go(back, "error", "Set the bundle price or the % off the bundle.");
    cfg.items = items;
    if (price) cfg.bundlePrice = price;
    else cfg.bundleDiscountPct = pct ?? 0;
    cfg.maxBundles = numOrNull(formData, "maxBundles") ?? undefined;
  } else if (type === "value_based") {
    const off = numOrNull(formData, "valueOff");
    const pct = numOrNull(formData, "valueOffPct");
    if (!minOrderValue || minOrderValue <= 0) go(back, "error", "Set the minimum order value.");
    if (!off && !pct) go(back, "error", "Set the value off or the % off the order.");
    if (off) cfg.valueOff = off;
    else cfg.valueOffPct = pct ?? 0;
  } else {
    if (discountValue <= 0 || discountValue > 100) go(back, "error", "The discount must be above 0% and not more than 100%.");
  }
  if (["volume_discount", "price_off", "rebate"].includes(type) && (discountValue <= 0 || discountValue > 100)) go(back, "error", "The discount must be above 0% and not more than 100%.");
  if (type === "bundle" && cfg.bundleDiscountPct && cfg.bundleDiscountPct > 100) go(back, "error", "The bundle discount cannot be above 100%.");

  const days = WEEKDAYS.filter((d) => formData.get(`day_${d}`) === "on");
  const branchIds = formData.getAll("branchId").map(String).filter(Boolean);
  const data = {
    name,
    code: str(formData, "code") || null,
    type,
    eligibilityRule: str(formData, "eligibilityRule") || "As configured",
    minQty: type === "free_good" || type === "volume_discount" || type === "price_off" || type === "rebate" ? minQty : null,
    productId: TYPES_NEEDING_PRODUCT_OPTIONAL.includes(type) ? productId : null,
    channelId: str(formData, "channelId") || null,
    discountValue: ["volume_discount", "price_off", "rebate"].includes(type) ? discountValue : 0,
    freeQty: type === "free_good" ? freeQty : null,
    minOrderValue: type === "value_based" ? minOrderValue : null,
    startDate,
    endDate,
    config: Object.keys(cfg).length ? JSON.stringify(cfg) : null,
    maxDiscountCap: numOrNull(formData, "maxDiscountCap"),
    budget: numOrNull(formData, "budget"),
    maxRedemptions: numOrNull(formData, "maxRedemptions") ? Math.floor(numOrNull(formData, "maxRedemptions")!) : null,
    stacking: str(formData, "stacking") || "none",
    priority: Math.floor(numOrNull(formData, "priority") ?? 0),
    branchIds: branchIds.length ? branchIds.join(",") : null,
    daysOfWeek: days.length && days.length < 7 ? days.join(",") : null,
    notes: str(formData, "notes") || null,
  };
  if (data.code) {
    const clash = await prisma.promotion.findFirst({ where: { code: data.code, id: id ? { not: id } : undefined } });
    if (clash) go(back, "error", `The promotion code ${data.code} is already used by "${clash.name}".`);
  }
  const me = await actor();

  if (id) {
    const before = await prisma.promotion.findUniqueOrThrow({ where: { id } });
    if (before.status !== "draft") go(`/admin/promotions/${id}`, "error", "Only a draft can be edited — start a new version instead.");
    await prisma.promotion.update({ where: { id }, data });
    await logAudit("Promotion", id, "update", `Updated draft promotion "${name}"`, { before, after: data });
    revalidatePath("/admin/promotions");
    go(`/admin/promotions/${id}`, "notice", "Draft saved.");
  }

  let version = 1;
  if (parentId) {
    const parent = await prisma.promotion.findUniqueOrThrow({ where: { id: parentId } });
    const latest = await prisma.promotion.findFirst({ where: { OR: [{ id: parent.parentId ?? parent.id }, { parentId: parent.parentId ?? parent.id }] }, orderBy: { version: "desc" } });
    version = (latest?.version ?? parent.version) + 1;
    data.code = null; // the code stays with the version that is live; a new code can be set when approving
  }
  const created = await prisma.promotion.create({ data: { ...data, status: "draft", version, parentId: parentId ? (await prisma.promotion.findUniqueOrThrow({ where: { id: parentId } })).parentId ?? parentId : null, createdBy: me } });
  await logAudit("Promotion", created.id, "create", `Created ${parentId ? `version ${version} of ` : "draft "}promotion "${name}"`, { after: created });
  revalidatePath("/admin/promotions");
  go(`/admin/promotions/${created.id}`, "notice", parentId ? `Version ${version} drafted — approve and activate it to replace the running version.` : "Draft saved. Approve and activate it to make it apply to orders.");
}

type Transition = "approve" | "activate" | "suspend" | "resume" | "end" | "discard";

export async function transitionPromotion(formData: FormData) {
  const id = str(formData, "id");
  const action = str(formData, "action") as Transition;
  const reason = str(formData, "reason");
  const back = `/admin/promotions/${id}`;
  await assertCan("promotions", action === "approve" || action === "activate" ? "approve" : "edit");
  const p = await prisma.promotion.findUniqueOrThrow({ where: { id } });
  const me = await actor();
  const { role } = await getSession();
  const now = new Date();

  const set = async (status: string, extra: Record<string, unknown> = {}, note?: string) => {
    await prisma.promotion.update({ where: { id }, data: { status, ...extra } });
    await logAudit("Promotion", id, action, `${note ?? action} — promotion "${p.name}" v${p.version}${reason ? ` (${reason})` : ""}`, { before: { status: p.status }, after: { status } });
    await sendMessage({ connector: "trade_promotion", direction: "outbound", docType: "Promotion status", reference: p.code ?? p.id.slice(-8), payload: { name: p.name, version: p.version, status } });
    revalidatePath("/admin/promotions");
    revalidatePath(back);
    go(back, "notice", `Promotion is now ${status}.`);
  };

  if (action === "approve") {
    if (p.status !== "draft") go(back, "error", "Only a draft can be approved.");
    if (p.createdBy && p.createdBy === me && role !== "admin") go(back, "error", "You created this promotion, so another approver must approve it.");
    await set("approved", { approvedBy: me }, "Approved");
  }
  if (action === "activate") {
    if (!["approved", "suspended"].includes(p.status)) go(back, "error", "Approve the promotion before activating it.");
    if (p.endDate < now) go(back, "error", "The end date has passed — start a new version with new dates.");
    if (p.parentId) {
      // the new version replaces the one that is running
      const siblings = await prisma.promotion.findMany({ where: { OR: [{ id: p.parentId }, { parentId: p.parentId }], id: { not: id }, status: { in: ["active", "suspended", "approved"] } } });
      for (const s of siblings.filter((x) => x.version < p.version)) {
        await prisma.promotion.update({ where: { id: s.id }, data: { status: "expired", notes: `${s.notes ?? ""} Superseded by version ${p.version}.`.trim() } });
        await logAudit("Promotion", s.id, "supersede", `Version ${s.version} of "${s.name}" replaced by version ${p.version}`);
      }
    }
    await set("active", { suspendReason: null }, p.status === "suspended" ? "Resumed" : "Activated");
  }
  if (action === "suspend") {
    if (p.status !== "active") go(back, "error", "Only an active promotion can be suspended.");
    if (!reason) go(back, "error", "Give a reason for suspending the promotion.");
    await set("suspended", { suspendReason: reason }, "Suspended");
    await notify({ role: "supervisor", title: `Promotion suspended: ${p.name}`, body: reason, link: "/admin/promotions", kind: "alert" });
  }
  if (action === "resume") {
    if (p.status !== "suspended") go(back, "error", "Only a suspended promotion can be resumed.");
    if (p.endDate < now) go(back, "error", "The end date has passed.");
    await set("active", { suspendReason: null }, "Resumed");
  }
  if (action === "end") {
    if (!["active", "suspended", "approved"].includes(p.status)) go(back, "error", "This promotion is not running.");
    await set("expired", { endDate: now }, "Ended early");
  }
  if (action === "discard") {
    if (p.status !== "draft") go(back, "error", "Only a draft can be discarded.");
    await set("discarded", {}, "Discarded");
  }
}
