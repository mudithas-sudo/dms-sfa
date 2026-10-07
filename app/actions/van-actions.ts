"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { assertCan } from "@/lib/rbac";
import { getAllSettings, num } from "@/lib/settings";
import { actorName, addToLot, availableOf, changeBalance, fefoLots } from "@/lib/stock";
import { dayStart, getRepVan, vanDayFigures } from "@/lib/van";

function go(path: string, key: "error" | "notice", message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`);
}
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const intOf = (f: FormData, k: string) => {
  const n = Math.floor(Number(f.get(k)));
  return Number.isFinite(n) ? n : 0;
};
const SFA = "/sfa/van-stock";

async function repAndVan(back: string) {
  const { userId, branchId } = await getSession();
  if (!userId || !branchId) go(back, "error", "Select a field representative first.");
  const rep = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const van = await getRepVan(branchId, rep);
  if (!van) go(back, "error", "No active van is assigned to you.");
  return { rep, van, branchId };
}

async function nextNo(prefix: string, count: () => Promise<number>, pad = 5) {
  return `${prefix}-${String((await count()) + 1).padStart(pad, "0")}`;
}

// ===========================================================================
// SFA — stock (replenishment) request
// ===========================================================================

export async function saveStockRequest(formData: FormData) {
  const { rep, van, branchId } = await repAndVan(SFA);
  const intent = str(formData, "intent") === "draft" ? "draft" : "submit";
  const requiredDate = str(formData, "requiredDate") ? new Date(str(formData, "requiredDate")) : dayStart();
  const items: { productId: string; qty: number }[] = [];
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith("qty_")) continue;
    const q = Math.floor(Number(v));
    if (Number.isFinite(q) && q > 0) items.push({ productId: k.slice(4), qty: q });
  }
  if (items.length === 0) go(SFA, "error", "Add at least one product with a quantity.");

  // one active request per van and date; further needs go in an additional request only after the first is closed
  const dayEnd = new Date(requiredDate.getTime() + 86400000);
  const active = await prisma.replenishmentRequest.findFirst({
    where: { vanId: van.id, requiredDate: { gte: dayStart(requiredDate), lt: dayEnd }, status: { in: ["draft", "pending", "approved", "partially_approved"] } },
  });
  if (active && str(formData, "requestId") !== active.id) go(SFA, "error", `Request ${active.requestNumber} is still active for that date (${active.status.replace(/_/g, " ")}). Cancel it or wait until it is loaded before raising another.`);

  const wh = await prisma.warehouse.findFirst({ where: { branchId, type: "saleable", status: "active" } });
  const [vanRows, whRows] = await Promise.all([
    prisma.stockBalance.findMany({ where: { locationType: "van", vanId: van.id } }),
    wh ? prisma.stockBalance.findMany({ where: { warehouseId: wh.id } }) : Promise.resolve([]),
  ]);
  const data = {
    vanId: van.id, branchId, requestedBy: rep.name, requiredDate, remarks: str(formData, "remarks") || null,
    productId: items[0].productId, qtyRequested: items[0].qty, status: intent === "draft" ? "draft" : "pending",
  };
  let id = str(formData, "requestId");
  if (id) {
    const cur = await prisma.replenishmentRequest.findUniqueOrThrow({ where: { id } });
    if (cur.status !== "draft") go(SFA, "error", "Only a draft can be edited.");
    await prisma.replenishmentLine.deleteMany({ where: { requestId: id } });
    await prisma.replenishmentRequest.update({ where: { id }, data });
  } else {
    const r = await prisma.replenishmentRequest.create({ data: { ...data, requestNumber: await nextNo("RPL", () => prisma.replenishmentRequest.count(), 5) } });
    id = r.id;
  }
  for (const it of items) {
    await prisma.replenishmentLine.create({
      data: {
        requestId: id, productId: it.productId, qtyRequested: it.qty,
        vanBalance: vanRows.filter((r) => r.productId === it.productId).reduce((s, r) => s + r.qtyGood, 0),
        warehouseAvail: whRows.filter((r) => r.productId === it.productId).reduce((s, r) => s + availableOf(r), 0),
      },
    });
  }
  const req = await prisma.replenishmentRequest.findUniqueOrThrow({ where: { id } });
  await logAudit("ReplenishmentRequest", id, intent, `${intent === "draft" ? "Drafted" : "Submitted"} stock request ${req.requestNumber} (${items.length} line(s)) for ${van.code}`, undefined, { source: "sfa" });
  if (intent === "submit") await notify({ role: "branch_ops", branchId, title: "Van stock request", body: `${rep.name} requested stock for ${van.code} (${req.requestNumber})`, link: "/branch/replenishment-requests", kind: "approval" });
  revalidatePath(SFA);
  go(SFA, "notice", `${req.requestNumber} ${intent === "draft" ? "saved as a draft" : "sent to the warehouse supervisor"}.`);
}

export async function cancelStockRequest(formData: FormData) {
  const id = str(formData, "id");
  const r = await prisma.replenishmentRequest.findUniqueOrThrow({ where: { id } });
  const back = str(formData, "back") || SFA;
  if (!["draft", "pending", "approved", "partially_approved"].includes(r.status)) go(back, "error", "That request can no longer be cancelled.");
  const load = await prisma.vanLoad.findFirst({ where: { replenishmentRequestId: id, status: "pending_load" }, include: { lines: true } });
  if (load) await releaseLoadReservations(load.id);
  if (load) await prisma.vanLoad.update({ where: { id: load.id }, data: { status: "cancelled" } });
  await prisma.replenishmentRequest.update({ where: { id }, data: { status: "cancelled", decisionNote: str(formData, "reason") || r.decisionNote } });
  await logAudit("ReplenishmentRequest", id, "cancel", `Cancelled stock request ${r.requestNumber}`);
  revalidatePath(SFA);
  go(back, "notice", `${r.requestNumber} cancelled — it stays on record with its reason.`);
}

async function releaseLoadReservations(loadId: string) {
  const load = await prisma.vanLoad.findUniqueOrThrow({ where: { id: loadId }, include: { lines: true } });
  for (const l of load.lines) {
    const row = await prisma.stockBalance.findFirst({ where: { warehouseId: load.warehouseId, productId: l.productId, lotNumber: l.lotNumber } });
    if (row) await prisma.stockBalance.update({ where: { id: row.id }, data: { qtyReserved: Math.max(0, row.qtyReserved - l.qty) } });
  }
}

// ===========================================================================
// DMS — warehouse supervisor decides the request; the clerk loads against it
// ===========================================================================

export async function decideReplenishment(formData: FormData) {
  await assertCan("van", "approve");
  const back = "/branch/replenishment-requests";
  const id = str(formData, "id");
  const decision = str(formData, "decision"); // approve | reject
  const req = await prisma.replenishmentRequest.findUniqueOrThrow({ where: { id }, include: { lines: true, van: true } });
  if (req.status !== "pending") go(back, "error", "This request has already been decided.");
  const approver = await actorName("Supervisor");

  if (decision === "reject") {
    const reason = str(formData, "reason");
    if (!reason) go(back, "error", "Give a reason for rejecting the request.");
    await prisma.replenishmentRequest.update({ where: { id }, data: { status: "rejected", decisionNote: reason, decidedAt: new Date() } });
    await logAudit("ReplenishmentRequest", id, "reject", `Rejected stock request ${req.requestNumber} — ${reason}`);
    const rep = await prisma.user.findFirst({ where: { name: req.requestedBy, branchId: req.branchId } });
    if (rep) await notify({ userId: rep.id, title: "Stock request rejected", body: `${req.requestNumber}: ${reason}`, link: SFA, kind: "alert" });
    revalidatePath(back);
    go(back, "notice", `${req.requestNumber} rejected.`);
  }

  const wh = await prisma.warehouse.findFirst({ where: { branchId: req.branchId, type: "saleable", status: "active" } });
  if (!wh) go(back, "error", "The branch has no active saleable warehouse.");
  // approved quantities may be lower than requested but never above what the warehouse can supply now
  const plan: { lineId: string; productId: string; qty: number; picks: { rowId: string; lot: string; qty: number }[] }[] = [];
  for (const l of req.lines) {
    const qty = Math.max(0, intOf(formData, `appr_${l.id}`));
    if (qty > l.qtyRequested) go(back, "error", "An approved quantity cannot exceed the quantity requested.");
    const lots = await fefoLots(wh.id, l.productId);
    const avail = lots.reduce((s, r) => s + availableOf(r), 0);
    if (qty > avail) go(back, "error", `Only ${avail} unit(s) are available in the warehouse for one of the lines; approve ${avail} or fewer.`);
    const picks: { rowId: string; lot: string; qty: number }[] = [];
    let left = qty;
    for (const r of lots) {
      if (left <= 0) break;
      const take = Math.min(availableOf(r), left);
      if (take > 0) picks.push({ rowId: r.id, lot: r.lotNumber, qty: take });
      left -= take;
    }
    plan.push({ lineId: l.id, productId: l.productId, qty, picks });
  }
  const total = plan.reduce((s, p) => s + p.qty, 0);
  if (total === 0) go(back, "error", "All approved quantities are zero — reject the request instead.");
  const full = plan.every((p, i) => p.qty === req.lines[i].qtyRequested);
  const note = str(formData, "reason");
  for (const p of plan) await prisma.replenishmentLine.update({ where: { id: p.lineId }, data: { qtyApproved: p.qty } });

  // an approved request becomes the loading document; its stock is reserved so nothing else can take it
  const load = await prisma.vanLoad.create({
    data: {
      vanId: req.vanId, warehouseId: wh.id, loadedBy: "Pending load", status: "pending_load", approvedBy: approver, decidedAt: new Date(),
      loadNumber: await nextNo("LD", () => prisma.vanLoad.count(), 5), replenishmentRequestId: id,
    },
  });
  for (const p of plan) {
    for (const pick of p.picks) {
      await prisma.vanLoadLine.create({ data: { vanLoadId: load.id, productId: p.productId, qty: pick.qty, qtyApproved: pick.qty, lotNumber: pick.lot } });
      await prisma.stockBalance.update({ where: { id: pick.rowId }, data: { qtyReserved: { increment: pick.qty } } });
    }
  }
  await prisma.replenishmentRequest.update({ where: { id }, data: { status: full ? "approved" : "partially_approved", decisionNote: note || null, decidedAt: new Date() } });
  await logAudit("ReplenishmentRequest", id, full ? "approve" : "partial_approve", `${full ? "Approved" : "Partly approved"} stock request ${req.requestNumber} — ${total} unit(s); loading document ${load.loadNumber}`);
  const rep = await prisma.user.findFirst({ where: { name: req.requestedBy, branchId: req.branchId } });
  if (rep) await notify({ userId: rep.id, title: full ? "Stock request approved" : "Stock request partly approved", body: `${req.requestNumber}: ${total} unit(s) approved${note ? ` — ${note}` : ""}`, link: SFA, kind: "info" });
  revalidatePath(back);
  revalidatePath("/branch/van-loading");
  go(back, "notice", `${req.requestNumber} ${full ? "approved" : "approved with reduced quantities"} — ${load.loadNumber} is ready for the warehouse to load.`);
}

// A van cannot be reloaded until the previous day's reconciliation is closed or formally carried over.
async function assertPreviousDayClosed(vanId: string, back: string) {
  const open = await prisma.vanReconciliation.findFirst({ where: { vanId, dayDate: { lt: dayStart() }, status: { in: ["pending_ack", "variance_open", "escalated"] } } });
  if (open) go(back, "error", `The previous day's end-of-day reconciliation for this van is still ${open.status.replace(/_/g, " ")}. Close it or carry it over before loading again.`);
}

