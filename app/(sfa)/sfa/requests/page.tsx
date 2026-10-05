import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import StatusBadge from "@/components/StatusBadge";
import { formatDate, formatCurrency } from "@/lib/format";
import { submitLeaveRequest, submitExpenseRequest } from "@/app/actions/sfa-actions";

export default async function RequestsPage() {
  const { userId } = await getSession();
  if (!userId) return <p className="text-sm text-slate-500">No rep selected.</p>;

  const [leaves, expenses] = await Promise.all([
    prisma.leaveRequest.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    prisma.expenseRequest.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Leave & Expense Requests</h2>
        <p className="text-xs text-amber-600">Conditional workflow — subject to confirmation per company policy.</p>
      </div>

      <div className="card space-y-3 p-4">
        <h3 className="text-sm font-semibold text-slate-900">Leave Requests</h3>
        <ul className="space-y-2">
          {leaves.map((l) => (
            <li key={l.id} className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm last:border-0">
              <span>{formatDate(l.startDate)} – {formatDate(l.endDate)}: {l.reason}</span>
              <StatusBadge status={l.status} />
            </li>
          ))}
          {leaves.length === 0 && <p className="text-xs text-slate-400">No leave requests yet.</p>}
        </ul>
        <form action={submitLeaveRequest} className="space-y-2 border-t border-slate-100 pt-3">
          <div className="grid grid-cols-2 gap-2">
            <input className="input" type="date" name="startDate" required />
            <input className="input" type="date" name="endDate" required />
          </div>
          <input className="input" name="reason" placeholder="Reason" required />
          <button type="submit" className="btn-secondary w-full">Request Leave</button>
        </form>
      </div>

      <div className="card space-y-3 p-4">
        <h3 className="text-sm font-semibold text-slate-900">Expense Requests</h3>
        <ul className="space-y-2">
          {expenses.map((e) => (
            <li key={e.id} className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm last:border-0">
              <span>{formatCurrency(e.amount)} — {e.category}: {e.description}</span>
              <StatusBadge status={e.status} />
            </li>
          ))}
          {expenses.length === 0 && <p className="text-xs text-slate-400">No expense requests yet.</p>}
        </ul>
        <form action={submitExpenseRequest} className="space-y-2 border-t border-slate-100 pt-3">
          <div className="grid grid-cols-2 gap-2">
            <input className="input" type="number" step="0.01" name="amount" placeholder="Amount" required />
            <select className="input" name="category" defaultValue="fuel">
              <option value="fuel">Fuel</option>
              <option value="meals">Meals</option>
              <option value="travel">Travel</option>
              <option value="other">Other</option>
            </select>
          </div>
          <input className="input" name="description" placeholder="Description" required />
          <button type="submit" className="btn-secondary w-full">Request Reimbursement</button>
        </form>
      </div>
    </div>
  );
}
