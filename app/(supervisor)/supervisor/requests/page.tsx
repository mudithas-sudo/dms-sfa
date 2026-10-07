import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import StatusBadge from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/format";
import { decideExpense, decideLeave } from "@/app/actions/supervisor-field-actions";

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { branchId } = await getSession();
  const { error, notice } = await searchParams;
  const reps = await prisma.user.findMany({ where: { role: "sales_rep", ...(branchId ? { branchId } : {}) }, select: { id: true, name: true } });
  const ids = reps.map((r) => r.id);
  const name = new Map(reps.map((r) => [r.id, r.name]));
  const [leaves, expenses] = await Promise.all([
    prisma.leaveRequest.findMany({ where: { userId: { in: ids } }, orderBy: { createdAt: "desc" }, take: 40 }),
    prisma.expenseRequest.findMany({ where: { userId: { in: ids } }, orderBy: { createdAt: "desc" }, take: 40 }),
  ]);
  const days = (l: (typeof leaves)[number]) => (l.halfDay ? 0.5 : Math.round((l.endDate.getTime() - l.startDate.getTime()) / 86400000) + 1);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Leave &amp; Expense Approvals</h2>
        <p className="text-xs text-slate-500">Requests from your representatives. Decisions are final, audited and visible to the representative.</p>
      </div>
      <Banner error={error} notice={notice} />

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Leave requests</h3>
        <div className="space-y-2">
          {leaves.filter((l) => l.status === "pending").map((l) => (
            <div key={l.id} className="card p-4">
              <p className="text-sm font-semibold text-slate-900">{name.get(l.userId)} — {l.leaveType} leave, {days(l)} day(s)</p>
              <p className="text-xs text-slate-500">{formatDate(l.startDate)} – {formatDate(l.endDate)}{l.halfDay ? " (half day)" : ""} · {l.reason}{l.attachmentName ? ` · attachment: ${l.attachmentName}` : ""}</p>
              <form action={decideLeave} className="mt-2 flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={l.id} />
                <input className="input max-w-xs flex-1" name="note" placeholder="Note (required to reject / return)" />
                <button type="submit" name="decision" value="approved" className="btn-primary">Approve</button>
                <button type="submit" name="decision" value="returned" className="btn-secondary">Return</button>
                <button type="submit" name="decision" value="rejected" className="btn-danger">Reject</button>
              </form>
            </div>
          ))}
          {leaves.filter((l) => l.status === "pending").length === 0 && <p className="text-sm text-slate-400">No leave waiting.</p>}
        </div>
        <div className="card mt-3 overflow-x-auto">
          <table className="w-full"><thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Representative</th><th className="th">Type</th><th className="th">Dates</th><th className="th">Decision</th><th className="th">Status</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {leaves.filter((l) => l.status !== "pending").map((l) => (
                <tr key={l.id}><td className="td">{name.get(l.userId)}</td><td className="td text-xs capitalize">{l.leaveType}</td><td className="td text-xs">{formatDate(l.startDate)} – {formatDate(l.endDate)}</td><td className="td text-xs text-slate-500">{l.approvedBy ?? "—"}{l.decisionNote ? ` — ${l.decisionNote}` : ""}</td><td className="td"><StatusBadge status={l.status} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Expense claims</h3>
        <div className="space-y-2">
          {expenses.filter((e) => e.status === "pending").map((e) => (
            <div key={e.id} className="card p-4">
              <p className="text-sm font-semibold text-slate-900">{name.get(e.userId)} — {formatCurrency(e.amount)} ({e.category})</p>
              <p className="text-xs text-slate-500">{e.description}{e.expenseDate ? ` · ${formatDate(e.expenseDate)}` : ""}{e.receiptPlaceholder ? " · receipt attached" : " · no receipt"}</p>
              <form action={decideExpense} className="mt-2 flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={e.id} />
                <input className="input max-w-xs flex-1" name="note" placeholder="Note (required to reject / part-approve)" />
                <input className="input w-28" name="approvedAmount" type="number" step="0.01" placeholder="Part amount" />
                <button type="submit" name="decision" value="approved" className="btn-primary">Approve</button>
                <button type="submit" name="decision" value="partially_approved" className="btn-secondary">Part-approve</button>
                <button type="submit" name="decision" value="rejected" className="btn-danger">Reject</button>
              </form>
            </div>
          ))}
          {expenses.filter((e) => e.status === "pending").length === 0 && <p className="text-sm text-slate-400">No expenses waiting.</p>}
        </div>
        <div className="card mt-3 overflow-x-auto">
          <table className="w-full"><thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Representative</th><th className="th">Category</th><th className="th">Amount</th><th className="th">Decision</th><th className="th">Status</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {expenses.filter((e) => e.status !== "pending").map((e) => (
                <tr key={e.id}><td className="td">{name.get(e.userId)}</td><td className="td text-xs capitalize">{e.category}</td><td className="td">{formatCurrency(e.amount)}</td><td className="td text-xs text-slate-500">{e.approvedBy ?? "—"}{e.decisionNote ? ` — ${e.decisionNote}` : ""}</td><td className="td"><StatusBadge status={e.status} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
