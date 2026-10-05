import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { decideApproval } from "@/app/actions/supervisor-actions";

export default async function ApprovalsPage() {
  const requests = await prisma.approvalRequest.findMany({
    orderBy: { createdAt: "desc" },
    include: { salesOrder: { include: { outlet: true } }, arLedgerEntry: { include: { outlet: true } } },
  });

  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-3 text-base font-semibold text-slate-900">Pending Approvals</h2>
        <div className="space-y-3">
          {pending.map((r) => (
            <div key={r.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900 capitalize">{r.type.replace(/_/g, " ")}</p>
                  <p className="text-xs text-slate-500">
                    Requested by {r.requestedBy} · {formatDateTime(r.createdAt)}
                    {r.salesOrder && ` · Order ${r.salesOrder.orderNumber} (${r.salesOrder.outlet.name})`}
                    {r.arLedgerEntry && ` · ${r.arLedgerEntry.type} entry (${r.arLedgerEntry.outlet.name})`}
                  </p>
                  <p className="mt-2 text-sm text-slate-700">{r.reason}</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">Amount: {formatCurrency(r.amount)}</p>
                </div>
                <StatusBadge status={r.status} />
              </div>
              <form action={decideApproval} className="mt-4 flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={r.id} />
                <input className="input max-w-xs flex-1" name="decisionNote" placeholder="Decision note (optional)" />
                <button type="submit" name="decision" value="approved" className="btn-primary">Approve</button>
                <button type="submit" name="decision" value="rejected" className="btn-danger">Reject</button>
              </form>
            </div>
          ))}
          {pending.length === 0 && <p className="text-sm text-slate-400">No pending approvals.</p>}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold text-slate-900">Decision History</h2>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Type</th>
                <th className="th">Requested By</th>
                <th className="th">Amount</th>
                <th className="th">Decided By</th>
                <th className="th">Note</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {decided.map((r) => (
                <tr key={r.id}>
                  <td className="td capitalize">{r.type.replace(/_/g, " ")}</td>
                  <td className="td">{r.requestedBy}</td>
                  <td className="td">{formatCurrency(r.amount)}</td>
                  <td className="td">{r.decidedBy ?? "—"}</td>
                  <td className="td text-xs text-slate-500">{r.decisionNote ?? "—"}</td>
                  <td className="td"><StatusBadge status={r.status} /></td>
                </tr>
              ))}
              {decided.length === 0 && (
                <tr><td className="td text-slate-400" colSpan={6}>No decisions recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
