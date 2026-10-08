import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { formatCurrency, formatDate } from "@/lib/format";
import { KA_ACTIVITY_TYPES, keyAccountHealth } from "@/lib/key-accounts";

const DOT = { good: "bg-emerald-500", watch: "bg-amber-500", risk: "bg-rose-500" };

// Supervisor and head-office oversight of the key accounts and the activity logged against them.
export default async function SupervisorKeyAccountsPage() {
  const { branchId, role } = await getSession();
  const scope = role === "admin" || !branchId ? null : [branchId];
  const accounts = await keyAccountHealth(scope);
  const ids = accounts.map((a) => a.id);
  const [acts, users] = await Promise.all([
    prisma.keyAccountActivity.findMany({ where: { outletId: { in: ids } }, orderBy: { createdAt: "desc" }, take: 25 }),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const uname = new Map(users.map((u) => [u.id, u.name]));
  const aname = new Map(accounts.map((a) => [a.id, a.name]));
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Key Accounts</h2>
        <p className="text-xs text-slate-500">Accounts in the Key Accounts channel with a health flag, and the activity logged by the salesmen and supervisors. An account is flagged when credit, overdue balance, ordering, sales trend or contact slips.</p>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Account</th><th className="th text-right">Sales 30d</th><th className="th text-right">vs previous 30d</th><th className="th text-right">Receivable</th><th className="th text-right">Overdue</th><th className="th text-right">Credit used</th><th className="th">Last order</th><th className="th">Last contact</th><th className="th">Open actions</th><th className="th">Health</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {accounts.map((a) => (
              <tr key={a.id}>
                <td className="td font-medium text-slate-900">{a.name}</td>
                <td className="td text-right">{formatCurrency(a.sales30)}</td>
                <td className={`td text-right text-xs ${a.salesPrev30 && a.sales30 < a.salesPrev30 ? "text-rose-600" : "text-emerald-600"}`}>{a.salesPrev30 ? `${Math.round(((a.sales30 - a.salesPrev30) / a.salesPrev30) * 100)}%` : "—"}</td>
                <td className="td text-right">{formatCurrency(a.balance)}</td><td className={`td text-right ${a.overdue ? "text-rose-600" : ""}`}>{a.overdue ? formatCurrency(a.overdue) : "—"}</td><td className="td text-right">{a.usedPct}%</td>
                <td className="td text-xs">{a.lastOrderDays !== null ? `${a.lastOrderDays}d ago` : "never"}</td><td className="td text-xs">{a.lastActivityDays !== null ? `${a.lastActivityDays}d ago` : "never"}</td>
                <td className="td text-xs">{a.openActions}{a.overdueActions ? <span className="text-rose-600"> ({a.overdueActions} overdue)</span> : ""}</td>
                <td className="td"><span className="flex items-center gap-1.5 text-xs"><span className={`h-2.5 w-2.5 rounded-full ${DOT[a.flag]}`} />{a.reasons.join(" · ") || "Healthy"}</span></td>
              </tr>
            ))}
            {accounts.length === 0 && <tr><td className="td text-slate-400" colSpan={10}>No key accounts.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card overflow-x-auto">
        <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Recent key-account activity</h3>
        <table className="w-full">
          <thead className="bg-slate-50"><tr><th className="th">When</th><th className="th">Logged by</th><th className="th">Account</th><th className="th">Activity</th><th className="th">Outcome</th><th className="th">Next action</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {acts.map((a) => (
              <tr key={a.id}><td className="td text-xs">{formatDate(a.createdAt)}</td><td className="td">{uname.get(a.userId)}</td><td className="td">{aname.get(a.outletId)}</td><td className="td text-xs">{KA_ACTIVITY_TYPES[a.type]}<p className="text-slate-500">{a.summary}</p></td><td className="td text-xs">{a.outcome ?? "—"}</td><td className="td text-xs">{a.nextAction ? `${a.nextAction}${a.nextDue ? ` (${formatDate(a.nextDue)})` : ""} · ${a.status}` : "—"}</td></tr>
            ))}
            {acts.length === 0 && <tr><td className="td text-slate-400" colSpan={6}>No activity logged yet. <Link className="text-blue-600 underline" href="/sfa/key-accounts">Open the key accounts on the mobile app</Link></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
