import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Banner from "@/components/Banner";
import PrintButton from "@/components/PrintButton";
import StatusBadge from "@/components/StatusBadge";
import { formatCurrency, formatDateTime, vatBreakdown } from "@/lib/format";
import { invoiceBalance } from "@/lib/finance";
import { reprintDocument } from "@/app/actions/sfa-misc-actions";

// Mobile invoice view with reprint-as-copy: every reprint is counted, stamped COPY and limited.
export default async function MobileInvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ copy?: string; error?: string; notice?: string }> }) {
  const { id } = await params;
  const { copy, error, notice } = await searchParams;
  const inv = await prisma.invoice.findUnique({ where: { id }, include: { outlet: true, branch: true, lines: { include: { product: true } }, arLedgerEntries: true, salesOrder: true } });
  if (!inv) notFound();
  const { vatableSales, vatAmount } = vatBreakdown(inv.amount, inv.taxAmount > 0 && inv.amount > 0 ? inv.taxAmount / (inv.amount - inv.taxAmount) : 0);
  const open = invoiceBalance(inv);
  const reprints = await prisma.auditLog.count({ where: { entity: "Invoice", entityId: inv.invoiceNumber, action: "reprint" } });

  return (
    <div className="space-y-3">
      <Banner error={error} notice={notice} />
      <div className="no-print flex items-center justify-between">
        <Link href="/sfa/orders" className="text-sm text-blue-600 hover:underline">← Orders</Link>
        <PrintButton />
      </div>
      <div className="card space-y-3 p-4 text-sm">
        {copy && <p className="rounded bg-slate-900 px-2 py-1 text-center text-xs font-bold tracking-widest text-white">COPY — REPRINT #{copy}</p>}
        <div className="text-center">
          <p className="text-base font-semibold text-slate-900">Sales Invoice</p>
          <p className="text-xs text-slate-500">{inv.invoiceNumber} · {inv.branch.name}</p>
          <p className="text-xs text-slate-500">{formatDateTime(inv.invoiceDate)}</p>
        </div>
        <div className="border-t border-dashed border-slate-300 pt-2 text-xs">
          <p><span className="text-slate-500">Customer:</span> {inv.outlet.name}</p>
          <p><span className="text-slate-500">Order:</span> {inv.salesOrder.orderNumber} ({inv.salesOrder.orderType === "van_sale" ? "van sale" : "pre-sales"})</p>
          <p><span className="text-slate-500">Due:</span> {formatDateTime(inv.dueDate)}</p>
        </div>
        <table className="w-full text-xs">
          <thead><tr className="text-slate-500"><th className="text-left font-normal">Item</th><th className="text-right font-normal">Qty</th><th className="text-right font-normal">Amount</th></tr></thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id}><td className="py-0.5">{l.product.name}</td><td className="text-right">{l.qty}</td><td className="text-right">{formatCurrency(l.lineTotal)}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-dashed border-slate-300 pt-2 text-xs">
          <p className="flex justify-between"><span className="text-slate-500">VATable sales</span>{formatCurrency(vatableSales)}</p>
          <p className="flex justify-between"><span className="text-slate-500">VAT 12%</span>{formatCurrency(vatAmount)}</p>
          <p className="mt-1 flex justify-between text-sm font-semibold"><span>Total</span>{formatCurrency(inv.amount)}</p>
          <p className="mt-1 flex justify-between"><span className="text-slate-500">Open balance</span><span className={open > 0 ? "text-rose-600" : "text-emerald-700"}>{formatCurrency(open)}</span></p>
        </div>
        <div className="flex items-center justify-between"><StatusBadge status={inv.status} /><StatusBadge status={inv.deliveryStatus} /></div>
        {inv.salesOrder.signatoryName && <p className="text-[11px] text-slate-500">Received by {inv.salesOrder.signatoryName}{inv.salesOrder.signatureDeclinedReason ? ` (declined to sign: ${inv.salesOrder.signatureDeclinedReason})` : ""}</p>}
      </div>
      <form action={reprintDocument} className="no-print">
        <input type="hidden" name="kind" value="invoice" />
        <input type="hidden" name="ref" value={inv.invoiceNumber} />
        <input type="hidden" name="back" value={`/sfa/invoice/${inv.id}`} />
        <button type="submit" className="btn-secondary w-full">Reprint as copy ({reprints} used)</button>
      </form>
    </div>
  );
}