export async function loadVan(formData: FormData) {
  await assertCan("van", "edit");
  const back = "/branch/van-loading";
  const id = str(formData, "vanLoadId");
  const load = await prisma.vanLoad.findUniqueOrThrow({ where: { id }, include: { lines: true, van: true } });
  if (load.status !== "pending_load") go(back, "error", "Stock can only be loaded against an approved request that is waiting to be loaded.");
  await assertPreviousDayClosed(load.vanId, back);
  const clerk = await actorName("Warehouse clerk");
  let anyVariance = false;
  const posts: { line: (typeof load.lines)[number]; qty: number }[] = [];
  for (const l of load.lines) {
    const qty = Math.max(0, intOf(formData, `loaded_${l.id}`));
    const approved = l.qtyApproved ?? l.qty;
    if (qty > approved) go(back, "error", "You cannot load more than the approved quantity.");
    if (qty !== approved) {
      anyVariance = true;
      if (!str(formData, `why_${l.id}`)) go(back, "error", "Give a reason for every line loaded differently from the approved quantity.");
    }
    posts.push({ line: l, qty });
  }
  // one posting: warehouse down and van up together, so the two never disagree
  for (const p of posts) {
    const row = await prisma.stockBalance.findFirst({ where: { warehouseId: load.warehouseId, productId: p.line.productId, lotNumber: p.line.lotNumber } });
    if (row) {
      await prisma.stockBalance.update({ where: { id: row.id }, data: { qtyReserved: Math.max(0, row.qtyReserved - (p.line.qtyApproved ?? p.line.qty)) } });
      if (p.qty > 0) await changeBalance(row.id, "good", -p.qty, { type: "van_load", refType: "VanLoad", refId: load.id, refNumber: load.loadNumber, userName: clerk, note: `To ${load.van.code}` });
    }
    if (p.qty > 0) {
      await addToLot({ locationType: "van", vanId: load.vanId }, p.line.productId, p.line.lotNumber, row?.expiryDate ?? null, "good", p.qty, { type: "van_load", refType: "VanLoad", refId: load.id, refNumber: load.loadNumber, userName: clerk, note: `From warehouse` });
    }
    await prisma.vanLoadLine.update({ where: { id: p.line.id }, data: { qty: p.qty, varianceReason: str(formData, `why_${p.line.id}`) || null } });
  }
  await prisma.vanLoad.update({ where: { id }, data: { status: "loaded", loadedBy: clerk, loadedAt: new Date(), varianceReason: anyVariance ? "Loaded quantity differs from approved — see lines" : null } });
  if (load.replenishmentRequestId) await prisma.replenishmentRequest.update({ where: { id: load.replenishmentRequestId }, data: { status: "fulfilled" } });
  await logAudit("VanLoad", id, "load", `Loaded ${load.loadNumber} onto ${load.van.code} (${posts.reduce((s, p) => s + p.qty, 0)} unit(s)); available to sell once the rep acknowledges`);
  if (load.van.assignedUserId) await notify({ userId: load.van.assignedUserId, title: "Van loaded — please confirm", body: `${load.loadNumber} is on ${load.van.code}. Confirm what you received to start selling it.`, link: SFA, kind: "action" });
  revalidatePath(back);
  revalidatePath("/branch/warehouse-stock");
  go(back, "notice", `${load.loadNumber} posted: warehouse stock reduced and ${load.van.code} increased in one step. It becomes sellable when the rep acknowledges it.`);
}

