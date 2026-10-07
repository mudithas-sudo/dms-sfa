"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { assertCan } from "@/lib/rbac";
import { getAllSettings, getNumberSetting, num } from "@/lib/settings";
import { sendMessage } from "@/lib/integration";
import { ADJUST_REASONS } from "@/lib/inventory-constants";
import { actorName, addToLot, availableOf, changeBalance, fefoLots, refreshPoStatus, type Bucket } from "@/lib/stock";

function fail(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
}
function ok(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(message)}`);
}
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const intOf = (f: FormData, k: string) => {
  const n = Math.floor(Number(f.get(k)));
  return Number.isFinite(n) ? n : 0;
};

// A branch user may only act on their own branch; head office (admin) may act on any.
async function assertBranchAccess(branchId: string, back: string) {
  const { role, branchId: mine } = await getSession();
  if (role === "admin") return;
  if (mine && mine !== branchId) fail(back, "That belongs to another branch. Branch users can act only on their own branch's data.");
}

async function nextNumber(prefix: string, count: () => Promise<number>, pad = 5) {
  return `${prefix}-${String((await count()) + 1).padStart(pad, "0")}`;
}

// ===========================================================================
// Purchasing & receiving
// ===========================================================================

export async function flagPoException(formData: FormData) {
  await assertCan("purchasing", "edit");
  const id = str(formData, "id");
  const reason = str(formData, "reason");
  if (!reason) fail(`/branch/purchase-orders`, "Enter the reason for the exception.");
  const po = await prisma.purchaseOrder.update({ where: { id }, data: { status: "exception", exceptionReason: reason } });
  await logAudit("PurchaseOrder", id, "exception", `Flagged ${po.poNumber} as an exception — ${reason}`);
  revalidatePath("/branch/purchase-orders");
  redirect("/branch/purchase-orders");
}

// Authorized users close or resolve an exception; a PO closed short keeps the shortage on record.
export async function closePurchaseOrder(formData: FormData) {
  await assertCan("purchasing", "edit");
  const id = str(formData, "id");
  const note = str(formData, "note");
  if (!note) fail(`/branch/purchase-orders`, "A closing note is required.");
  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  await assertBranchAccess(po.branchId, "/branch/purchase-orders");
  const updated = await refreshPoStatus(id, null);
  const closed = await prisma.purchaseOrder.update({ where: { id }, data: { status: "received", exceptionReason: `Closed: ${note}` } });
  await logAudit("PurchaseOrder", id, "close", `Closed ${po.poNumber} (${updated.status} → received) — ${note}`);
  revalidatePath("/branch/purchase-orders");
  redirect(`/branch/purchase-orders/${closed.id}`);
}

interface ParsedLine {
  productId: string;
  qtyExpected: number;
  qtyReceived: number;
  varianceReason: string | null;
  batches: { lot: string; mfg: Date | null; expiry: Date | null; qty: number }[];
}

// Reads the receiving screen: per PO line an actual quantity, a variance reason and — for
// lot/expiry tracked products — up to three batches whose quantities must add up to the actual.
async function parseReceiptForm(formData: FormData, purchaseOrderId: string, back: string): Promise<ParsedLine[]> {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId }, include: { lines: { include: { product: true } } } });
  const got = await receivedByProductSafe(purchaseOrderId);
  const today = new Date();
  const parsed: ParsedLine[] = [];
  for (const line of po.lines) {
    const outstanding = Math.max(0, line.qtyOrdered - (got.get(line.productId) ?? 0));
    const actual = intOf(formData, `qty_${line.id}`);
    if (actual < 0) fail(back, `${line.product.name}: quantity cannot be negative.`);
    const reason = str(formData, `reason_${line.id}`) || null;
    if (actual !== outstanding && actual > 0 && !reason) fail(back, `${line.product.name}: ${actual < outstanding ? "shortage" : "overage"} of ${Math.abs(outstanding - actual)} needs a variance reason.`);
    if (actual === 0) {
      if (outstanding > 0 && str(formData, `reason_${line.id}`)) parsed.push({ productId: line.productId, qtyExpected: outstanding, qtyReceived: 0, varianceReason: reason, batches: [] });
      continue;
    }
    const batches: ParsedLine["batches"] = [];
    if (line.product.hasExpiry) {
      for (let n = 0; n < 3; n++) {
        const lot = str(formData, `lot_${line.id}_${n}`);
        const q = intOf(formData, `bqty_${line.id}_${n}`);
        const expRaw = str(formData, `exp_${line.id}_${n}`);
        const mfgRaw = str(formData, `mfg_${line.id}_${n}`);
        if (!lot && !q && !expRaw) continue;
        if (!lot || q <= 0) fail(back, `${line.product.name}: batch ${n + 1} needs a batch number and a quantity.`);
        if (!expRaw) fail(back, `${line.product.name}: expiry date is mandatory for lot-tracked products (batch ${lot}).`);
        const expiry = new Date(expRaw);
        if (Number.isNaN(expiry.getTime()) || expiry <= today) fail(back, `${line.product.name}: expiry date of batch ${lot} must be later than today.`);
        batches.push({ lot, qty: q, expiry, mfg: mfgRaw ? new Date(mfgRaw) : null });
      }
      const sum = batches.reduce((s, b) => s + b.qty, 0);
      if (sum !== actual) fail(back, `${line.product.name}: batch quantities add up to ${sum} but the actual received quantity is ${actual}.`);
    } else {
      batches.push({ lot: "NO-LOT", qty: actual, expiry: null, mfg: null });
    }
    parsed.push({ productId: line.productId, qtyExpected: outstanding, qtyReceived: actual, varianceReason: reason, batches });
  }
  return parsed;
}

async function receivedByProductSafe(purchaseOrderId: string) {
  const grs = await prisma.goodsReceipt.findMany({ where: { purchaseOrderId, status: { in: ["posted", "reversed"] } }, include: { lines: true } });
  const m = new Map<string, number>();
  for (const g of grs) for (const l of g.lines) m.set(l.productId, (m.get(l.productId) ?? 0) + l.qtyReceived);
  return m;
}

// Post a (draft or reviewed) receipt: stock is added by SKU/lot/expiry, each stock row linked to the
// receipt and PO it came from, the PO status updated, and the ERP told. Stock never changes from a draft.
async function postReceipt(receiptId: string, poster: string) {
  const gr = await prisma.goodsReceipt.findUniqueOrThrow({ where: { id: receiptId }, include: { lines: true, purchaseOrder: true } });
  const warehouse = await prisma.warehouse.findUniqueOrThrow({ where: { id: gr.warehouseId } });
  for (const l of gr.lines) {
    if (l.qtyReceived <= 0) continue;
    await addToLot({ locationType: "warehouse", warehouseId: gr.warehouseId }, l.productId, l.lotNumber, l.expiryDate, "good", l.qtyReceived, {
      type: "receipt", refType: "GoodsReceipt", refId: gr.id, refNumber: gr.grNumber, userName: poster, note: `PO ${gr.purchaseOrder.poNumber}`,
    }, l.id);
  }
  await prisma.goodsReceipt.update({ where: { id: receiptId }, data: { status: "posted", postedAt: new Date() } });

  // Variance beyond tolerance flags the PO as an exception; otherwise the status follows the receipts.
  const settings = await getAllSettings();
  const expected = gr.lines.reduce((s, l) => s + l.qtyExpected, 0);
  const variance = gr.lines.reduce((s, l) => s + Math.abs(l.qtyReceived - l.qtyExpected), 0);
  const beyond = expected > 0 && (variance / expected) * 100 > num(settings, "gr.tolerancePct");
  await refreshPoStatus(gr.purchaseOrderId, beyond ? `Receipt ${gr.grNumber} varied by ${variance} unit(s) from the expected quantity` : null);
  await sendMessage({ connector: "erp", direction: "outbound", docType: "goods_receipt", reference: gr.grNumber, payload: { po: gr.purchaseOrder.poNumber, warehouse: warehouse.name } });
  await logAudit("GoodsReceipt", gr.id, "post", `Posted receipt ${gr.grNumber} against ${gr.purchaseOrder.poNumber} into ${warehouse.name}`, { after: { lines: gr.lines.map((l) => ({ sku: l.productId, lot: l.lotNumber, qty: l.qtyReceived })) } }, { branchId: warehouse.branchId });
}

export async function saveGoodsReceipt(formData: FormData) {
  await assertCan("purchasing", "edit");
  const purchaseOrderId = str(formData, "purchaseOrderId");
  const warehouseId = str(formData, "warehouseId");
  const intent = str(formData, "intent") || "post"; // draft | post
  const existingId = str(formData, "receiptId");
  const back = `/branch/purchase-orders/${purchaseOrderId}/receive`;
  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId }, include: { branch: true } });
  await assertBranchAccess(po.branchId, back);

  // Goods can be received only against an open PO, into an active warehouse of the same branch, for an active branch.
  if (po.status === "cancelled" || po.status === "received") fail(back, "This purchase order is closed — goods can be received only against an open order.");
  if (po.branch.status !== "active") fail(back, "The branch is inactive and cannot receive stock.");
  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse || warehouse.branchId !== po.branchId || warehouse.status !== "active") fail(back, "Choose an active warehouse of the receiving branch.");

  const lines = await parseReceiptForm(formData, purchaseOrderId, back);
  if (lines.every((l) => l.qtyReceived === 0)) fail(back, "Enter the quantity actually received for at least one line.");

  const receiver = await actorName("Branch Ops");
  const attachments: { filename: string; docType: string; description: string | null }[] = [];
  for (let i = 0; i < 3; i++) {
    const f = formData.get(`file_${i}`);
    if (f instanceof File && f.size > 0) attachments.push({ filename: f.name, docType: str(formData, `docType_${i}`) || "delivery_receipt", description: str(formData, `docDesc_${i}`) || null });
  }

  let receiptId = existingId;
  if (existingId) {
    const current = await prisma.goodsReceipt.findUniqueOrThrow({ where: { id: existingId } });
    if (current.status !== "draft") fail(back, "Only a draft receipt can be edited.");
    await prisma.goodsReceiptLine.deleteMany({ where: { goodsReceiptId: existingId } });
  } else {
    const gr = await prisma.goodsReceipt.create({
      data: { grNumber: await nextNumber("GR", () => prisma.goodsReceipt.count()), purchaseOrderId, warehouseId, receivedBy: receiver, status: "draft" },
    });
    receiptId = gr.id;
  }
  for (const l of lines) {
    if (l.batches.length === 0) {
      await prisma.goodsReceiptLine.create({ data: { goodsReceiptId: receiptId, productId: l.productId, qtyExpected: l.qtyExpected, qtyReceived: 0, lotNumber: "-", varianceReason: l.varianceReason } });
      continue;
    }
    for (const [i, b] of l.batches.entries()) {
      await prisma.goodsReceiptLine.create({
        data: {
          goodsReceiptId: receiptId, productId: l.productId, qtyExpected: i === 0 ? l.qtyExpected : 0, qtyReceived: b.qty,
          lotNumber: b.lot, expiryDate: b.expiry, manufacturingDate: b.mfg, varianceReason: i === 0 ? l.varianceReason : null,
        },
      });
    }
  }
  for (const a of attachments) {
    await prisma.goodsReceiptAttachment.create({ data: { goodsReceiptId: receiptId, filename: a.filename, docType: a.docType, description: a.description, uploadedBy: receiver } });
  }
  const hasAtt = (await prisma.goodsReceiptAttachment.count({ where: { goodsReceiptId: receiptId } })) > 0;
  await prisma.goodsReceipt.update({ where: { id: receiptId }, data: { warehouseId, hasAttachment: hasAtt, attachmentFilename: attachments[0]?.filename } });

  const gr = await prisma.goodsReceipt.findUniqueOrThrow({ where: { id: receiptId } });
  if (intent === "draft") {
    await logAudit("GoodsReceipt", receiptId, "draft", `Saved draft receipt ${gr.grNumber} for ${po.poNumber}`);
    ok(`/branch/purchase-orders/${purchaseOrderId}`, `Draft ${gr.grNumber} saved — stock is not changed until it is posted.`);
  }

  // Tolerance: a receipt that varies too much is held for supervisor review before it posts.
  const tol = await getNumberSetting("gr.tolerancePct");
  const expected = lines.reduce((s, l) => s + l.qtyExpected, 0);
  const variance = lines.reduce((s, l) => s + Math.abs(l.qtyReceived - l.qtyExpected), 0);
  if (expected > 0 && (variance / expected) * 100 > tol) {
    await prisma.goodsReceipt.update({ where: { id: receiptId }, data: { status: "pending_review", varianceNote: `Variance ${variance} unit(s) (${((variance / expected) * 100).toFixed(1)}%) exceeds the ${tol}% tolerance` } });
    await logAudit("GoodsReceipt", receiptId, "hold", `Receipt ${gr.grNumber} held for supervisor review — variance beyond tolerance`);
    await notify({ role: "branch_ops", branchId: po.branchId, title: "Receipt awaiting review", body: `${gr.grNumber} varies by ${variance} unit(s).`, link: `/branch/purchase-orders/${purchaseOrderId}`, kind: "approval" });
    ok(`/branch/purchase-orders/${purchaseOrderId}`, `${gr.grNumber} varies beyond the ${tol}% tolerance, so it is held for review before posting.`);
  }
  await postReceipt(receiptId, receiver);
  revalidatePath("/branch/purchase-orders");
  revalidatePath("/branch/warehouse-stock");
  ok(`/branch/purchase-orders/${purchaseOrderId}`, `${gr.grNumber} posted — stock added with full traceability to ${po.poNumber}.`);
}

// Post a saved draft.
export async function postGoodsReceipt(formData: FormData) {
  await assertCan("purchasing", "edit");
  const id = str(formData, "id");
  const gr = await prisma.goodsReceipt.findUniqueOrThrow({ where: { id }, include: { purchaseOrder: true, lines: true } });
  const back = `/branch/purchase-orders/${gr.purchaseOrderId}`;
  await assertBranchAccess(gr.purchaseOrder.branchId, back);
  if (gr.status !== "draft") fail(back, "Only a draft can be posted.");
  if (gr.purchaseOrder.status === "cancelled" || gr.purchaseOrder.status === "received") fail(back, "The purchase order is closed.");
  const tol = await getNumberSetting("gr.tolerancePct");
  const expected = gr.lines.reduce((s, l) => s + l.qtyExpected, 0);
  const variance = gr.lines.reduce((s, l) => s + Math.abs(l.qtyReceived - l.qtyExpected), 0);
  if (expected > 0 && (variance / expected) * 100 > tol) {
    await prisma.goodsReceipt.update({ where: { id }, data: { status: "pending_review", varianceNote: `Variance ${variance} unit(s) exceeds the ${tol}% tolerance` } });
    ok(back, `${gr.grNumber} is held for supervisor review — variance beyond tolerance.`);
  }
  await postReceipt(id, await actorName("Branch Ops"));
  revalidatePath("/branch/warehouse-stock");
  ok(back, `${gr.grNumber} posted.`);
}

export async function reviewGoodsReceipt(formData: FormData) {
  await assertCan("inventory", "approve");
  const id = str(formData, "id");
  const decision = str(formData, "decision"); // approved | rejected
  const gr = await prisma.goodsReceipt.findUniqueOrThrow({ where: { id }, include: { purchaseOrder: true } });
  const back = `/branch/purchase-orders/${gr.purchaseOrderId}`;
  const reviewer = await actorName("Supervisor");
  if (gr.status !== "pending_review") fail(back, "This receipt is not awaiting review.");
  if (reviewer === gr.receivedBy) fail(back, "The person who recorded the receipt cannot review it.");
  if (decision === "approved") {
    await prisma.goodsReceipt.update({ where: { id }, data: { reviewedBy: reviewer } });
    await postReceipt(id, reviewer);
    ok(back, `${gr.grNumber} approved and posted.`);
  }
  await prisma.goodsReceipt.update({ where: { id }, data: { status: "cancelled", reviewedBy: reviewer } });
  await logAudit("GoodsReceipt", id, "reject", `Rejected receipt ${gr.grNumber} after review`);
  ok(back, `${gr.grNumber} rejected — no stock was posted.`);
}

export async function cancelGoodsReceipt(formData: FormData) {
  await assertCan("purchasing", "edit");
  const id = str(formData, "id");
  const gr = await prisma.goodsReceipt.findUniqueOrThrow({ where: { id } });
  if (gr.status !== "draft") fail(`/branch/purchase-orders/${gr.purchaseOrderId}`, "Only drafts can be cancelled; a posted receipt is corrected by a reversal.");
  await prisma.goodsReceipt.update({ where: { id }, data: { status: "cancelled" } });
  await logAudit("GoodsReceipt", id, "cancel", `Cancelled draft receipt ${gr.grNumber}`);
  revalidatePath("/branch/purchase-orders");
  redirect(`/branch/purchase-orders/${gr.purchaseOrderId}`);
}

// A posted receipt is never edited: a linked reversing receipt takes the stock back out.
export async function reverseGoodsReceipt(formData: FormData) {
  await assertCan("inventory", "approve");
  const id = str(formData, "id");
  const reason = str(formData, "reason");
  const gr = await prisma.goodsReceipt.findUniqueOrThrow({ where: { id }, include: { lines: true, purchaseOrder: true } });
  const back = `/branch/purchase-orders/${gr.purchaseOrderId}`;
  if (!reason) fail(back, "A reason is required to reverse a receipt.");
  if (gr.status !== "posted") fail(back, "Only a posted receipt can be reversed.");
  await assertBranchAccess(gr.purchaseOrder.branchId, back);
  // the stock must still be there to take back out
  for (const l of gr.lines) {
    if (l.qtyReceived <= 0) continue;
    const row = await prisma.stockBalance.findFirst({ where: { warehouseId: gr.warehouseId, productId: l.productId, lotNumber: l.lotNumber } });
    if (!row || availableOf(row) < l.qtyReceived) fail(back, `Cannot reverse: lot ${l.lotNumber} no longer has ${l.qtyReceived} units available (some were already sold or moved).`);
  }
  const user = await actorName("Branch Ops");
  const rev = await prisma.goodsReceipt.create({
    data: { grNumber: await nextNumber("GR", () => prisma.goodsReceipt.count()), purchaseOrderId: gr.purchaseOrderId, warehouseId: gr.warehouseId, receivedBy: user, status: "posted", postedAt: new Date(), reversalOfId: gr.id, varianceNote: `Reversal of ${gr.grNumber}: ${reason}` },
  });
  for (const l of gr.lines) {
    if (l.qtyReceived <= 0) continue;
    await prisma.goodsReceiptLine.create({ data: { goodsReceiptId: rev.id, productId: l.productId, qtyExpected: 0, qtyReceived: -l.qtyReceived, lotNumber: l.lotNumber, expiryDate: l.expiryDate } });
    const row = await prisma.stockBalance.findFirst({ where: { warehouseId: gr.warehouseId, productId: l.productId, lotNumber: l.lotNumber } });
    if (row) await changeBalance(row.id, "good", -l.qtyReceived, { type: "receipt_reversal", refType: "GoodsReceipt", refId: rev.id, refNumber: rev.grNumber, userName: user, note: `Reverses ${gr.grNumber}: ${reason}` });
  }
  await prisma.goodsReceipt.update({ where: { id }, data: { status: "reversed" } });
  await refreshPoStatus(gr.purchaseOrderId, null);
  await sendMessage({ connector: "erp", direction: "outbound", docType: "goods_receipt_reversal", reference: rev.grNumber });
  await logAudit("GoodsReceipt", id, "reverse", `Reversed receipt ${gr.grNumber} with ${rev.grNumber} — ${reason}`, { before: { status: "posted" }, after: { status: "reversed", reversal: rev.grNumber } });
  revalidatePath("/branch/warehouse-stock");
  ok(back, `${gr.grNumber} reversed by ${rev.grNumber}; the original stays on record.`);
}

// ===========================================================================
// Physical and cycle stock count
// ===========================================================================

export async function startStockCount(formData: FormData) {
  await assertCan("inventory", "edit");
  const warehouseId = str(formData, "warehouseId");
  const type = str(formData, "type") === "cycle" ? "cycle" : "full";
  const category = str(formData, "category");
  const blind = formData.get("blind") === "on";
  const back = "/branch/stock-count";
  const wh = await prisma.warehouse.findUniqueOrThrow({ where: { id: warehouseId } });
  await assertBranchAccess(wh.branchId, back);
  const open = await prisma.stockCount.count({ where: { warehouseId, status: { in: ["open", "recount_required"] } } });
  if (open) fail(back, "This warehouse already has a count in progress — finish it first.");

  const rows = await prisma.stockBalance.findMany({ where: { warehouseId, ...(category ? { product: { category } } : {}) }, include: { product: true } });
  if (rows.length === 0) fail(back, "No stock lots match that scope.");
  const tolRaw = str(formData, "tolerancePct");
  const count = await prisma.stockCount.create({
    data: {
      warehouseId, countedBy: await actorName("Branch Ops"), status: "open", type, blind,
      scope: category ? `Category: ${category}` : "All SKUs",
      tolerancePct: tolRaw ? Number(tolRaw) : null, snapshotAt: new Date(),
    },
  });
  for (const r of rows) {
    await prisma.stockCountLine.create({ data: { stockCountId: count.id, productId: r.productId, lotNumber: r.lotNumber, systemQty: r.qtyGood, countedQty: 0, variance: 0 } });
  }
  await logAudit("StockCount", count.id, "start", `Started ${type} count at ${wh.name} (${category || "all SKUs"}, ${blind ? "blind" : "system quantities shown"}) — snapshot of ${rows.length} lot(s)`);
  revalidatePath("/branch/stock-count");
  redirect(`/branch/stock-count?count=${count.id}`);
}

async function countTolerance(count: { tolerancePct: number | null }) {
  return count.tolerancePct ?? (await getNumberSetting("count.tolerancePct"));
}

const beyond = (variance: number, systemQty: number, tolPct: number) => Math.abs(variance) > Math.max(1, Math.round((systemQty * tolPct) / 100));

// Post approved variances as stock adjustments with the Count variance reason code. The change is
// applied relative to the snapshot, so sales or receipts during the count do not distort the result.
async function postCountVariances(countId: string, approver: string) {
  const count = await prisma.stockCount.findUniqueOrThrow({ where: { id: countId }, include: { lines: true } });
  for (const l of count.lines) {
    const finalQty = l.recountQty ?? l.countedQty;
    const delta = finalQty - l.systemQty;
    if (delta === 0) continue;
    await prisma.stockAdjustment.create({
      data: {
        warehouseId: count.warehouseId, productId: l.productId, lotNumber: l.lotNumber, qtyDelta: delta, reasonCode: "count_variance",
        status: "approved", requestedBy: count.countedBy, approvedBy: approver, decidedAt: new Date(), notes: `Stock count ${count.id.slice(-6)} variance`,
      },
    });
    const row = await prisma.stockBalance.findFirst({ where: { warehouseId: count.warehouseId, productId: l.productId, lotNumber: l.lotNumber } });
    if (row) await changeBalance(row.id, "good", delta, { type: "count", refType: "StockCount", refId: count.id, userName: approver, note: `Count variance ${delta > 0 ? "+" : ""}${delta}` });
  }
}

export async function submitStockCount(formData: FormData) {
  await assertCan("inventory", "edit");
  const countId = str(formData, "countId");
  const back = `/branch/stock-count?count=${countId}`;
  const count = await prisma.stockCount.findUniqueOrThrow({ where: { id: countId }, include: { lines: true } });
  if (count.status !== "open") fail(back, "This count is no longer open for entry.");
  const tol = await countTolerance(count);
  let needsRecount = 0;
  for (const l of count.lines) {
    const raw = formData.get(`counted_${l.id}`);
    if (raw === null || raw === "") fail(back, "Enter a counted quantity for every line (enter 0 where nothing was found).");
    const counted = Math.max(0, Math.floor(Number(raw)));
    const variance = counted - l.systemQty;
    if (beyond(variance, l.systemQty, tol)) needsRecount++;
    await prisma.stockCountLine.update({ where: { id: l.id }, data: { countedQty: counted, variance } });
  }
  if (needsRecount > 0) {
    await prisma.stockCount.update({ where: { id: countId }, data: { status: "recount_required" } });
    await logAudit("StockCount", countId, "recount", `Count entered: ${needsRecount} line(s) above the ${tol}% tolerance need a recount`);
    ok(back, `${needsRecount} line(s) are above the ${tol}% tolerance — please recount them.`);
  }
  await postCountVariances(countId, "Auto-accepted (within tolerance)");
  await prisma.stockCount.update({ where: { id: countId }, data: { status: "closed", approvedBy: "Auto-accepted (within tolerance)" } });
  await logAudit("StockCount", countId, "close", `Count closed — all variances within the ${tol}% tolerance and posted as stock adjustments`);
  revalidatePath("/branch/warehouse-stock");
  ok("/branch/stock-count", "Count closed: every variance was within tolerance and was posted as a stock adjustment.");
}

export async function submitRecount(formData: FormData) {
  await assertCan("inventory", "edit");
  const countId = str(formData, "countId");
  const back = `/branch/stock-count?count=${countId}`;
  const count = await prisma.stockCount.findUniqueOrThrow({ where: { id: countId }, include: { lines: true } });
  if (count.status !== "recount_required") fail(back, "This count is not waiting for a recount.");
  const tol = await countTolerance(count);
  let stillOut = 0;
  for (const l of count.lines) {
    if (!beyond(l.variance, l.systemQty, tol)) continue;
    const raw = formData.get(`recount_${l.id}`);
    if (raw === null || raw === "") fail(back, "Enter the recounted quantity for every flagged line.");
    const recount = Math.max(0, Math.floor(Number(raw)));
    if (beyond(recount - l.systemQty, l.systemQty, tol)) stillOut++;
    await prisma.stockCountLine.update({ where: { id: l.id }, data: { recountQty: recount, recountReason: str(formData, `why_${l.id}`) || null } });
  }
  if (stillOut > 0) {
    await prisma.stockCount.update({ where: { id: countId }, data: { status: "pending_approval" } });
    await logAudit("StockCount", countId, "review", `Recount done: ${stillOut} line(s) still above tolerance — sent for supervisor review`);
    await notify({ role: "supervisor", title: "Count variance needs review", body: `${stillOut} line(s) remain above tolerance after recount.`, link: "/branch/stock-count", kind: "approval" });
    ok("/branch/stock-count", `${stillOut} line(s) are still above tolerance after the recount, so the count is sent for supervisor review.`);
  }
  await postCountVariances(countId, "Auto-accepted after recount");
  await prisma.stockCount.update({ where: { id: countId }, data: { status: "closed", approvedBy: "Auto-accepted after recount" } });
  revalidatePath("/branch/warehouse-stock");
  ok("/branch/stock-count", "Recount brought every line within tolerance — the count is closed and posted.");
}

export async function decideStockCount(formData: FormData) {
  await assertCan("inventory", "approve");
  const stockCountId = str(formData, "stockCountId");
  const decision = str(formData, "decision");
  const approver = await actorName("Manager");
  const count = await prisma.stockCount.findUniqueOrThrow({ where: { id: stockCountId } });
  if (count.status !== "pending_approval") return;
  if (approver === count.countedBy) fail("/branch/stock-count", "The person who counted cannot approve the variances.");
  if (decision === "approved") await postCountVariances(stockCountId, approver);
  await prisma.stockCount.update({ where: { id: stockCountId }, data: { status: decision === "approved" ? "closed" : "rejected", approvedBy: approver } });
  await logAudit("StockCount", stockCountId, decision === "approved" ? "approve" : "reject", `${decision === "approved" ? "Approved and posted" : "Rejected"} count variances`);
  revalidatePath("/branch/stock-count");
  revalidatePath("/branch/warehouse-stock");
  redirect("/branch/stock-count");
}

export async function saveCycleSchedule(formData: FormData) {
  await assertCan("inventory", "approve");
  const categories = (await prisma.product.findMany({ distinct: ["category"], select: { category: true } })).map((c) => c.category);
  for (const c of categories) {
    const raw = str(formData, `freq_${c}`);
    const key = `count.cycle.${c}`;
    if (raw === "" || Number(raw) <= 0) await prisma.appSetting.deleteMany({ where: { key } });
    else await prisma.appSetting.upsert({ where: { key }, update: { value: String(Math.floor(Number(raw))) }, create: { key, value: String(Math.floor(Number(raw))) } });
  }
  await logAudit("Settings", "count.cycle", "update", "Updated the cycle-count schedule");
  revalidatePath("/branch/stock-count");
  ok("/branch/stock-count", "Cycle-count schedule saved.");
}

// ===========================================================================
// Good / bad stock segregation
// ===========================================================================

const BAD: Bucket[] = ["damaged", "expired", "quarantine"];

export async function reclassifyStock(formData: FormData) {
  await assertCan("inventory", "edit");
  const rowId = str(formData, "stockBalanceId");
  const qty = intOf(formData, "qty");
  const from = str(formData, "from") as Bucket;
  const to = str(formData, "to") as Bucket;
  const reason = str(formData, "reason");
  const back = str(formData, "back") || "/branch/warehouse-stock";
  if (qty <= 0) fail(back, "Enter a quantity to move.");
  if (!reason) fail(back, "A reason is required for every reclassification.");
  if (from === to || !["good", ...BAD].includes(from) || !["good", ...BAD].includes(to)) fail(back, "Choose two different stock categories.");
  const row = await prisma.stockBalance.findUniqueOrThrow({ where: { id: rowId }, include: { product: true, warehouse: true } });
  if (row.warehouseId && row.warehouse) await assertBranchAccess(row.warehouse.branchId, back);
  const have = from === "good" ? row.qtyGood - row.qtyReserved : from === "damaged" ? row.qtyDamaged : from === "expired" ? row.qtyExpired : row.qtyQuarantine;
  if (qty > have) fail(back, `Only ${have} unit(s) of ${row.product.name} lot ${row.lotNumber} are in ${from} stock.`);
  const user = await actorName("Branch Ops");

  // Moving stock back from bad to good needs supervisor approval (e.g. after a quality re-check).
  if (BAD.includes(from) && to === "good") {
    await prisma.approvalRequest.create({
      data: {
        type: "stock_reclass", refId: rowId, requestedBy: user, amount: qty, branchId: row.warehouse?.branchId,
        reason: `Move ${qty} × ${row.product.name} (lot ${row.lotNumber}) from ${from} back to good — ${reason}`,
        payload: JSON.stringify({ qty, from, to, reason }),
      },
    });
    await notify({ role: "supervisor", branchId: row.warehouse?.branchId, title: "Reclassification awaiting approval", body: `${row.product.name}: ${qty} units bad → good`, link: "/supervisor/approvals", kind: "approval" });
    await logAudit("StockBalance", rowId, "reclass_request", `Requested bad → good reclassification of ${qty} × ${row.product.name} — ${reason}`);
    ok(back, "Moving bad stock back to good needs supervisor approval — the request was sent.");
  }
  await applyReclass(rowId, qty, from, to, reason, user);
  revalidatePath("/branch/warehouse-stock");
  ok(back, `${qty} unit(s) moved from ${from} to ${to} and logged.`);
}

export async function applyReclass(rowId: string, qty: number, from: Bucket, to: Bucket, reason: string, user: string) {
  const ref = { type: "reclass", refType: "StockBalance", refId: rowId, userName: user, note: reason };
  await changeBalance(rowId, from, -qty, ref);
  const row = await changeBalance(rowId, to, qty, ref);
  await prisma.stockDamageEvent.create({
    data: { stockBalanceId: rowId, qty, direction: to === "good" ? "bad_to_good" : "good_to_bad", reason: `${from} → ${to}: ${reason}`, createdBy: user },
  });
  await logAudit("StockBalance", rowId, "reclass", `Reclassified ${qty} unit(s) ${from} → ${to} (${reason})`, { before: { from }, after: { to, balanceNow: row.qtyGood } });
}

// Lots past their expiry leave sellable stock: moved to Expired automatically or on confirmation, as configured.
export async function moveExpiredStock(formData: FormData) {
  await assertCan("inventory", "edit");
  const back = "/branch/near-expiry";
  const { branchId } = await getSession();
  const only = str(formData, "stockBalanceId");
  const rows = await prisma.stockBalance.findMany({
    where: { locationType: "warehouse", expiryDate: { lt: new Date() }, qtyGood: { gt: 0 }, ...(only ? { id: only } : {}), ...(branchId ? { warehouse: { branchId } } : {}) },
    include: { product: true },
  });
  const user = await actorName("Branch Ops");
  let n = 0;
  for (const r of rows) {
    const move = r.qtyGood - r.qtyReserved;
    if (move <= 0) continue;
    await applyReclass(r.id, move, "good", "expired", "Expiry date reached", user);
    n += move;
  }
  revalidatePath("/branch/near-expiry");
  revalidatePath("/branch/warehouse-stock");
  ok(back, n ? `${n} expired unit(s) moved out of sellable stock.` : "Nothing to move.");
}

// ===========================================================================
// Opening stock balances (batch upload, approval, then locked)
// ===========================================================================

function parseCsvLine(line: string) {
  return line.split(",").map((c) => c.trim());
}

export async function submitOpeningBalance(formData: FormData) {
  await assertCan("inventory", "edit");
  const warehouseId = str(formData, "warehouseId");
  const back = "/branch/opening-balance";
  const wh = await prisma.warehouse.findUniqueOrThrow({ where: { id: warehouseId } });
  await assertBranchAccess(wh.branchId, back);
  if (wh.status !== "active") fail(back, "That warehouse is inactive.");
  const asOf = new Date(str(formData, "asOfDate") || new Date().toISOString().slice(0, 10));

  let text = str(formData, "csv");
  let filename: string | null = null;
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    text = await file.text();
    filename = file.name;
  }
  // single-line entry (the on-screen form) is turned into a one-line batch
  if (!text && str(formData, "sku")) text = `${str(formData, "sku")},${str(formData, "category") || "good"},${str(formData, "lot")},${str(formData, "expiry")},${str(formData, "qty")},${str(formData, "unitCost")}`;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^sku\b/i.test(l));
  if (lines.length === 0) fail(back, "Add at least one line: SKU, category, lot, expiry, quantity, unit cost.");

  const products = await prisma.product.findMany();
  const priorBatches = await prisma.openingBalanceBatch.findMany({ where: { warehouseId, status: "approved" }, include: { lines: true } });
  const alreadyPosted = new Set(priorBatches.flatMap((b) => b.lines.filter((l) => l.result === "ok").map((l) => l.productId)));
  const seen = new Set<string>();
  const parsed = lines.map((raw, i) => {
    const [sku, cat, lot, expRaw, qtyRaw, costRaw] = parseCsvLine(raw);
    const p = products.find((x) => x.sku === sku);
    const qty = Number(qtyRaw);
    const category = (cat || "good").toLowerCase();
    let message: string | null = null;
    if (!p) message = `Unknown SKU "${sku}"`;
    else if (p.status !== "active") message = `SKU ${sku} is not active`;
    else if (!Number.isInteger(qty) || qty <= 0) message = "Quantity must be a whole number above zero";
    else if (!["good", "bad"].includes(category)) message = `Category must be good or bad (got "${cat}")`;
    else if (p.hasExpiry && !lot) message = "Lot number is mandatory for lot-tracked SKUs";
    else if (p.hasExpiry && (!expRaw || Number.isNaN(new Date(expRaw).getTime()))) message = "A valid expiry date is mandatory for expiry-tracked SKUs";
    else if (seen.has(`${sku}|${lot}|${category}`)) message = "Duplicate line (same SKU, lot and category)";
    else if (alreadyPosted.has(p.id)) message = "An opening balance was already posted for this SKU — later corrections go through a stock adjustment";
    seen.add(`${sku}|${lot}|${category}`);
    return { lineNo: i + 1, sku, productId: p?.id ?? null, category, lotNumber: lot || (p && !p.hasExpiry ? "NO-LOT" : null), expiryDate: expRaw && !Number.isNaN(new Date(expRaw).getTime()) ? new Date(expRaw) : null, qty: Number.isFinite(qty) ? Math.trunc(qty) : 0, unitCost: costRaw ? Number(costRaw) : null, result: message ? "error" : "ok", message };
  });
  const okLines = parsed.filter((l) => l.result === "ok").length;
  const batch = await prisma.openingBalanceBatch.create({
    data: { warehouseId, filename, asOfDate: asOf, uploadedBy: await actorName("Branch Ops"), status: okLines > 0 ? "pending" : "rejected", lines: { create: parsed } },
  });
  await logAudit("OpeningBalanceBatch", batch.id, "upload", `Uploaded opening balance for ${wh.name}: ${okLines} valid line(s), ${parsed.length - okLines} rejected`);
  if (okLines > 0) await notify({ role: "branch_ops", branchId: wh.branchId, title: "Opening balance awaiting approval", body: `${okLines} line(s) for ${wh.name}`, link: "/branch/opening-balance", kind: "approval" });
  revalidatePath("/branch/opening-balance");
  redirect(`/branch/opening-balance?batch=${batch.id}`);
}

export async function decideOpeningBalance(formData: FormData) {
  await assertCan("inventory", "approve");
  const id = str(formData, "id");
  const decision = str(formData, "decision");
  const back = `/branch/opening-balance?batch=${id}`;
  const batch = await prisma.openingBalanceBatch.findUniqueOrThrow({ where: { id }, include: { lines: true, } });
  if (batch.status !== "pending") fail(back, "This batch is no longer pending.");
  const approver = await actorName("Manager");
  if (approver === batch.uploadedBy) fail(back, "The uploader cannot approve their own opening balance — the branch manager or a head office controller must.");
  if (decision === "approved") {
    for (const l of batch.lines.filter((x) => x.result === "ok" && x.productId)) {
      await addToLot({ locationType: "warehouse", warehouseId: batch.warehouseId }, l.productId!, l.lotNumber ?? "NO-LOT", l.expiryDate, l.category === "bad" ? "damaged" : "good", l.qty, {
        type: "opening", refType: "OpeningBalanceBatch", refId: batch.id, refNumber: `OB-${batch.id.slice(-6)}`, userName: approver, note: `As of ${batch.asOfDate.toISOString().slice(0, 10)}`,
      });
    }
  }
  await prisma.openingBalanceBatch.update({ where: { id }, data: { status: decision === "approved" ? "approved" : "rejected", approvedBy: approver, decidedAt: new Date() } });
  await logAudit("OpeningBalanceBatch", id, decision === "approved" ? "approve" : "reject", `${decision === "approved" ? "Approved and locked" : "Rejected"} opening balance batch`);
  revalidatePath("/branch/opening-balance");
  revalidatePath("/branch/warehouse-stock");
  ok(back, decision === "approved" ? "Opening balance approved and posted — it is now locked; later changes go through stock adjustments." : "Opening balance rejected.");
}

// ===========================================================================
// Stock transfers (request → approve → dispatch → in transit → receive)
// ===========================================================================

export async function requestStockTransfer(formData: FormData) {
  await assertCan("inventory", "edit");
  const back = "/branch/stock-transfers";
  const fromWarehouseId = str(formData, "fromWarehouseId");
  const toWarehouseId = str(formData, "toWarehouseId");
  const productId = str(formData, "productId");
  const qty = intOf(formData, "qty");
  if (!fromWarehouseId || !toWarehouseId || fromWarehouseId === toWarehouseId) fail(back, "Choose two different warehouses.");
  if (qty <= 0) fail(back, "Enter a quantity above zero.");
  const [from, to, product] = await Promise.all([
    prisma.warehouse.findUniqueOrThrow({ where: { id: fromWarehouseId } }),
    prisma.warehouse.findUniqueOrThrow({ where: { id: toWarehouseId } }),
    prisma.product.findUniqueOrThrow({ where: { id: productId } }),
  ]);
  await assertBranchAccess(from.branchId, back);
  if (from.status !== "active" || to.status !== "active") fail(back, "Both warehouses must be active.");
  if (from.type !== "saleable") fail(back, "Only good (saleable) stock can be transferred; bad stock follows the returns process.");

  const lotNumber = str(formData, "lotNumber");
  const lots = await fefoLots(fromWarehouseId, productId, 0);
  const lot = lotNumber ? lots.find((l) => l.lotNumber === lotNumber) : lots.find((l) => availableOf(l) >= qty) ?? lots[0];
  if (!lot || availableOf(lot) < qty) fail(back, `Only ${lot ? availableOf(lot) : 0} unit(s) of ${product.name} are available (good and not allocated to open orders).`);
  const value = qty * product.unitPrice;
  const limit = await getNumberSetting("transfer.managerMaxValue");
  const t = await prisma.stockTransfer.create({
    data: { fromWarehouseId, toWarehouseId, productId, lotNumber: lot.lotNumber, qty, requestedBy: await actorName("Branch Ops"), approverRole: value > limit ? "head_office" : "branch_manager", notes: str(formData, "notes") || null },
  });
  await logAudit("StockTransfer", t.id, "request", `Requested transfer of ${qty} × ${product.name} from ${from.name} to ${to.name} (₱${value.toLocaleString()}, approver: ${t.approverRole})`, { after: t });
  await notify({ role: "branch_ops", branchId: to.branchId, title: "Stock transfer awaiting approval", body: `${qty} × ${product.name} from ${from.name}`, link: "/branch/stock-transfers", kind: "approval" });
  revalidatePath(back);
  ok(back, `Transfer requested — ${t.approverRole === "head_office" ? "its value exceeds the branch limit, so head office must approve" : "awaiting the receiving branch's manager"}.`);
}

export async function decideStockTransfer(formData: FormData) {
  await assertCan("inventory", "approve");
  const back = "/branch/stock-transfers";
  const id = str(formData, "id");
  const decision = str(formData, "decision");
  const { role } = await getSession();
  const approver = await actorName("Manager");
  const t = await prisma.stockTransfer.findUniqueOrThrow({ where: { id }, include: { toWarehouse: true, product: true } });
  if (t.status !== "pending") return;
  if (approver === t.requestedBy) fail(back, "You requested this transfer, so another manager must approve it.");
  if (t.approverRole === "head_office" && role !== "admin") fail(back, "This transfer exceeds the branch approval limit — head office must approve it.");
  await assertBranchAccess(t.toWarehouse.branchId, back);
  if (decision === "approved") {
    const row = await prisma.stockBalance.findFirst({ where: { warehouseId: t.fromWarehouseId, productId: t.productId, lotNumber: t.lotNumber } });
    if (!row || availableOf(row) < t.qty) fail(back, "The source lot no longer has enough available stock.");
    await prisma.stockTransfer.update({ where: { id }, data: { status: "approved", approvedBy: approver, decidedAt: new Date() } });
  } else {
    await prisma.stockTransfer.update({ where: { id }, data: { status: "rejected", approvedBy: approver, decidedAt: new Date() } });
  }
  await logAudit("StockTransfer", id, decision === "approved" ? "approve" : "reject", `${decision === "approved" ? "Approved" : "Rejected"} transfer of ${t.qty} × ${t.product.name}`);
  revalidatePath(back);
  redirect(back);
}

// Dispatch: the quantity leaves the sender's available stock and is shown as in transit.
export async function dispatchStockTransfer(formData: FormData) {
  await assertCan("inventory", "edit");
  const back = "/branch/stock-transfers";
  const id = str(formData, "id");
  const t = await prisma.stockTransfer.findUniqueOrThrow({ where: { id }, include: { fromWarehouse: true, product: true } });
  await assertBranchAccess(t.fromWarehouse.branchId, back);
  if (t.status !== "approved") fail(back, "Only an approved transfer can be dispatched.");
  const row = await prisma.stockBalance.findFirst({ where: { warehouseId: t.fromWarehouseId, productId: t.productId, lotNumber: t.lotNumber } });
  if (!row || availableOf(row) < t.qty) fail(back, "The source lot no longer has enough available stock.");
  const user = await actorName("Branch Ops");
  await changeBalance(row.id, "good", -t.qty, { type: "transfer_out", refType: "StockTransfer", refId: t.id, refNumber: `TR-${t.id.slice(-6)}`, userName: user, note: "Dispatched — in transit" });
  await prisma.stockTransfer.update({ where: { id }, data: { status: "in_transit", dispatchedAt: new Date() } });
  await logAudit("StockTransfer", id, "dispatch", `Dispatched ${t.qty} × ${t.product.name} — now in transit (cannot be edited; corrections use a reversing transfer)`);
  revalidatePath(back);
  revalidatePath("/branch/warehouse-stock");
  redirect(back);
}

export async function receiveStockTransfer(formData: FormData) {
  await assertCan("inventory", "edit");
  const back = "/branch/stock-transfers";
  const id = str(formData, "id");
  const t = await prisma.stockTransfer.findUniqueOrThrow({ where: { id }, include: { toWarehouse: true, product: true } });
  await assertBranchAccess(t.toWarehouse.branchId, back);
  if (t.status !== "in_transit") fail(back, "Only a transfer in transit can be received.");
  const received = Math.max(0, intOf(formData, "qtyReceived"));
  const note = str(formData, "note");
  if (received > t.qty) fail(back, "You cannot receive more than was dispatched.");
  if (received < t.qty && !note) fail(back, "Record the shortage or damage reason when receiving less than was dispatched.");
  const user = await actorName("Branch Ops");
  const source = await prisma.stockBalance.findFirst({ where: { warehouseId: t.fromWarehouseId, productId: t.productId, lotNumber: t.lotNumber } });
  if (received > 0) {
    await addToLot({ locationType: "warehouse", warehouseId: t.toWarehouseId }, t.productId, t.lotNumber, source?.expiryDate ?? null, "good", received, { type: "transfer_in", refType: "StockTransfer", refId: t.id, refNumber: `TR-${t.id.slice(-6)}`, userName: user });
  }
  const discrepancy = received !== t.qty;
  await prisma.stockTransfer.update({ where: { id }, data: { status: discrepancy ? "discrepancy" : "completed", qtyReceived: received, receivedBy: user, receivedAt: new Date(), discrepancyNote: discrepancy ? note : null } });
  await logAudit("StockTransfer", id, discrepancy ? "discrepancy" : "receive", `Received ${received} of ${t.qty} × ${t.product.name}${discrepancy ? ` — discrepancy: ${note}` : ""}`);
  if (discrepancy) await notify({ role: "branch_ops", title: "Transfer discrepancy", body: `${t.product.name}: ${received} of ${t.qty} received`, link: "/branch/stock-transfers", kind: "alert" });
  revalidatePath(back);
  revalidatePath("/branch/warehouse-stock");
  redirect(back);
}

export async function closeTransferDiscrepancy(formData: FormData) {
  await assertCan("inventory", "approve");
  const id = str(formData, "id");
  const note = str(formData, "note");
  if (!note) fail("/branch/stock-transfers", "Enter how the discrepancy was resolved.");
  const t = await prisma.stockTransfer.findUniqueOrThrow({ where: { id } });
  if (t.status !== "discrepancy") return;
  await prisma.stockTransfer.update({ where: { id }, data: { status: "completed", discrepancyNote: `${t.discrepancyNote} — resolved: ${note}` } });
  await logAudit("StockTransfer", id, "resolve", `Closed transfer discrepancy — ${note}`);
  revalidatePath("/branch/stock-transfers");
  redirect("/branch/stock-transfers");
}

// A dispatched or completed transfer is never edited; a reversing transfer sends it back.
export async function reverseStockTransfer(formData: FormData) {
  await assertCan("inventory", "edit");
  const back = "/branch/stock-transfers";
  const id = str(formData, "id");
  const t = await prisma.stockTransfer.findUniqueOrThrow({ where: { id }, include: { product: true } });
  if (t.status !== "completed") fail(back, "Only a completed transfer can be reversed.");
  const received = t.qtyReceived ?? t.qty;
  const dest = await prisma.stockBalance.findFirst({ where: { warehouseId: t.toWarehouseId, productId: t.productId, lotNumber: t.lotNumber } });
  if (!dest || availableOf(dest) < received) fail(back, "The destination no longer holds that stock, so it cannot be reversed.");
  const rev = await prisma.stockTransfer.create({
    data: { fromWarehouseId: t.toWarehouseId, toWarehouseId: t.fromWarehouseId, productId: t.productId, lotNumber: t.lotNumber, qty: received, requestedBy: await actorName("Branch Ops"), approverRole: t.approverRole, reversalOfId: t.id, notes: `Reversal of TR-${t.id.slice(-6)}` },
  });
  await logAudit("StockTransfer", rev.id, "request", `Requested reversing transfer for TR-${t.id.slice(-6)}`);
  revalidatePath(back);
  ok(back, "A reversing transfer was raised and now follows the normal approval.");
}

// ===========================================================================
// Stock adjustments (reason-coded, approved by size/value)
// ===========================================================================


export async function requestStockAdjustment(formData: FormData) {
  await assertCan("inventory", "edit");
  const back = "/branch/stock-adjustments";
  const [warehouseId, productId, lotChoice] = str(formData, "lotChoice").split("|");
  const qtyDelta = Math.trunc(Number(formData.get("qtyDelta")));
  const reasonCode = str(formData, "reasonCode");
  const notes = str(formData, "notes");
  const attachmentNote = str(formData, "attachmentNote") || null;
  const reason = ADJUST_REASONS.find((r) => r.id === reasonCode);
  if (!warehouseId || !productId) fail(back, "Select the product and lot to adjust.");
  if (!Number.isFinite(qtyDelta) || qtyDelta === 0) fail(back, "Enter a quantity change other than zero.");
  if (!reason) fail(back, "Choose a reason code.");
  if (reason.needsNote && !notes) fail(back, `A comment is mandatory for "${reason.label}".`);
  if (reasonCode === "loss_theft" && !attachmentNote) fail(back, "Loss or theft needs a supervisor comment and a reference to the attachment (e.g. incident report).");
  const wh = await prisma.warehouse.findUniqueOrThrow({ where: { id: warehouseId } });
  await assertBranchAccess(wh.branchId, back);
  const rows = await prisma.stockBalance.findMany({ where: { warehouseId, productId }, orderBy: { qtyGood: "desc" } });
  const row = lotChoice ? rows.find((r) => r.lotNumber === lotChoice) : rows[0];
  if (!row) fail(back, "That product has no stock lot in this warehouse. Use an opening balance to create one.");
  if (qtyDelta < 0 && -qtyDelta > row.qtyGood) fail(back, `Lot ${row.lotNumber} only has ${row.qtyGood} good unit(s).`);

  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  const value = Math.abs(qtyDelta) * product.unitPrice;
  const [supMax, mgrMax] = await Promise.all([getNumberSetting("adjust.supervisorMaxValue"), getNumberSetting("adjust.managerMaxValue")]);
  const approverRole = value <= supMax ? "warehouse_supervisor" : value <= mgrMax ? "branch_manager" : "head_office_controller";
  const a = await prisma.stockAdjustment.create({
    data: { warehouseId, productId, lotNumber: row.lotNumber, qtyDelta, reasonCode, notes, attachmentNote, approverRole, requestedBy: await actorName("Branch Ops") },
  });
  await logAudit("StockAdjustment", a.id, "request", `Requested adjustment of ${qtyDelta > 0 ? "+" : ""}${qtyDelta} × ${product.name} (${reason.label}, ₱${value.toLocaleString()}) — approver: ${approverRole.replace(/_/g, " ")}`, { after: a });
  await notify({ role: approverRole === "head_office_controller" ? "admin" : "branch_ops", branchId: approverRole === "head_office_controller" ? undefined : wh.branchId, title: "Stock adjustment awaiting approval", body: `${product.name} ${qtyDelta > 0 ? "+" : ""}${qtyDelta} (${reason.label})`, link: "/branch/stock-adjustments", kind: "approval" });
  revalidatePath(back);
  ok(back, `Adjustment requested — it needs approval by the ${approverRole.replace(/_/g, " ")}.`);
}

export async function decideStockAdjustment(formData: FormData) {
  await assertCan("inventory", "approve");
  const back = "/branch/stock-adjustments";
  const id = str(formData, "id");
  const decision = str(formData, "decision");
  const { role } = await getSession();
  const approver = await actorName("Manager");
  const a = await prisma.stockAdjustment.findUniqueOrThrow({ where: { id }, include: { product: true, warehouse: true } });
  if (a.status !== "pending") return;
  if (approver === a.requestedBy) fail(back, "You raised this adjustment, so another approver must decide it.");
  if (a.approverRole === "head_office_controller" && role !== "admin") fail(back, "This adjustment exceeds the branch manager's limit — a head office inventory controller must approve it.");
  await assertBranchAccess(a.warehouse.branchId, back);

  if (decision === "approved") {
    const row = await prisma.stockBalance.findFirst({ where: { warehouseId: a.warehouseId, productId: a.productId, lotNumber: a.lotNumber } });
    const ref = { type: "adjustment", refType: "StockAdjustment", refId: a.id, refNumber: `ADJ-${a.id.slice(-6)}`, userName: approver, note: a.reasonCode };
    if (row) {
      // Damage and expiry move quantity from good to the matching bad bucket instead of making it disappear.
      if (a.qtyDelta < 0 && (a.reasonCode === "damage" || a.reasonCode === "expiry")) {
        await changeBalance(row.id, "good", a.qtyDelta, ref);
        await changeBalance(row.id, a.reasonCode === "damage" ? "damaged" : "expired", -a.qtyDelta, ref);
      } else {
        await changeBalance(row.id, "good", a.qtyDelta, ref);
      }
    } else if (a.qtyDelta > 0) {
      await addToLot({ locationType: "warehouse", warehouseId: a.warehouseId }, a.productId, a.lotNumber, a.expiryDate, "good", a.qtyDelta, ref);
    }
  }
  await prisma.stockAdjustment.update({ where: { id }, data: { status: decision, approvedBy: approver, decidedAt: new Date() } });
  await logAudit("StockAdjustment", id, decision === "approved" ? "approve" : "reject", `${decision === "approved" ? "Approved" : "Rejected"} adjustment of ${a.qtyDelta} × ${a.product.name}`, { before: { status: "pending" }, after: { status: decision } });
  revalidatePath(back);
  revalidatePath("/branch/warehouse-stock");
  redirect(back);
}

// ===========================================================================
// Returns to the central warehouse (bad stock only) — posted to the ERP
// ===========================================================================

export async function requestCentralReturn(formData: FormData) {
  await assertCan("inventory", "edit");
  const back = "/branch/supplier-returns";
  const [warehouseId, productId, choiceLot] = str(formData, "lotChoice").split("|");
  const qty = intOf(formData, "qty");
  const reason = str(formData, "reason") || "damaged";
  const intent = str(formData, "intent") || "submit"; // draft | submit
  if (!warehouseId || !productId) fail(back, "Select the bad-stock lot to return.");
  if (qty <= 0) fail(back, "Enter a quantity above zero.");
  const wh = await prisma.warehouse.findUniqueOrThrow({ where: { id: warehouseId } });
  await assertBranchAccess(wh.branchId, back);

  // Only bad stock (damaged or expired) can go back; the lot must hold enough of that bucket.
  const bucket: "damaged" | "expired" = reason === "expired" ? "expired" : "damaged";
  const rows = await prisma.stockBalance.findMany({ where: { warehouseId, productId } });
  const source = choiceLot
    ? rows.find((r) => r.lotNumber === choiceLot && (bucket === "damaged" ? r.qtyDamaged : r.qtyExpired) >= qty)
    : rows.find((r) => (bucket === "damaged" ? r.qtyDamaged : r.qtyExpired) >= qty);
  if (!source) fail(back, `No lot holds ${qty} unit(s) of bad (${bucket}) stock for that product. Only bad stock can be returned — mark good stock as damaged or expired first.`);
  const files: string[] = [];
  for (let i = 0; i < 2; i++) {
    const f = formData.get(`file_${i}`);
    if (f instanceof File && f.size > 0) files.push(f.name);
  }
  const r = await prisma.supplierReturn.create({
    data: {
      returnNumber: await nextNumber("RTN", () => prisma.supplierReturn.count(), 4),
      warehouseId, productId, lotNumber: source.lotNumber, expiryDate: source.expiryDate, qty, reason, notes: str(formData, "notes") || null,
      status: intent === "draft" ? "draft" : "pending", requestedBy: await actorName("Branch Ops"), attachments: files.length ? JSON.stringify(files) : null,
    },
  });
  await logAudit("SupplierReturn", r.id, intent === "draft" ? "draft" : "request", `${intent === "draft" ? "Drafted" : "Requested"} return ${r.returnNumber} to the central warehouse (${qty} × lot ${source.lotNumber}, ${reason})`, { after: r });
  if (intent !== "draft") await notify({ role: "branch_ops", branchId: wh.branchId, title: "Return awaiting approval", body: `${r.returnNumber}: ${qty} units to the central warehouse`, link: back, kind: "approval" });
  revalidatePath(back);
  ok(back, `${r.returnNumber} ${intent === "draft" ? "saved as a draft" : "submitted for the branch manager's approval"}.`);
}

export async function submitCentralReturn(formData: FormData) {
  await assertCan("inventory", "edit");
  const id = str(formData, "id");
  const r = await prisma.supplierReturn.findUniqueOrThrow({ where: { id } });
  if (r.status !== "draft") return;
  await prisma.supplierReturn.update({ where: { id }, data: { status: "pending" } });
  await logAudit("SupplierReturn", id, "submit", `Submitted return ${r.returnNumber} for approval`);
  revalidatePath("/branch/supplier-returns");
  redirect("/branch/supplier-returns");
}

export async function decideSupplierReturn(formData: FormData) {
  await assertCan("inventory", "approve");
  const back = "/branch/supplier-returns";
  const id = str(formData, "id");
  const decision = str(formData, "decision"); // approved | rejected | cancelled
  const approver = await actorName("Manager");
  const r = await prisma.supplierReturn.findUniqueOrThrow({ where: { id } });
  if (r.status !== "pending") return;
  if (decision === "approved" && approver === r.requestedBy) fail(back, "You raised this return, so the branch manager must approve it.");
  if (decision === "rejected" && !str(formData, "reason")) fail(back, "A reason is required to reject a return.");
  await prisma.supplierReturn.update({ where: { id }, data: { status: decision, approvedBy: approver, decidedAt: new Date(), ...(decision === "rejected" ? { notes: `${r.notes ?? ""} Rejected: ${str(formData, "reason")}`.trim() } : {}) } });
  await logAudit("SupplierReturn", id, decision, `${decision === "approved" ? "Approved" : decision === "rejected" ? "Rejected" : "Cancelled"} return ${r.returnNumber}`);
  revalidatePath(back);
  redirect(back);
}

// Dispatch: only now does the branch's bad stock fall.
export async function dispatchCentralReturn(formData: FormData) {
  await assertCan("inventory", "edit");
  const back = "/branch/supplier-returns";
  const id = str(formData, "id");
  const r = await prisma.supplierReturn.findUniqueOrThrow({ where: { id } });
  if (r.status !== "approved") fail(back, "Only an approved return can be dispatched.");
  const bucket: Bucket = r.reason === "expired" ? "expired" : "damaged";
  const row = await prisma.stockBalance.findFirst({ where: { warehouseId: r.warehouseId, productId: r.productId, lotNumber: r.lotNumber } });
  if (!row || (bucket === "damaged" ? row.qtyDamaged : row.qtyExpired) < r.qty) fail(back, "The lot no longer holds that much bad stock.");
  await changeBalance(row.id, bucket, -r.qty, { type: "central_return", refType: "SupplierReturn", refId: r.id, refNumber: r.returnNumber, userName: await actorName("Branch Ops"), note: "Dispatched to the central warehouse" });
  await prisma.supplierReturn.update({ where: { id }, data: { status: "shipped", dispatchedAt: new Date() } });
  await logAudit("SupplierReturn", id, "dispatch", `Dispatched return ${r.returnNumber}; branch bad stock reduced by ${r.qty}`);
  revalidatePath(back);
  revalidatePath("/branch/warehouse-stock");
  redirect(back);
}

export async function receiveCentralReturn(formData: FormData) {
  await assertCan("inventory", "edit");
  const back = "/branch/supplier-returns";
  const id = str(formData, "id");
  const r = await prisma.supplierReturn.findUniqueOrThrow({ where: { id } });
  if (r.status !== "shipped") fail(back, "Only a return in transit can be received.");
  const received = Math.max(0, intOf(formData, "qtyReceived"));
  const note = str(formData, "note");
  if (received !== r.qty && !note) fail(back, "Record why the received quantity differs from what was sent.");
  await prisma.supplierReturn.update({ where: { id }, data: { status: "received", qtyReceived: received, receivedBy: await actorName("Central warehouse"), receivedAt: new Date(), discrepancyNote: received !== r.qty ? note : null } });
  await logAudit("SupplierReturn", id, "receive", `Central warehouse received ${received} of ${r.qty} for return ${r.returnNumber}${received !== r.qty ? ` — discrepancy: ${note}` : ""}`);
  await postReturnToErp(id);
  revalidatePath(back);
  redirect(back);
}

async function postReturnToErp(id: string) {
  const r = await prisma.supplierReturn.findUniqueOrThrow({ where: { id }, include: { product: true } });
  const msg = await sendMessage({ connector: "erp", direction: "outbound", docType: "central_return", reference: r.returnNumber ?? r.id, payload: { sku: r.product.sku, qty: r.qtyReceived ?? r.qty, lot: r.lotNumber, reason: r.reason } });
  if (msg.status === "ok") {
    await prisma.supplierReturn.update({ where: { id }, data: { status: "posted_to_erp", postedToErpAt: new Date(), erpReference: `ERP-${msg.id.slice(-6).toUpperCase()}`, erpError: null } });
  } else {
    await prisma.supplierReturn.update({ where: { id }, data: { erpError: msg.error } });
  }
}

export async function retryErpPosting(formData: FormData) {
  await assertCan("inventory", "edit");
  const id = str(formData, "id");
  await postReturnToErp(id);
  revalidatePath("/branch/supplier-returns");
  redirect("/branch/supplier-returns");
}
