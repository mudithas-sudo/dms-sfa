import { prisma } from "@/lib/prisma";
import { vatBreakdown } from "@/lib/format";
import { logAudit } from "@/lib/audit";
import { sendMessage } from "@/lib/integration";

// Electronic invoice document built from an issued invoice. The structure follows the common elements an e-invoicing
// platform asks for (seller, buyer, lines with tax, totals); the exact schema is confirmed with the regulator during
// implementation, which is why it is produced from one place.

export interface EInvoice {
  documentType: "SALES_INVOICE";
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  currency: "PHP";
  seller: { name: string; branch: string; address: string };
  buyer: { name: string; code: string | null; tin: string | null; address: string };
  lines: { lineNo: number; sku: string; description: string; quantity: number; unit: string; unitPrice: number; vatableAmount: number; vatAmount: number; lineTotal: number }[];
  totals: { vatableSales: number; vatRatePercent: number; vatAmount: number; grandTotal: number };
  status: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function buildEInvoice(invoiceId: string): Promise<EInvoice | null> {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { outlet: true, branch: true, lines: { include: { product: true } } } });
  if (!inv) return null;
  const net = inv.amount - inv.taxAmount;
  const rate = net > 0 ? inv.taxAmount / net : 0;
  const lines = inv.lines.map((l, i) => {
    const b = vatBreakdown(l.lineTotal, rate);
    return { lineNo: i + 1, sku: l.product.sku, description: l.product.name, quantity: l.qty, unit: l.product.uom, unitPrice: r2(l.unitPrice), vatableAmount: r2(b.vatableSales), vatAmount: r2(b.vatAmount), lineTotal: r2(l.lineTotal) };
  });
  return {
    documentType: "SALES_INVOICE",
    invoiceNumber: inv.invoiceNumber,
    issueDate: inv.invoiceDate.toISOString().slice(0, 10),
    dueDate: inv.dueDate.toISOString().slice(0, 10),
    currency: "PHP",
    seller: { name: "Company F and B", branch: inv.branch.name, address: inv.branch.address },
    buyer: { name: inv.outlet.name, code: inv.outlet.code, tin: inv.outlet.tin, address: inv.outlet.address },
    lines,
    totals: { vatableSales: r2(net), vatRatePercent: r2(rate * 100), vatAmount: r2(inv.taxAmount), grandTotal: r2(inv.amount) },
    status: inv.status,
  };
}

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function toXml(e: EInvoice): string {
  const lines = e.lines.map((l) => `    <Line no="${l.lineNo}"><Sku>${esc(l.sku)}</Sku><Description>${esc(l.description)}</Description><Quantity>${l.quantity}</Quantity><Unit>${esc(l.unit)}</Unit><UnitPrice>${l.unitPrice}</UnitPrice><VatableAmount>${l.vatableAmount}</VatableAmount><VatAmount>${l.vatAmount}</VatAmount><LineTotal>${l.lineTotal}</LineTotal></Line>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<EInvoice type="${e.documentType}">
  <InvoiceNumber>${esc(e.invoiceNumber)}</InvoiceNumber><IssueDate>${e.issueDate}</IssueDate><DueDate>${e.dueDate}</DueDate><Currency>${e.currency}</Currency>
  <Seller><Name>${esc(e.seller.name)}</Name><Branch>${esc(e.seller.branch)}</Branch><Address>${esc(e.seller.address)}</Address></Seller>
  <Buyer><Name>${esc(e.buyer.name)}</Name><Code>${esc(e.buyer.code)}</Code><Tin>${esc(e.buyer.tin)}</Tin><Address>${esc(e.buyer.address)}</Address></Buyer>
  <Lines>
${lines}
  </Lines>
  <Totals><VatableSales>${e.totals.vatableSales}</VatableSales><VatRatePercent>${e.totals.vatRatePercent}</VatRatePercent><VatAmount>${e.totals.vatAmount}</VatAmount><GrandTotal>${e.totals.grandTotal}</GrandTotal></Totals>
</EInvoice>`;
}

export async function transmitOne(invoiceId: string): Promise<{ ok: boolean; message: string }> {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { outlet: true } });
  if (!inv) return { ok: false, message: "Invoice not found." };
  if (inv.status === "voided") return { ok: false, message: `${inv.invoiceNumber} is voided and is not transmitted.` };
  if (inv.einvoiceStatus === "accepted") return { ok: true, message: `${inv.invoiceNumber} was already accepted (${inv.einvoiceRef}).` };
  const doc = await buildEInvoice(invoiceId);
  const msg = await sendMessage({ connector: "einvoice", direction: "outbound", docType: "e_invoice", reference: inv.invoiceNumber, payload: doc });
  if (msg.status === "error") {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { einvoiceStatus: "rejected", einvoiceError: msg.error, einvoiceSentAt: new Date() } });
    return { ok: false, message: `${inv.invoiceNumber}: ${msg.error}` };
  }
  if (!inv.outlet.tin) {
    // the platform refuses a business invoice with no buyer TIN above the threshold — shown as a typical rejection
    if (inv.amount >= 1000) {
      await prisma.invoice.update({ where: { id: invoiceId }, data: { einvoiceStatus: "rejected", einvoiceError: "Buyer TIN is missing — add it to the customer record and resend", einvoiceSentAt: new Date() } });
      return { ok: false, message: `${inv.invoiceNumber}: buyer TIN is missing on ${inv.outlet.name}.` };
    }
  }
  const ref = `EIS-${inv.invoiceNumber.replace(/[^A-Z0-9]/gi, "")}-${Math.floor(100000 + Math.random() * 899999)}`;
  await prisma.invoice.update({ where: { id: invoiceId }, data: { einvoiceStatus: "accepted", einvoiceRef: ref, einvoiceError: null, einvoiceSentAt: new Date() } });
  await logAudit("Invoice", invoiceId, "einvoice_accepted", `E-invoice ${inv.invoiceNumber} accepted by the e-invoicing platform (${ref})`);
  return { ok: true, message: `${inv.invoiceNumber} accepted (${ref}).` };
}