export async function cancelVanLoad(formData: FormData) {
  await assertCan("van", "edit");
  const id = str(formData, "vanLoadId");
  const load = await prisma.vanLoad.findUniqueOrThrow({ where: { id } });
  if (load.status !== "pending_load") go("/branch/van-loading", "error", "Only a load that is waiting can be cancelled.");
  await releaseLoadReservations(id);
  await prisma.vanLoad.update({ where: { id }, data: { status: "cancelled" } });
  if (load.replenishmentRequestId) await prisma.replenishmentRequest.update({ where: { id: load.replenishmentRequestId }, data: { status: "cancelled", decisionNote: "Loading cancelled by the warehouse" } });
  await logAudit("VanLoad", id, "cancel", `Cancelled loading document ${load.loadNumber}`);
  revalidatePath("/branch/van-loading");
  redirect("/branch/van-loading");
}

// ===========================================================================
// SFA — acknowledge the load (the rep confirms what actually arrived)
// ===========================================================================

export async function acknowledgeVanLoad(formData: FormData) {
  const back = SFA;
  const id = str(formData, "vanLoadId");
  const load = await prisma.vanLoad.findUniqueOrThrow({ where: { id }, include: { lines: true, van: true } });
  if (load.confirmedAt) go(back, "error", "This load was already acknowledged.");
  if (!["loaded", "approved"].includes(load.status)) go(back, "error", "This load has not been posted by the warehouse yet.");
  const user = await actorName("Sales rep");
  let short = 0;
  for (const l of load.lines) {
    const recv = Math.max(0, intOf(formData, `recv_${l.id}`));
    if (recv > l.qty) go(back, "error", "You cannot confirm more than the warehouse loaded.");
    if (recv < l.qty && !str(formData, `why_${l.id}`)) go(back, "error", "Give a reason (for example Short Supplied) for every line that differs.");
    await prisma.vanLoadLine.update({ where: { id: l.id }, data: { qtyAcknowledged: recv, ackReason: str(formData, `why_${l.id}`) || null } });
    if (recv < l.qty) {
      // the missing units were never physically on the van — they go back on the warehouse record
      short += l.qty - recv;
      const vrow = await prisma.stockBalance.findFirst({ where: { locationType: "van", vanId: load.vanId, productId: l.productId, lotNumber: l.lotNumber } });
      if (vrow) await changeBalance(vrow.id, "good", -(l.qty - recv), { type: "van_return", refType: "VanLoad", refId: id, refNumber: load.loadNumber, userName: user, note: "Short supplied at loading" });
      const wrow = await prisma.stockBalance.findFirst({ where: { warehouseId: load.warehouseId, productId: l.productId, lotNumber: l.lotNumber } });
      await addToLot({ locationType: "warehouse", warehouseId: load.warehouseId }, l.productId, l.lotNumber, wrow?.expiryDate ?? null, "good", l.qty - recv, { type: "van_return", refType: "VanLoad", refId: id, refNumber: load.loadNumber, userName: user, note: "Short supplied at loading" });
    }
  }
  await prisma.vanLoad.update({ where: { id }, data: { confirmedAt: new Date(), status: "loaded" } });
  await logAudit("VanLoad", id, "acknowledge", `Rep confirmed receipt of ${load.loadNumber}${short ? ` — ${short} unit(s) short supplied, reported to the warehouse supervisor` : ""}`, undefined, { source: "sfa" });
  if (short) await notify({ role: "supervisor", branchId: load.van.branchId, title: "Load short supplied", body: `${load.loadNumber}: rep confirmed ${short} unit(s) fewer than loaded`, link: "/branch/van-loading", kind: "alert" });
  revalidatePath(back);
  go(back, "notice", short ? `Receipt confirmed — ${short} unit(s) were short and were reported to the warehouse supervisor. The rest is now available to sell.` : "Receipt confirmed — the stock is now available to sell.");
}

