import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { reconcilePayment, requestArReversal } from "@/app/actions/supervisor-actions";

export default async function PaymentReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ outlet?: string }>;
}) {
  const { branchId } = await getSession();
  const { outlet: outletIdParam } = await searchParams;

  const outlets = await prisma.outlet.findMany({
    where: { ...(branchId ? { branchId } : {}), status: "active" },
    orderBy: { name: "asc" },
  });
  const selectedOutletId = outletIdParam ?? outlets[0]?.id;

  const invoices = selectedOutletId
    ? await prisma.invoice.findMany({
        where: { outletId: selectedOutletId, status: { in: ["unpaid", "partially_paid", "overdue"] } },
        include: { arLedgerEntries: true },
        orderBy: { invoiceDate: "asc" },
      })
    : [];

  const invoicesWithOutstanding = invoices.map((inv) => {
    const paid = inv.arLedgerEntries.filter((e) => e.type === "payment").reduce((s, e) => s + e.amount, 0);
    return { ...inv, outstanding: inv.amount - paid };
  }).filter((inv) => inv.outstanding > 0);

  const recentEntries = selectedOutletId
    ? await prisma.aRLedgerEntry.findMany({
        where: { outletId: selectedOutletId, type: { in: ["payment", "credit_note"] } },
        orderBy: { entryDate: "desc" },
        take: 10,
        include: { reversalRequests: true },
      })
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Payment Reconciliation</h2>
        <p className="text-sm text-slate-500">Match a lump-sum payment against specific outstanding invoices.</p>
      </div>

      <form className="card flex flex-wrap items-end gap-3 p-4" method="get">
        <div>
          <label className="label" htmlFor="outlet">Outlet</label>
          <select className="input" id="outlet" name="outlet" defaultValue={selectedOutletId}>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-secondary">Load Invoices</button>
      </form>

      <div className="card p-6">
        <form action={reconcilePayment} className="space-y-4">
          <input type="hidden" name="outletId" value={selectedOutletId ?? ""} />
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200">
              <tr>
                <th className="th">Select</th>
                <th className="th">Invoice #</th>
                <th className="th">Date</th>
                <th className="th">Outstanding</th>
                <th className="th">Amount to Apply</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoicesWithOutstanding.map((inv) => (
                <tr key={inv.id}>
                  <td className="td">
                    <input type="checkbox" name="invoiceId" value={inv.id} defaultChecked className="h-4 w-4 rounded border-slate-300" />
                  </td>
                  <td className="td font-medium text-slate-900">{inv.invoiceNumber}</td>
                  <td className="td">{formatDate(inv.invoiceDate)}</td>
                  <td className="td">{formatCurrency(inv.outstanding)}</td>
                  <td className="td">
                    <input className="input w-28" type="number" name={`amount_${inv.id}`} step="0.01" defaultValue={inv.outstanding} />
                  </td>
                </tr>
              ))}
              {invoicesWithOutstanding.length === 0 && (
                <tr><td className="td text-slate-400" colSpan={5}>No outstanding invoices for this outlet.</td></tr>
              )}
            </tbody>
          </table>

          <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
            <div>
              <label className="label" htmlFor="method">Payment Method</label>
              <select className="input" id="method" name="method" defaultValue="cash">
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="reference">Reference</label>
              <input className="input" id="reference" name="reference" placeholder="OR / cheque number" />
            </div>
          </div>
          <button type="submit" className="btn-primary" disabled={invoicesWithOutstanding.length === 0}>Reconcile Payment</button>
        </form>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Recent Payments & Credit Notes</h3>
        <p className="mb-3 text-xs text-slate-500">
          A posted entry can&apos;t be edited directly — correcting one means requesting a reversal, which
          reaches the approvals queue like any other financial correction.
        </p>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Date</th>
                <th className="th">Type</th>
                <th className="th">Amount</th>
                <th className="th">Reference</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentEntries.map((e) => {
                const pendingReversal = e.reversalRequests.some((r) => r.status === "pending");
                const reversed = e.reversalRequests.some((r) => r.status === "approved");
                return (
                  <tr key={e.id}>
                    <td className="td text-xs">{formatDateTime(e.entryDate)}</td>
                    <td className="td capitalize">{e.type.replace(/_/g, " ")}</td>
                    <td className="td">{formatCurrency(e.amount)}</td>
                    <td className="td text-xs text-slate-500">{e.reference ?? "—"}</td>
                    <td className="td text-right">
                      {reversed ? (
                        <span className="text-xs text-slate-400">Reversed</span>
                      ) : pendingReversal ? (
                        <span className="text-xs text-amber-600">Reversal pending</span>
                      ) : (
                        <form action={requestArReversal} className="flex justify-end gap-2">
                          <input type="hidden" name="arLedgerEntryId" value={e.id} />
                          <input className="input w-40" name="reason" placeholder="Reason for reversal" required />
                          <button type="submit" className="text-xs text-rose-600 hover:underline">Request Reversal</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
              {recentEntries.length === 0 && (
                <tr><td className="td text-slate-400" colSpan={5}>No payments or credit notes recorded for this outlet yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
