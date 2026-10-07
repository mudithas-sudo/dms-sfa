import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import StatusBadge from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/format";
import { transmitInvoice, transmitPending } from "@/app/actions/einvoice-actions";

const STATUS = ["", "not_sent", "accepted", "rejected"];

export default async function EInvoicingPage({ searchParams }: { searchParams: Promise<{ status?: string; error?: string; notice?: string }> }) {
  const { branchId } = await getSession();
  const { status = "", error, notice } = await searchParams;
  const where = { status: { not: "voided" }, ...(branchId ? { branchId } : {}) };
  const [invoices, counts] = await Promise.all([
    prisma.invoice.findMany({ where: { ...where, ...(status ? { einvoiceStatus: status } : {}) }, include: { outlet: true }, orderBy: { invoiceDate: "desc" }, take: 60 }),
    prisma.invoice.groupBy({ by: ["einvoiceStatus"], where, _count: true }),
  ]);
  const n = (s: string) => counts.find((c) => c.einvoiceStatus === s)?._count ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">E-Invoicing &amp; Tax Outputs</h2>
          <p className="text-xs text-slate-500">
            Every issued invoice can be produced as an electronic invoice document (JSON or XML) and transmitted to the e-invoicing platform. The platform&apos;s answer is kept on the invoice; a rejection shows the reason so it can be fixed and resent.
            The VAT sales book is in <Link className="text-blue-600 underline" href="/supervisor/reports/vat-sales-book">Reports</Link>.
          </p>
        </div>
        <form action={transmitPending}><button className="btn-primary" type="submit">Transmit all pending ({n("not_sent") + n("rejected")})</button></form>
      </div>
      <Banner error={error} notice={notice} />
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4"><p className="text-xs text-slate-500">Not yet sent</p><p className="text-xl font-semibold text-amber-600">{n("not_sent")}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Accepted</p><p className="text-xl font-semibold text-emerald-600">{n("accepted")}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Rejected</p><p className="text-xl font-semibold text-rose-600">{n("rejected")}</p></div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {STATUS.map((s) => <Link key={s} href={s ? `/supervisor/einvoicing?status=${s}` : "/supervisor/einvoicing"} className={`rounded-full px-3 py-1 text-xs ${status === s ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{s ? s.replace("_", " ") : "All"}</Link>)}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Invoice</th><th className="th">Date</th><th className="th">Customer</th><th className="th">TIN</th><th className="th text-right">Amount</th><th className="th text-right">VAT</th><th className="th">E-invoice</th><th className="th"></th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {invoices.map((i) => (
              <tr key={i.id}>
                <td className="td font-medium"><Link className="text-blue-700 hover:underline" href={`/supervisor/invoices/${i.id}`}>{i.invoiceNumber}</Link></td>
                <td className="td text-xs">{formatDate(i.invoiceDate)}</td>
                <td className="td">{i.outlet.name}</td>
                <td className="td text-xs">{i.outlet.tin ?? <span className="text-rose-500">missing</span>}</td>
                <td className="td text-right">{formatCurrency(i.amount)}</td>
                <td className="td text-right">{formatCurrency(i.taxAmount)}</td>
                <td className="td"><StatusBadge status={i.einvoiceStatus === "accepted" ? "completed" : i.einvoiceStatus === "rejected" ? "failed" : "pending"} /><p className="mt-0.5 text-[11px] text-slate-500">{i.einvoiceRef ?? i.einvoiceError ?? ""}</p></td>
                <td className="td text-right">
                  <div className="flex justify-end gap-2 text-xs">
                    <a className="text-blue-600 hover:underline" href={`/api/invoices/${i.id}/einvoice?format=json`}>JSON</a>
                    <a className="text-blue-600 hover:underline" href={`/api/invoices/${i.id}/einvoice?format=xml`}>XML</a>
                    {i.einvoiceStatus !== "accepted" && <form action={transmitInvoice}><input type="hidden" name="id" value={i.id} /><button className="text-emerald-700 hover:underline" type="submit">{i.einvoiceStatus === "rejected" ? "Resend" : "Transmit"}</button></form>}
                  </div>
                </td>
              </tr>
            ))}
            {invoices.length === 0 && <tr><td className="td text-slate-400" colSpan={8}>No invoices in this view.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