// ===========================================================================
// SFA — damage marking, returns (unloading), counts
// ===========================================================================

export async function markVanDamaged(formData: FormData) {
  const { van } = await repAndVan(SFA);
  const rowId = str(formData, "stockBalanceId");
  const qty = intOf(formData, "qty");
  const reason = str(formData, "reason");
  const s = await getAllSettings();
  if (qty <= 0) go(SFA, "error", "Enter the quantity affected.");
  if (!reason) go(SFA, "error", "Choose a reason (broken, leaking, expired, crushed packaging, customer return).");
  const row = await prisma.stockBalance.findUniqueOrThrow({ where: { id: rowId }, include: { product: true } });
  if (row.vanId !== van.id) go(SFA, "error", "That stock is not on your van.");
  if (qty > row.qtyGood) go(SFA, "error", `Only ${row.qtyGood} good unit(s) are on the van for that lot.`);
  const photo = str(formData, "photoData");
  if (qty >= num(s, "van.damagePhotoQty") && !photo) go(SFA, "error", `A photo is required when ${num(s, "van.damagePhotoQty")} or more units are marked damaged.`);
  const user = await actorName("Sales rep");
  const bucket = reason === "Expired" ? "expired" : "damaged";
  await changeBalance(rowId, "good", -qty, { type: "damage", refType: "StockBalance", refId: rowId, userName: user, note: reason });
  await changeBalance(rowId, bucket, qty, { type: "damage", refType: "StockBalance", refId: rowId, userName: user, note: reason });
  await prisma.stockDamageEvent.create({ data: { stockBalanceId: rowId, qty, direction: "good_to_bad", reason, photoPlaceholder: !!photo, createdBy: user } });
  if (photo) await prisma.photo.create({ data: { linkedType: "damage", linkedId: rowId, photoType: "damaged_stock", caption: `${row.product.name} × ${qty} — ${reason}`, dataUrl: photo, uploadedBy: user } });
  await logAudit("StockBalance", rowId, "damage", `Marked ${qty} × ${row.product.name} ${bucket} on ${van.code} — ${reason}`, undefined, { source: "sfa" });
  revalidatePath(SFA);
  go(SFA, "notice", `${qty} unit(s) moved to ${bucket} stock — they can no longer be sold.`);
}

