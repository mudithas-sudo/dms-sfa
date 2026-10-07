import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import StatusBadge from "@/components/StatusBadge";
import { formatCurrency, daysBetween } from "@/lib/format";
import { getAllSettings, num } from "@/lib/settings";
import { ageingBounds, bucketIndex, bucketLabels, invoiceBalance } from "@/lib/finance";

interface Row {
  outletId: string;
  outletName: string;
  creditLimit: number;
  creditStatus: string;
  buckets: number[];
  pending: number;
  oldest: number;
}

export default async function ArAgingPage() {
  const { branchId } = await getSession();
  const s = await getAllSettings();
  const bounds = ageingBounds(s["ageing.buckets"]);
  const labels = bucketLabels(bounds);
  const colour = ["text-slate-900", "text-emerald-600", "text-amber-600", "text-orange-600", "text-rose-600", "text-rose-700"];

  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ["unpaid", "partially_paid", "overdue"] }, ...(branchId ? { branchId } : {}) },
    include: { outlet: true, arLedgerEntries: true },
  });

  const byOutlet = new Map<string, Row>();
  for (const inv of invoices) {
    const outstanding = invoiceBalance(inv);
    if (outstanding <= 0) continue;
    const row = byOutlet.get(inv.outletId) ?? { outletId: inv.outletId, outletName: inv.outlet.name, creditLimit: inv.outlet.creditLimit, creditStatus: inv.outlet.creditStatus, buckets: labels.map(() => 0), pending: 0, oldest: 0 };
    const late = daysBetween(new Date(), inv.dueDate);
    row.oldest = Math.max(row.oldest, late);
    row.buckets[bucketIndex(late, bounds)] += outstanding;
    row.pending += inv.arLedgerEntries.filter((e) => e.type === "payment" && e.paymentStatus === "pending" && e.recStatus !== "reversed").reduce((sum, e) => sum + e.amount, 0);
    byOutlet.set(inv.outletId, row);
  }
  const total = (r: Row) => r.buckets.reduce((a, b) => a + b, 0);
  const rows = [...byOutlet.values()].sort((a, b) => total(b) - total(a));
  const totals = labels.map((_, i) => rows.reduce((sum, r) => sum + r.buckets[i], 0));
  const overdueTotal = totals.slice(1).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Receivables Ageing</h2>
          <p className="text-xs text-slate-500">
            Buckets ({bounds.join(" / ")} days) are set in Platform Configuration. Pending (uncleared or post-dated) cheques do not reduce a balance until they clear.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/supervisor/credit" className="btn-secondary">Credit control</Link>
          <Link href="/supervisor/payment-reconciliation" className="btn-secondary">Record payment</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {labels.map((l, i) => (
          <div key={l} className="card p-4">
            <p className="text-xs text-slate-500">{l}</p>
            <p className={`text-lg font-semibold ${colour[Math.min(i, colour.length - 1)]}`}>{formatCurrency(totals[i])}</p>
          </div>
        ))}
      </div>
      <p className="text-sm text-slate-600">Total overdue <strong className="text-rose-600">{formatCurrency(overdueTotal)}</strong> of {formatCurrency(totals.reduce((a, b) => a + b, 0))} outstanding. Alert thresholds: {num(s, "credit.overdueDays")} days or ₱{num(s, "credit.overdueAmount").toLocaleString()}.</p>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Customer</th>
              {labels.map((l) => (
                <th key={l} className="th">{l}</th>
              ))}
              <th className="th">Total</th>
              <th className="th">Pending cheques</th>
              <th className="th">Limit</th>
              <th className="th">Credit status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const t = total(r);
              const overdue = r.buckets.slice(1).reduce((a, b) => a + b, 0);
              const over = overdue >= num(s, "credit.overdueAmount") || (overdue > 0 && r.oldest >= num(s, "credit.overdueDays"));
              return (
                <tr key={r.outletId} className="hover:bg-slate-50">
                  <td className="td"><Link href={`/supervisor/payment-reconciliation?outlet=${r.outletId}`} className="font-medium text-blue-700 hover:underline">{r.outletName}</Link>{over && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">alert</span>}</td>
                  {r.buckets.map((b, i) => (
                    <td key={i} className="td">{b ? formatCurrency(b) : <span className="text-slate-300">—</span>}</td>
                  ))}
                  <td className={`td font-medium ${t > r.creditLimit ? "text-rose-600" : "text-slate-900"}`}>{formatCurrency(t)}</td>
                  <td className="td text-xs text-slate-500">{r.pending ? formatCurrency(r.pending) : "—"}</td>
                  <td className="td text-slate-500">{formatCurrency(r.creditLimit)}</td>
                  <td className="td"><StatusBadge status={r.creditStatus} /></td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={labels.length + 5}>No outstanding balances.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
