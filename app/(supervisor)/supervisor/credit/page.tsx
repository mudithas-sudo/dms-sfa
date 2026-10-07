import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import StatusBadge from "@/components/StatusBadge";
import { formatCurrency } from "@/lib/format";
import { getAllSettings, num } from "@/lib/settings";
import { invoiceBalance, ledgerDelta } from "@/lib/finance";
import { runOverdueCheck, setCreditStatus } from "@/app/actions/finance-actions";

// Customer credit control: balance, open-order exposure and available credit side by side, with the hold / release
// decision beside each customer.
export default async function CreditControlPage({ searchParams }: { searchParams: Promise<{ status?: string; error?: string; notice?: string }> }) {
  const { branchId } = await getSession();
  const { status, error, notice } = await searchParams;
  const s = await getAllSettings();
  const outlets = await prisma.outlet.findMany({ where: { ...(branchId ? { branchId } : {}), status: { in: ["active", "blocked"] } }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, creditLimit: true, creditStatus: true, blockedReason: true, paymentTerms: true } });
  const ids = outlets.map((o) => o.id);
  const [entries, invoices, openOrders] = await Promise.all([
    prisma.aRLedgerEntry.findMany({ where: { outletId: { in: ids } } }),
    prisma.invoice.findMany({ where: { outletId: { in: ids }, status: { in: ["unpaid", "partially_paid", "overdue"] } }, include: { arLedgerEntries: true } }),
    prisma.salesOrder.groupBy({ by: ["outletId"], where: { outletId: { in: ids }, status: { in: ["confirmed", "picked", "on_hold"] } }, _sum: { total: true } }),
  ]);
  const now = new Date();
  const rows = outlets.map((o) => {
    const balance = Math.max(0, entries.filter((e) => e.outletId === o.id).reduce((sum, e) => sum + ledgerDelta(e), 0));
    let overdue = 0;
    let oldest = 0;
    for (const i of invoices.filter((x) => x.outletId === o.id)) {
      const b = invoiceBalance(i);
      if (b > 0 && i.dueDate < now) {
        overdue += b;
        oldest = Math.max(oldest, Math.floor((now.getTime() - i.dueDate.getTime()) / 86400000));
      }
    }
    const openOrder = openOrders.find((x) => x.outletId === o.id)?._sum.total ?? 0;
    const available = o.creditLimit - balance - openOrder;
    const usedPct = o.creditLimit > 0 ? Math.round(((balance + openOrder) / o.creditLimit) * 100) : 0;
    const flagged = overdue >= num(s, "credit.overdueAmount") || (overdue > 0 && oldest >= num(s, "credit.overdueDays"));
    return { ...o, balance, overdue, oldest, openOrder, available, usedPct, flagged };
  });
  const shown = rows.filter((r) => (status ? r.creditStatus === status : true)).sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.overdue - a.overdue);
  const filters = ["", "active", "on_watch", "on_hold", "blocked"];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Customer Credit Control</h2>
          <p className="text-xs text-slate-500">
            A customer on <strong>watch</strong> is flagged on new orders; on <strong>hold</strong> or <strong>blocked</strong>, new orders are held for a supervisor. Customers past {num(s, "credit.overdueDays")} days overdue or ₱{num(s, "credit.overdueAmount").toLocaleString()} overdue are flagged automatically ({s["credit.autoAction"] === "off" ? "alert only" : `moved ${String(s["credit.autoAction"]).replace("_", " ")}`}).
          </p>
        </div>
        <form action={runOverdueCheck}><button className="btn-secondary" type="submit">Run overdue check now</button></form>
      </div>
      <Banner error={error} notice={notice} />

      <div className="flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <Link key={f} href={f ? `/supervisor/credit?status=${f}` : "/supervisor/credit"} className={`rounded-full px-3 py-1 text-xs ${(status ?? "") === f ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {f ? `${f.replace("_", " ")} (${rows.filter((r) => r.creditStatus === f).length})` : "All"}
          </Link>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Customer</th>
              <th className="th">Limit</th>
              <th className="th">Balance</th>
              <th className="th">Open orders</th>
              <th className="th">Available credit</th>
              <th className="th">Overdue</th>
              <th className="th">Status</th>
              <th className="th">Change status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((r) => (
              <tr key={r.id} className={r.flagged ? "bg-amber-50/50" : ""}>
                <td className="td"><Link className="font-medium text-blue-700 hover:underline" href={`/supervisor/payment-reconciliation?outlet=${r.id}`}>{r.name}</Link><p className="text-[11px] text-slate-400">{r.code} · {r.paymentTerms.replace("_", " ")}</p></td>
                <td className="td">{formatCurrency(r.creditLimit)}</td>
                <td className="td">{formatCurrency(r.balance)}<p className={`text-[11px] ${r.usedPct >= 100 ? "text-rose-600" : r.usedPct >= num(s, "credit.nearLimitPct") ? "text-amber-600" : "text-slate-400"}`}>{r.usedPct}% used</p></td>
                <td className="td">{formatCurrency(r.openOrder)}</td>
                <td className={`td font-medium ${r.available < 0 ? "text-rose-600" : "text-slate-900"}`}>{formatCurrency(r.available)}</td>
                <td className="td">{r.overdue > 0 ? <span className="text-rose-600">{formatCurrency(r.overdue)}<span className="block text-[11px]">{r.oldest} days</span></span> : "—"}{r.flagged && <span className="mt-0.5 block text-[10px] font-semibold uppercase text-amber-700">over threshold</span>}</td>
                <td className="td"><StatusBadge status={r.creditStatus} />{r.blockedReason && r.creditStatus !== "active" && <p className="mt-0.5 max-w-[160px] text-[11px] text-slate-400">{r.blockedReason}</p>}</td>
                <td className="td">
                  <form action={setCreditStatus} className="flex gap-1">
                    <input type="hidden" name="outletId" value={r.id} />
                    <select className="input w-28 py-1 text-xs" name="status" defaultValue={r.creditStatus === "active" ? "on_hold" : "active"}>
                      <option value="active">Release</option>
                      <option value="on_watch">On watch</option>
                      <option value="on_hold">On hold</option>
                      <option value="blocked">Blocked</option>
                    </select>
                    <input className="input w-32 py-1 text-xs" name="reason" placeholder="Reason" required />
                    <button className="btn-secondary px-2 py-1 text-xs" type="submit">Set</button>
                  </form>
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td className="td text-slate-400" colSpan={8}>No customers in this view.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