// Reversing a damage marking needs supervisor approval.
export async function requestVanDamageReversal(formData: FormData) {
  await repAndVan(SFA);
  const rowId = str(formData, "stockBalanceId");
  const qty = intOf(formData, "qty");
  const from = (str(formData, "from") || "damaged") as "damaged" | "expired";
  const reason = str(formData, "reason");
  if (qty <= 0 || !reason) go(SFA, "error", "Enter the quantity and the reason the stock is fine after all.");
  const row = await prisma.stockBalance.findUniqueOrThrow({ where: { id: rowId }, include: { product: true, van: true } });
  const have = from === "damaged" ? row.qtyDamaged : row.qtyExpired;
  if (qty > have) go(SFA, "error", `Only ${have} unit(s) are marked ${from}.`);
  const user = await actorName("Sales rep");
  await prisma.approvalRequest.create({
    data: {
      type: "stock_reclass", refId: rowId, requestedBy: user, amount: qty, branchId: row.van?.branchId,
      reason: `${row.van?.code}: move ${qty} × ${row.product.name} from ${from} back to good — ${reason}`,
      payload: JSON.stringify({ qty, from, to: "good", reason }),
    },
  });
  await notify({ role: "supervisor", branchId: row.van?.branchId, title: "Damage reversal awaiting approval", body: `${row.product.name} × ${qty}`, link: "/supervisor/approvals", kind: "approval" });
  revalidatePath(SFA);
  go(SFA, "notice", "Reversing a damage marking needs supervisor approval — the request was sent.");
}

export async function initiateVanReturn(formData: FormData) {
  const { van, rep } = await repAndVan(SFA);
  const rows = await prisma.stockBalance.findMany({ where: { locationType: "van", vanId: van.id }, include: { product: true } });
  const wh = await prisma.warehouse.findFirst({ where: { branchId: van.branchId, type: "saleable", status: "active" } });
  if (!wh) go(SFA, "error", "The branch has no active warehouse.");
  const reason = str(formData, "reason") || "Unsold";
  const returnNumber = await nextNo("VR", () => prisma.vanReturn.count(), 5);
  let n = 0;
  for (const r of rows) {
    for (const cond of ["good", "damaged", "expired"] as const) {
      const q = intOf(formData, `${cond}_${r.id}`);
      if (q <= 0) continue;
      const have = cond === "good" ? r.qtyGood : cond === "damaged" ? r.qtyDamaged : r.qtyExpired;
      if (q > have) go(SFA, "error", `${r.product.name}: only ${have} unit(s) are ${cond} on the van — a return cannot exceed the van balance.`);
      await prisma.vanReturn.create({
        data: { returnNumber, vanId: van.id, warehouseId: wh.id, productId: r.productId, lotNumber: r.lotNumber, qty: q, qtyDeclared: q, condition: cond, reason, status: "initiated", returnedBy: rep.name },
      });
      n++;
    }
  }
  if (n === 0) go(SFA, "error", "Enter the quantity you are handing back for at least one product.");
  await logAudit("VanReturn", returnNumber, "initiate", `Initiated van return ${returnNumber} from ${van.code} (${n} line(s)) — ${reason}`, undefined, { source: "sfa" });
  await notify({ role: "branch_ops", branchId: van.branchId, title: "Van return to receive", body: `${returnNumber} from ${van.code}`, link: "/branch/van-returns", kind: "action" });
  revalidatePath(SFA);
  go(SFA, "notice", `${returnNumber} created — hand the goods to the warehouse clerk, who will count and confirm them.`);
}

// ===========================================================================
// DMS — receive van returns; resolve variances
// ===========================================================================

