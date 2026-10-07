import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { invoiceBalance } from "@/lib/finance";
import { transmitInvoice } from "@/app/actions/einvoice-actions";
import StatusBadge from "@/components/StatusBadge";
import PrintButton from "@/components/PrintButton";
import { formatCurrency, formatDate, vatBreakdown } from "@/lib/format";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      outlet: true,
      branch: true,
      salesOrder: true,
      lines: { include: { product: true } },
      arLedgerEntries: true,
    },
  });
  if (!invoice) notFound();

  const { vatableSales, vatAmount, total } = vatBreakdown(invoice.amount, invoice.taxAmount > 0 && invoice.amount > 0 ? invoice.taxAmount / (invoice.amount - invoice.taxAmount) : 0.12);
  const paid = Math.round((invoice.amount - invoiceBalance(invoice)) * 100) / 100;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="no-print flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Link href="/supervisor/orders" className="hover:underline">Orders</Link>
          <span>/</span>
          <span className="text-slate-900">{invoice.invoiceNumber}</span>
        </div>
        <PrintButton />
      </div>

      <div className="no-print card flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
        <div>
          <p className="font-medium text-slate-900">E-invoice: <span className="capitalize">{invoice.einvoiceStatus.replace("_", " ")}</span>{invoice.einvoiceRef ? ` · ${invoice.einvoiceRef}` : ""}</p>
          {invoice.einvoiceError && <p className="text-xs text-rose-600">{invoice.einvoiceError}</p>}
          {invoice.outlet.tin ? <p className="text-xs text-slate-500">Buyer TIN {invoice.outlet.tin}</p> : <p className="text-xs text-amber-700">The customer has no TIN on record.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="btn-secondary" href={`/api/invoices/${invoice.id}/einvoice?format=json`}>E-invoice JSON</a>
          <a className="btn-secondary" href={`/api/invoices/${invoice.id}/einvoice?format=xml`}>E-invoice XML</a>
          {invoice.einvoiceStatus !== "accepted" && invoice.status !== "voided" && (
            <form action={transmitInvoice}><input type="hidden" name="id" value={invoice.id} /><input type="hidden" name="back" value={`/supervisor/invoices/${invoice.id}`} /><button className="btn-primary" type="submit">{invoice.einvoiceStatus === "rejected" ? "Resend" : "Transmit"} to the e-invoicing platform</button></form>
          )}
        </div>
      </div>

      <div className="card space-y-6 p-8">
        <div className="flex items-start justify-between border-b border-slate-200 pb-4">
          <div>
            <p className="text-lg font-semibold text-slate-900">Sales Invoice</p>
            <p className="text-xs text-slate-500">{invoice.invoiceNumber}</p>
            <p className="mt-1 text-xs text-slate-400">
              VAT Reg TIN: 000-000-000-000 (simulated) · Branch: {invoice.branch.name}
            </p>
          </div>
          <StatusBadge status={invoice.status} />
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-slate-500">Bill To</p>
            <p className="font-medium text-slate-900">{invoice.outlet.name}</p>
            <p className="text-xs text-slate-500">{invoice.outlet.address}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">Invoice Date</p>
            <p className="font-medium text-slate-900">{formatDate(invoice.invoiceDate)}</p>
            <p className="mt-1 text-xs text-slate-500">Due Date</p>
            <p className="font-medium text-slate-900">{formatDate(invoice.dueDate)}</p>
            {invoice.salesOrder && <p className="mt-1 text-xs text-slate-400">Order {invoice.salesOrder.orderNumber}</p>}
          </div>
        </div>

        <table className="w-full text-sm">
          <thead className="border-b border-slate-200">
            <tr>
              <th className="th">Item</th>
              <th className="th text-right">Qty</th>
              <th className="th text-right">Unit Price</th>
              <th className="th text-right">Line Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoice.lines.map((l) => (
              <tr key={l.id}>
                <td className="td">{l.product.name}</td>
                <td className="td text-right">{l.qty}</td>
                <td className="td text-right">{formatCurrency(l.unitPrice)}</td>
                <td className="td text-right">{formatCurrency(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ml-auto max-w-xs space-y-1 border-t border-slate-200 pt-4 text-sm">
          <div className="flex justify-between text-slate-500">
            <span>VATable Sales</span>
            <span>{formatCurrency(vatableSales)}</span>
          </div>
          <div className="flex justify-between text-slate-500">
            <span>VAT (12%)</span>
            <span>{formatCurrency(vatAmount)}</span>
          </div>
          <div className="flex justify-between text-base font-semibold text-slate-900">
            <span>Total Amount Due</span>
            <span>{formatCurrency(total)}</span>
          </div>
          {paid > 0 && (
            <div className="flex justify-between text-emerald-600">
              <span>Paid to Date</span>
              <span>-{formatCurrency(paid)}</span>
            </div>
          )}
        </div>

        <p className="border-t border-slate-200 pt-4 text-[11px] text-slate-400">
          Simulated BIR-compliant output for prototype purposes — VAT breakdown and TIN are illustrative,
          not connected to a real e-invoicing or tax-filing system.
        </p>
      </div>
    </div>
  );
}
