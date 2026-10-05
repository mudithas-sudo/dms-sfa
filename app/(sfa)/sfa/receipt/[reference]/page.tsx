import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import PrintButton from "@/components/PrintButton";
import { formatCurrency, formatDateTime } from "@/lib/format";

export default async function CollectionReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  searchParams: Promise<{ outlet?: string }>;
}) {
  const { reference: referenceParam } = await params;
  const { outlet: outletId } = await searchParams;
  const reference = decodeURIComponent(referenceParam);

  const entries = await prisma.aRLedgerEntry.findMany({
    where: { reference, type: "payment", ...(outletId ? { outletId } : {}) },
    include: { outlet: true, invoice: true },
    orderBy: { entryDate: "asc" },
  });
  if (entries.length === 0) notFound();

  const outlet = entries[0].outlet;
  const total = entries.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="mx-auto max-w-sm space-y-4">
      <div className="no-print flex items-center justify-between">
        <Link href={`/sfa/outlets/${outlet.id}`} className="text-sm text-blue-600 hover:underline">← Back to {outlet.name}</Link>
        <PrintButton />
      </div>

      <div className="card space-y-4 p-6 text-center">
        <div>
          <p className="text-lg font-semibold text-slate-900">Payment Receipt</p>
          <p className="text-xs text-slate-500">{reference}</p>
        </div>
        <div className="border-t border-dashed border-slate-300 pt-4 text-left text-sm">
          <p><span className="text-slate-500">Outlet:</span> {outlet.name}</p>
          <p><span className="text-slate-500">Date:</span> {formatDateTime(entries[0].entryDate)}</p>
          <p><span className="text-slate-500">Method:</span> <span className="capitalize">{entries[0].method ?? "—"}</span></p>
        </div>
        <div className="border-t border-dashed border-slate-300 pt-4 text-left">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="pb-1 text-left font-normal">Applied To</th>
                <th className="pb-1 text-right font-normal">Amount</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="py-0.5">{e.invoice?.invoiceNumber ?? "Advance payment"}</td>
                  <td className="py-0.5 text-right">{formatCurrency(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-dashed border-slate-300 pt-4">
          <p className="text-sm text-slate-500">Total Collected</p>
          <p className="text-2xl font-semibold text-slate-900">{formatCurrency(total)}</p>
        </div>
        <p className="text-[11px] text-slate-400">
          Simulated receipt — in production this prints to an approved portable Bluetooth printer.
        </p>
      </div>
    </div>
  );
}
