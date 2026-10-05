import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { formatCurrency, daysBetween } from "@/lib/format";

interface Bucket {
  outletName: string;
  creditLimit: number;
  current: number;
  b1_30: number;
  b31_60: number;
  b61_90: number;
  b90plus: number;
}

export default async function ArAgingPage() {
  const { branchId } = await getSession();

  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ["unpaid", "partially_paid", "overdue"] }, ...(branchId ? { branchId } : {}) },
    include: { outlet: true, arLedgerEntries: true },
  });

  const buckets: Record<string, Bucket> = {};

  for (const inv of invoices) {
    const paid = inv.arLedgerEntries.filter((e) => e.type === "payment").reduce((s, e) => s + e.amount, 0);
    const outstanding = inv.amount - paid;
    if (outstanding <= 0) continue;

    const daysPastDue = daysBetween(new Date(), inv.dueDate);

    if (!buckets[inv.outletId]) {
      buckets[inv.outletId] = {
        outletName: inv.outlet.name,
        creditLimit: inv.outlet.creditLimit,
        current: 0,
        b1_30: 0,
        b31_60: 0,
        b61_90: 0,
        b90plus: 0,
      };
    }
    const b = buckets[inv.outletId];
    if (daysPastDue <= 0) b.current += outstanding;
    else if (daysPastDue <= 30) b.b1_30 += outstanding;
    else if (daysPastDue <= 60) b.b31_60 += outstanding;
    else if (daysPastDue <= 90) b.b61_90 += outstanding;
    else b.b90plus += outstanding;
  }

  const rowTotal = (r: Bucket) => r.current + r.b1_30 + r.b31_60 + r.b61_90 + r.b90plus;
  const rows = Object.values(buckets).sort((a, b) => rowTotal(b) - rowTotal(a));
  const totals = rows.reduce(
    (acc, r) => ({
      current: acc.current + r.current,
      b1_30: acc.b1_30 + r.b1_30,
      b31_60: acc.b31_60 + r.b31_60,
      b61_90: acc.b61_90 + r.b61_90,
      b90plus: acc.b90plus + r.b90plus,
    }),
    { current: 0, b1_30: 0, b31_60: 0, b61_90: 0, b90plus: 0 },
  );

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">AR Aging</h2>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <div className="card p-4"><p className="text-xs text-slate-500">Current</p><p className="text-xl font-semibold text-slate-900">{formatCurrency(totals.current)}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">1–30 Days</p><p className="text-xl font-semibold text-emerald-600">{formatCurrency(totals.b1_30)}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">31–60 Days</p><p className="text-xl font-semibold text-amber-600">{formatCurrency(totals.b31_60)}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">61–90 Days</p><p className="text-xl font-semibold text-orange-600">{formatCurrency(totals.b61_90)}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">90+ Days</p><p className="text-xl font-semibold text-rose-600">{formatCurrency(totals.b90plus)}</p></div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Outlet</th>
              <th className="th">Current</th>
              <th className="th">1–30 Days</th>
              <th className="th">31–60 Days</th>
              <th className="th">61–90 Days</th>
              <th className="th">90+ Days</th>
              <th className="th">Total Outstanding</th>
              <th className="th">Credit Limit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => {
              const total = rowTotal(r);
              return (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="td font-medium text-slate-900">{r.outletName}</td>
                  <td className="td">{formatCurrency(r.current)}</td>
                  <td className="td">{formatCurrency(r.b1_30)}</td>
                  <td className="td">{formatCurrency(r.b31_60)}</td>
                  <td className="td">{formatCurrency(r.b61_90)}</td>
                  <td className="td">{formatCurrency(r.b90plus)}</td>
                  <td className={`td font-medium ${total > r.creditLimit ? "text-rose-600" : "text-slate-900"}`}>
                    {formatCurrency(total)}
                  </td>
                  <td className="td text-slate-500">{formatCurrency(r.creditLimit)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td className="td text-slate-400" colSpan={8}>No outstanding balances.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