export async function receiveVanReturn(formData: FormData) {
  await assertCan("van", "edit");
  const back = "/branch/van-returns";
  const returnNumber = str(formData, "returnNumber");
  const lines = await prisma.vanReturn.findMany({ where: { returnNumber, status: "initiated" } });
  if (lines.length === 0) go(back, "error", "That return was already received.");
  const clerk = await actorName("Warehouse clerk");
  let variances = 0;
  for (const l of lines) {
    const declared = l.qtyDeclared ?? l.qty;
    const recv = Math.max(0, intOf(formData, `recv_${l.id}`));
    const why = str(formData, `why_${l.id}`);
    if (recv !== declared && !why) go(back, "error", "A difference between the declared and counted quantity needs a reason.");
    const bucket = l.condition === "damaged" ? "damaged" : l.condition === "expired" ? "expired" : "good";
    const vrow = await prisma.stockBalance.findFirst({ where: { locationType: "van", vanId: l.vanId, productId: l.productId, lotNumber: l.lotNumber } });
    const ref = { type: "van_return", refType: "VanReturn", refId: l.id, refNumber: returnNumber, userName: clerk, note: `Return of ${l.condition} stock` };
    // the van gives up what the rep declared; the warehouse is credited with what was counted
    if (vrow) await changeBalance(vrow.id, bucket, -declared, ref);
    if (recv > 0) await addToLot({ locationType: "warehouse", warehouseId: l.warehouseId }, l.productId, l.lotNumber, vrow?.expiryDate ?? null, bucket, recv, ref);
    if (recv !== declared) variances++;
    await prisma.vanReturn.update({ where: { id: l.id }, data: { qtyReceived: recv, varianceReason: why || null, receivedBy: clerk, status: recv === declared ? "closed" : "variance_pending" } });
  }
  await logAudit("VanReturn", returnNumber, "receive", `Received van return ${returnNumber}${variances ? ` with ${variances} variance(s) pending review` : ""}`);
  if (variances) await notify({ role: "supervisor", title: "Van return variance", body: `${returnNumber}: declared and counted quantities differ`, link: "/branch/van-returns", kind: "alert" });
  revalidatePath(back);
  revalidatePath("/branch/warehouse-stock");
  go(back, "notice", `${returnNumber} received — good stock is back in saleable inventory; damaged and expired stock went to the non-saleable buckets.`);
}

export async function closeReturnVariance(formData: FormData) {
  await assertCan("van", "approve");
  const id = str(formData, "id");
  const note = str(formData, "note");
  if (!note) go("/branch/van-returns", "error", "Record how the variance was explained.");
  const l = await prisma.vanReturn.findUniqueOrThrow({ where: { id } });
  await prisma.vanReturn.update({ where: { id }, data: { status: "closed", varianceReason: `${l.varianceReason ?? ""} — reviewed: ${note}` } });
  await logAudit("VanReturn", id, "close", `Closed return variance on ${l.returnNumber} — ${note}`);
  revalidatePath("/branch/van-returns");
  redirect("/branch/van-returns");
}

// ===========================================================================
// Van stock counts and the end-of-day reconciliation
// ===========================================================================

interface CountEntry {
  rowId: string;
  productId: string;
  lotNumber: string;
  systemGood: number;
  systemDamaged: number;
  good: number;
  damaged: number;
  remark: string | null;
}

async function storeVanCount(vanId: string, countedBy: string, countType: string, blind: boolean, entries: CountEntry[]) {
  const count = await prisma.vanStockCount.create({ data: { vanId, countedBy, countType, blind } });
  for (const e of entries) {
    await prisma.vanStockCountLine.create({
      data: { countId: count.id, productId: e.productId, lotNumber: e.lotNumber, systemGood: e.systemGood, systemDamaged: e.systemDamaged, countedGood: e.good, countedDamaged: e.damaged, variance: e.good - e.systemGood, remark: e.remark },
    });
  }
  return count;
}

async function readCountForm(vanId: string, formData: FormData, back: string, tol: number) {
  const rows = await prisma.stockBalance.findMany({ where: { locationType: "van", vanId } });
  const entries: CountEntry[] = [];
  for (const r of rows) {
    const g = formData.get(`cg_${r.id}`);
    if (g === null || g === "") go(back, "error", "Enter a counted quantity for every product — enter 0 where none is left.");
    const good = Math.max(0, Math.floor(Number(g)));
    const damaged = Math.max(0, Math.floor(Number(formData.get(`cd_${r.id}`) ?? r.qtyDamaged)));
    const remark = str(formData, `why_${r.id}`) || null;
    if (Math.abs(good - r.qtyGood) > tol && !remark) go(back, "error", "A variance beyond the tolerance needs a remark on that line.");
    entries.push({ rowId: r.id, productId: r.productId, lotNumber: r.lotNumber, systemGood: r.qtyGood, systemDamaged: r.qtyDamaged, good, damaged, remark });
  }
  return entries;
}

// Builds (or refreshes) the end-of-day reconciliation from a closing count.
async function prepareReconciliation(vanId: string, entries: CountEntry[], countedBy: string) {
  const s = await getAllSettings();
  const tol = num(s, "van.eodToleranceUnits");
  const day = dayStart();
  const existing = await prisma.vanReconciliation.findUnique({ where: { vanId_dayDate: { vanId, dayDate: day } } });
  if (existing?.status === "closed") return existing;
  const figures = await vanDayFigures(vanId, day);
  const byProduct = new Map<string, { counted: number; expected: number }>();
  for (const e of entries) {
    const cur = byProduct.get(e.productId) ?? { counted: 0, expected: 0 };
    cur.counted += e.good;
    cur.expected += e.systemGood;
    byProduct.set(e.productId, cur);
  }
  const lines = [...byProduct.entries()].map(([productId, v]) => {
    const f = figures.find((x) => x.productId === productId) ?? { opening: v.expected, loaded: 0, sold: 0, returned: 0, adjusted: 0 };
    const variance = v.counted - v.expected;
    const outcome = variance === 0 ? "none" : Math.abs(variance) <= tol ? "within_tolerance" : variance < 0 ? "shortage" : "excess";
    return { productId, opening: f.opening, loaded: f.loaded, sold: f.sold, returned: f.returned, adjusted: f.adjusted, expected: v.expected, counted: v.counted, variance, outcome };
  });
  const status = lines.every((l) => l.outcome === "none") ? "closed" : lines.every((l) => l.outcome === "none" || l.outcome === "within_tolerance") ? "pending_ack" : "variance_open";
  const rec = existing
    ? await prisma.vanReconciliation.update({ where: { id: existing.id }, data: { status, countedBy, closedAt: status === "closed" ? new Date() : null } })
    : await prisma.vanReconciliation.create({ data: { vanId, dayDate: day, status, countedBy, closedAt: status === "closed" ? new Date() : null } });
  await prisma.vanReconciliationLine.deleteMany({ where: { reconciliationId: rec.id } });
  for (const l of lines) await prisma.vanReconciliationLine.create({ data: { reconciliationId: rec.id, ...l } });
  return rec;
}

