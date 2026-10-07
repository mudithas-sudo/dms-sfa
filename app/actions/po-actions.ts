"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { assertCan } from "@/lib/rbac";
import { sendMessage } from "@/lib/integration";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const LIST = "/branch/purchase-orders";

function go(path: string, kind: "error" | "notice", message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
}

async function nextPoNumber() {
  const last = await prisma.purchaseOrder.findFirst({ orderBy: { poNumber: "desc" }, select: { poNumber: true } });
  const n = last ? Number(last.poNumber.replace(/\D/g, "")) : 0;
  return `PO-${String(n + 1).padStart(5, "0")}`;
}

// A purchase reference created at the branch (for example a local purchase that has no ERP order yet).
export async function createPurchaseOrder(formData: FormData) {
  await assertCan("purchasing", "edit");
  const { branchId, userId } = await getSession();
  const back = `${LIST}/new`;
  if (!branchId) go(back, "error", "Select a branch first.");
  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
  if (branch.status !== "active") go(back, "error", "This branch is inactive and cannot raise purchase orders.");
  const supplier = str(formData, "supplier");
  if (!supplier) go(back, "error", "Enter the supplier.");
  const expected = str(formData, "expectedDate") ? new Date(str(formData, "expectedDate")) : null;
  if (expected && expected < new Date(new Date().setHours(0, 0, 0, 0))) go(back, "error", "The expected delivery date cannot be in the past.");

  const lines: { productId: string; qty: number; cost: number }[] = [];
  for (let i = 1; i <= 10; i++) {
    const productId = str(formData, `product${i}`);
    const qty = Math.floor(Number(str(formData, `qty${i}`)));
    const cost = Number(str(formData, `cost${i}`));
    if (!productId && !qty) continue;
    if (!productId || !(qty > 0) || !(cost >= 0)) go(back, "error", `Line ${i}: choose a product, a quantity above zero and a unit cost.`);
    lines.push({ productId, qty, cost });
  }
  if (lines.length === 0) go(back, "error", "Add at least one product line.");
  if (new Set(lines.map((l) => l.productId)).size !== lines.length) go(back, "error", "A product appears on two lines — combine them.");

  const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
  const po = await prisma.purchaseOrder.create({
    data: {
      poNumber: await nextPoNumber(), branchId, supplier, expectedDate: expected, source: "manual", createdBy: user?.name,
      lines: { create: lines.map((l) => ({ productId: l.productId, qtyOrdered: l.qty, unitCost: l.cost })) },
    },
  });
  await logAudit("PurchaseOrder", po.id, "create", `Created purchase order ${po.poNumber} for ${supplier} (${lines.length} lines, ₱${lines.reduce((s, l) => s + l.qty * l.cost, 0).toLocaleString()})`, { after: { supplier, lines: lines.length } });
  await sendMessage({ connector: "erp", direction: "outbound", docType: "purchase_order_reference", reference: po.poNumber, payload: { supplier, lines: lines.length } });
  revalidatePath(LIST);
  go(`${LIST}/${po.id}`, "notice", `${po.poNumber} created. The reference was sent to the ERP; receiving works exactly as for an ERP order.`);
}

// Stands in for the ERP purchase-order interface: delivers a few orders to the branch, one of which has a problem
// (an SKU the DMS does not know) and goes to the exception queue instead of being accepted blindly.
export async function receiveErpPurchaseOrders() {
  await assertCan("purchasing", "edit");
  const { branchId } = await getSession();
  if (!branchId) go(LIST, "error", "Select a branch first.");
  const products = await prisma.product.findMany({ where: { status: "active" }, orderBy: { sku: "asc" }, take: 12 });
  if (products.length < 4) go(LIST, "error", "There are not enough products to build a sample feed.");
  const pick = (offset: number, n: number) => products.slice(offset, offset + n);
  const suppliers = ["Company F and B Central Warehouse", "Principal — Beverages Division"];
  const batch = [
    { supplier: suppliers[0], lines: pick(0, 3).map((p) => ({ productId: p.id, qty: 120, cost: Math.round(p.unitPrice * 0.72) })), issue: null as string | null },
    { supplier: suppliers[1], lines: pick(3, 2).map((p) => ({ productId: p.id, qty: 200, cost: Math.round(p.unitPrice * 0.7) })), issue: "Unknown SKU BEV-9981 on line 3 — not in the product master; the line was held back" },
  ];
  const made: string[] = [];
  for (const b of batch) {
    const number = await nextPoNumber();
    const erpRef = `ERP-${number.replace("PO-", "")}-${Math.floor(1000 + Math.random() * 9000)}`;
    const po = await prisma.purchaseOrder.create({
      data: {
        poNumber: number, branchId, supplier: b.supplier, source: "erp", erpReference: erpRef, status: b.issue ? "exception" : "pending", exceptionReason: b.issue,
        expectedDate: new Date(Date.now() + 5 * 86400000),
        lines: { create: b.lines.map((l) => ({ productId: l.productId, qtyOrdered: l.qty, unitCost: l.cost })) },
      },
    });
    made.push(po.poNumber);
    await sendMessage({ connector: "erp", direction: "inbound", docType: "purchase_order", reference: `${erpRef} → ${po.poNumber}`, payload: { branch: branchId, lines: b.lines.length, issue: b.issue } });
    await logAudit("PurchaseOrder", po.id, "erp_receive", `Received ${po.poNumber} (${erpRef}) from the ERP interface${b.issue ? ` — exception: ${b.issue}` : ""}`);
    if (b.issue) await notify({ role: "branch_ops", branchId, title: "ERP purchase order in exception", body: `${po.poNumber}: ${b.issue}`, link: LIST, kind: "alert" });
  }
  revalidatePath(LIST);
  go(LIST, "notice", `Received ${made.join(" and ")} from the ERP. ${made[1]} has an unknown SKU and is in the exception queue.`);
}
