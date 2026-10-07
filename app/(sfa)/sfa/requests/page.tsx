import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import StatusBadge from "@/components/StatusBadge";
import { formatDate, formatCurrency } from "@/lib/format";
import { getAllSettings, num } from "@/lib/settings";
import { EXPENSE_CATEGORIES, LEAVE_TYPES } from "@/lib/field-constants";
import { submitExpense, submitLeave } from "@/app/actions/sfa-workforce-actions";

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { userId } = await getSession();
  if (!userId) return <p className="text-sm text-slate-500">No rep selected.</p>;
  const { error, notice } = await searchParams;
  const s = await getAllSettings();
  const year = new Date().getFullYear();

  const [leaves, expenses] = await Promise.all([
    prisma.leaveRequest.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    prisma.expenseRequest.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
  ]);
  const days = (l: (typeof leaves)[number]) => (l.halfDay ? 0.5 : Math.round((l.endDate.getTime() - l.startDate.getTime()) / 86400000) + 1);
  const allowance: Record<string, number> = { annual: num(s, "leave.annualDays"), sick: num(s, "leave.sickDays"), emergency: num(s, "leave.emergencyDays") };
  const used = (type: string) => leaves.filter((l) => l.leaveType === type && ["approved", "pending"].includes(l.status) && l.startDate.getFullYear() === year).reduce((a, l) => a + days(l), 0);

  return (
    <div className="space-y-5">
      <h2 className="text-base font-semibold text-slate-900">Leave &amp; Expenses</h2>
      <Banner error={error} notice={notice} />

      <div className="card space-y-3 p-4">
        <h3 className="text-sm font-semibold text-slate-900">Leave</h3>
        <div className="grid grid-cols-3 gap-2 text-center">
          {LEAVE_TYPES.map((t) => (
            <div key={t.id} className="rounded-lg bg-slate-50 p-2"><p className="text-[10px] text-slate-500">{t.label}</p><p className="text-sm font-semibold text-slate-900">{Math.max(0, allowance[t.id] - used(t.id))}<span className="text-[10px] font-normal text-slate-400"> / {allowance[t.id]} left</span></p></div>
          ))}
        </div>
        <ul className="space-y-2">
          {leaves.map((l) => (
            <li key={l.id} className="border-b border-slate-100 pb-2 text-sm last:border-0">
              <div className="flex items-center justify-between"><span className="capitalize">{l.leaveType} · {days(l)} day(s)</span><StatusBadge status={l.status} /></div>
              <p className="text-xs text-slate-500">{formatDate(l.startDate)} – {formatDate(l.endDate)} · {l.reason}</p>
              {l.decisionNote && <p className="text-xs text-slate-600">{l.approvedBy}: {l.decisionNote}</p>}
            </li>
          ))}
          {leaves.length === 0 && <p className="text-xs text-slate-400">No leave requests yet.</p>}
        </ul>
        <form action={submitLeave} className="space-y-2 border-t border-slate-100 pt-3">
          <select className="input" name="leaveType" defaultValue="annual">{LEAVE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          <div className="grid grid-cols-2 gap-2"><input className="input" type="date" name="startDate" required /><input className="input" type="date" name="endDate" required /></div>
          <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" name="halfDay" /> Half day</label>
          <input className="input" name="reason" placeholder="Reason" required />
          <input className="input text-xs" type="file" name="attachment" />
          <button type="submit" className="btn-secondary w-full">Request leave</button>
        </form>
      </div>

      <div className="card space-y-3 p-4">
        <h3 className="text-sm font-semibold text-slate-900">Expense claims</h3>
        <ul className="space-y-2">
          {expenses.map((e) => (
            <li key={e.id} className="border-b border-slate-100 pb-2 text-sm last:border-0">
              <div className="flex items-center justify-between"><span>{formatCurrency(e.amount)} — {e.category}</span><StatusBadge status={e.status} /></div>
              <p className="text-xs text-slate-500">{e.description}{e.receiptPlaceholder ? " · receipt attached" : ""}</p>
              {e.decisionNote && <p className="text-xs text-slate-600">{e.approvedBy}: {e.decisionNote}</p>}
            </li>
          ))}
          {expenses.length === 0 && <p className="text-xs text-slate-400">No expense claims yet.</p>}
        </ul>
        <form action={submitExpense} className="space-y-2 border-t border-slate-100 pt-3">
          <div className="grid grid-cols-2 gap-2">
            <input className="input" type="number" step="0.01" name="amount" placeholder="Amount (₱)" required />
            <select className="input" name="category" defaultValue="fuel">{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}</select>
          </div>
          <input className="input" type="date" name="expenseDate" />
          <input className="input" name="description" placeholder="Description" required />
          <input className="input text-xs" type="file" name="receipt" />
          <p className="text-[10px] text-slate-400">A receipt is required above {formatCurrency(num(s, "expense.receiptAbove"))}.</p>
          <button type="submit" className="btn-secondary w-full">Submit claim</button>
        </form>
      </div>
    </div>
  );
}