// Any count from the device (start of day, mid-day, end of day, spot).
export async function submitVanCount(formData: FormData) {
  const { van, rep } = await repAndVan(SFA);
  const s = await getAllSettings();
  const tol = num(s, "van.eodToleranceUnits");
  const countType = str(formData, "countType") || "spot";
  const entries = await readCountForm(van.id, formData, SFA, tol);
  const count = await storeVanCount(van.id, rep.name, countType, formData.get("blind") === "on", entries);
  const off = entries.filter((e) => Math.abs(e.good - e.systemGood) > tol);
  await logAudit("VanStockCount", count.id, "count", `${countType.replace(/_/g, " ")} count on ${van.code}: ${off.length} line(s) beyond tolerance`, undefined, { source: "sfa" });
  if (off.length) await notify({ role: "supervisor", branchId: van.branchId, title: "Van count variance", body: `${van.code}: ${off.length} line(s) beyond tolerance`, link: "/branch/eod-reconciliation", kind: "alert" });
  if (countType === "end_of_day") await prepareReconciliation(van.id, entries, rep.name);
  revalidatePath(SFA);
  go(SFA, "notice", `Count saved${off.length ? ` — ${off.length} line(s) beyond tolerance were reported to your supervisor` : " — no variance"}. A submitted count is final; a recount is a separate transaction.`);
}

// The branch clerk can also enter the closing count for a van from the DMS.
export async function recordVanClosingCount(formData: FormData) {
  await assertCan("van", "edit");
  const back = "/branch/eod-reconciliation";
  const vanId = str(formData, "vanId");
  const tol = num(await getAllSettings(), "van.eodToleranceUnits");
  const entries = await readCountForm(vanId, formData, `${back}?van=${vanId}`, tol);
  const clerk = await actorName("Warehouse clerk");
  const count = await storeVanCount(vanId, clerk, "end_of_day", false, entries);
  const rec = await prepareReconciliation(vanId, entries, clerk);
  await logAudit("VanReconciliation", rec.id, "prepare", `Closing count entered for the van; reconciliation is ${rec.status.replace(/_/g, " ")}`, { after: { countId: count.id } });
  revalidatePath(back);
  go(`${back}?van=${vanId}`, "notice", rec.status === "closed" ? "No variance — the van is closed automatically." : `Reconciliation ${rec.status.replace(/_/g, " ")}.`);
}

export async function acknowledgeReconciliation(formData: FormData) {
  await assertCan("van", "approve");
  const id = str(formData, "id");
  const rec = await prisma.vanReconciliation.findUniqueOrThrow({ where: { id } });
  if (rec.status !== "pending_ack") return;
  const user = await actorName("Supervisor");
  await prisma.vanReconciliation.update({ where: { id }, data: { status: "closed", approvedBy: user, closedAt: new Date(), cause: "Variance within tolerance — acknowledged" } });
  await logAudit("VanReconciliation", id, "acknowledge", "Supervisor acknowledged a within-tolerance variance; van closed");
  revalidatePath("/branch/eod-reconciliation");
  redirect(`/branch/eod-reconciliation?van=${rec.vanId}`);
}

