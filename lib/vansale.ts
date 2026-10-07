import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { changeBalance } from "@/lib/stock";
import { getRepVan, sellableByProduct } from "@/lib/van";
import { dueDateFor, nextInvoiceNumber, vatOf } from "@/lib/orders";
import { currentVatRate } from "@/lib/reference";
import { outletBalance } from "@/lib/finance";
import { sendMessage } from "@/lib/integration";

// A van sale is delivered on the spot: van stock falls (movement ledger, type van_sale), the invoice takes the
// next number in the branch series, a delivery receipt is cut and the receivable is posted. Stock that was loaded
// but not yet acknowledged by the rep is not sellable.
export async function completeVanSale(orderId: string, by: string): Promise<{ invoiceNumber: string }> {
  const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true, outlet: true, salesperson: true } });
  if (!["draft", "on_hold", "confirmed"].includes(order.status)) throw new Error(`Order ${order.orderNumber} is ${order.status} and cannot be completed.`);
  const van = await getRepVan(order.branchId, order.salesperson);
  if (!van) throw new Error("No active van is assigned to this representative.");

  const sellable = await sellableByProduct(van.id);
  const short = order.lines.filter((l) => (sellable.get(l.productId) ?? 0) < l.qty);
  if (short.length) {
    const names = await prisma.product.findMany({ where: { id: { in: short.map((s) => s.productId) } }, select: { id: true, name: true } });
    throw new Error(`Not enough sellable stock on the van for ${short.map((s) => names.find((n) => n.id === s.productId)?.name).join(", ")} (stock loaded but not yet acknowledged cannot be sold).`);
  }

  const { seq, number } = await nextInvoiceNumber(order.branchId);
  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber: number, branchSeq: seq, salesOrderId: order.id, outletId: order.outletId, branchId: order.branchId,
      dueDate: dueDateFor(order.paymentTerms ?? order.outlet.paymentTerms), amount: order.total, taxAmount: vatOf(order.total, await currentVatRate()), status: "unpaid", deliveryStatus: "delivered",
    },
  });
  for (const line of order.lines) {
    await prisma.invoiceLine.create({ data: { invoiceId: invoice.id, productId: line.productId, qty: line.qty, unitPrice: line.unitPrice, lineTotal: line.lineTotal } });
    let left = line.qty;
    const rows = await prisma.stockBalance.findMany({ where: { locationType: "van", vanId: van.id, productId: line.productId, qtyGood: { gt: 0 } }, orderBy: { expiryDate: "asc" } });
    for (const r of rows) {
      if (left <= 0) break;
      const take = Math.min(r.qtyGood, left);
      await changeBalance(r.id, "good", -take, { type: "van_sale", refType: "Invoice", refId: invoice.id, refNumber: invoice.invoiceNumber, userName: by, note: `Van sale ${order.orderNumber}` });
      left -= take;
    }
    await prisma.salesOrderLine.update({ where: { id: line.id }, data: { qtyDelivered: line.qty } });
  }
  const drCount = await prisma.deliveryReceipt.count();
  await prisma.deliveryReceipt.create({
    data: { drNumber: `DR-${String(drCount + 1).padStart(6, "0")}`, invoiceId: invoice.id, receivedBy: order.signatoryName ?? `${order.outlet.name} staff`, status: "delivered", signatoryName: order.signatoryName, signatureDataUrl: order.signatureDataUrl },
  });
  const bal = await outletBalance(order.outletId);
  await prisma.aRLedgerEntry.create({ data: { outletId: order.outletId, invoiceId: invoice.id, type: "invoice", amount: order.total, balance: bal + order.total, reference: invoice.invoiceNumber } });
  await prisma.salesOrder.update({ where: { id: order.id }, data: { status: "delivered", creditHoldReason: null, allocationStatus: "dispatched" } });
  await sendMessage({ connector: "erp", direction: "outbound", docType: "financial_posting", reference: invoice.invoiceNumber, payload: { amount: order.total, channel: "van_sale" } });
  await logAudit("Invoice", invoice.id, "issue", `Van sale ${order.orderNumber}: invoice ${invoice.invoiceNumber} (₱${order.total.toLocaleString()}) issued and delivered on the spot`, { after: { amount: order.total, van: van.code } }, { userId: order.salespersonId });
  return { invoiceNumber: invoice.invoiceNumber };
}