// Shortage beyond tolerance: the supervisor records the cause and approves a stock adjustment (or escalates);
// an excess is investigated and corrected with an approved entry.
export async function resolveReconciliation(formData: FormData) {
  await assertCan("van", "approve");
  const id = str(formData, "id");
  const action = str(formData, "action"); // adjust | escalate | carry_over
  const cause = str(formData, "cause");
  const rec = await prisma.vanReconciliation.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  const back = `/branch/eod-reconciliation?van=${rec.vanId}`;
  if (!["variance_open", "escalated"].includes(rec.status)) go(back, "error", "This reconciliation has nothing left to resolve.");
  if (!cause) go(back, "error", "Record the cause of the variance first.");
  const user = await actorName("Supervisor");
  if (user === rec.countedBy && action === "adjust") go(back, "error", "The person who counted cannot approve the adjustment — another approver must.");
  if (action === "escalate") {
    await prisma.vanReconciliation.update({ where: { id }, data: { status: "escalated", cause } });
    await logAudit("VanReconciliation", id, "escalate", `Escalated van variance to the branch manager — ${cause}`);
    await notify({ role: "admin", title: "Van variance escalated", body: cause, link: back, kind: "alert" });
    revalidatePath("/branch/eod-reconciliation");
    go(back, "notice", "Escalated to the branch manager.");
  }
  if (action === "carry_over") {
    await prisma.vanReconciliation.update({ where: { id }, data: { status: "carried_over", cause, approvedBy: user } });
    await logAudit("VanReconciliation", id, "carry_over", `Carried van variance over formally — ${cause}`);
    revalidatePath("/branch/eod-reconciliation");
    go(back, "notice", "The variance was carried over formally; the van may be reloaded and it stays on the exceptions list.");
  }
  // approve the adjustments: post the difference between the physical count and the system balance
  const van = await prisma.van.findUniqueOrThrow({ where: { id: rec.vanId } });
  for (const l of rec.lines.filter((x) => x.variance !== 0)) {
    const rows = await prisma.stockBalance.findMany({ where: { locationType: "van", vanId: rec.vanId, productId: l.productId }, orderBy: { qtyGood: "desc" } });
    if (rows.length === 0) continue;
    await changeBalance(rows[0].id, "good", l.variance, { type: "adjustment", refType: "VanReconciliation", refId: id, refNumber: `EOD-${rec.dayDate.toISOString().slice(0, 10)}`, userName: user, note: `${l.variance < 0 ? "Shortage" : "Excess"} — ${cause}` });
    await prisma.vanReconciliationLine.update({ where: { id: l.id }, data: { resolution: "approved_adjustment" } });
  }
  await prisma.vanReconciliation.update({ where: { id }, data: { status: "closed", cause, approvedBy: user, closedAt: new Date() } });
  await logAudit("VanReconciliation", id, "adjust", `Approved stock adjustment for ${van.code} variance — ${cause}`, { before: { status: rec.status }, after: { status: "closed" } });
  revalidatePath("/branch/eod-reconciliation");
  go(back, "notice", "Adjustment approved and posted with the reason and approver on record; the van is closed.");
}

// ===========================================================================
// SFA — end-of-day reconciliation (stock + cash)
// ===========================================================================

export async function submitMobileEod(formData: FormData) {
  const { van, rep } = await repAndVan("/sfa/eod");
  const s = await getAllSettings();
  const back = "/sfa/eod";
  const tol = num(s, "van.eodToleranceUnits");
  const entries = await readCountForm(van.id, formData, back, tol);

  // cash: collected today by this rep vs what is handed over
  const start = dayStart();
  const cash = await prisma.aRLedgerEntry.aggregate({ where: { type: "payment", method: "cash", collectedBy: rep.id, entryDate: { gte: start }, recStatus: { not: "reversed" } }, _sum: { amount: true } });
  const expectedCash = cash._sum.amount ?? 0;
  const declared = Number(str(formData, "cashDeclared") || expectedCash);
  const cashVar = declared - expectedCash;
  const cashReason = str(formData, "cashReason");
  if (Math.abs(cashVar) > num(s, "van.cashTolerance") && !cashReason) go(back, "error", `The cash difference of ₱${Math.abs(cashVar).toLocaleString()} needs a reason before the day can be closed.`);

  await storeVanCount(van.id, rep.name, "end_of_day", false, entries);
  const rec = await prepareReconciliation(van.id, entries, rep.name);
  const att = await prisma.attendance.findFirst({ where: { userId: rep.id, dayDate: { gte: start } }, orderBy: { startAt: "desc" } });
  if (att) await prisma.attendance.update({ where: { id: att.id }, data: { cashExpected: expectedCash, cashDeclared: declared, cashVarianceReason: cashReason || null, eodConfirmedAt: new Date() } });
  // cash handed in is marked so it can be matched to the branch cashier's deposit
  await prisma.aRLedgerEntry.updateMany({ where: { type: "payment", method: "cash", collectedBy: rep.id, entryDate: { gte: start }, depositStatus: "not_deposited" }, data: { depositStatus: "handed_in", depositedAt: new Date() } });
  await logAudit("VanReconciliation", rec.id, "submit", `${rep.name} submitted the end-of-day reconciliation: stock ${rec.status.replace(/_/g, " ")}, cash ${cashVar === 0 ? "matches" : `differs by ₱${cashVar.toLocaleString()}`}`, undefined, { source: "sfa" });
  if (rec.status !== "closed" || Math.abs(cashVar) > num(s, "van.cashTolerance")) {
    await notify({ role: "supervisor", branchId: van.branchId, title: "End-of-day variance", body: `${rep.name}/${van.code}: ${rec.status !== "closed" ? "stock variance" : ""}${Math.abs(cashVar) > num(s, "van.cashTolerance") ? ` cash ${cashVar > 0 ? "excess" : "shortage"} ₱${Math.abs(cashVar)}` : ""}`, link: "/branch/eod-reconciliation", kind: "alert" });
  }
  revalidatePath(back);
  go(back, "notice", rec.status === "closed" ? "Reconciliation submitted and the van is closed. Complete unloading and End Day." : "Reconciliation submitted — a supervisor will review the variance. You can unload and End Day.");
}
