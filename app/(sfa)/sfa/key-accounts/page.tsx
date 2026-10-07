import Link from "next/link";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import { keyAccountHealth } from "@/lib/key-accounts";
import { formatCurrency } from "@/lib/format";
import { prisma } from "@/lib/prisma";

const DOT = { good: "bg-emerald-500", watch: "bg-amber-500", risk: "bg-rose-500" };

// The key-account manager's home: every key account with its health, and what needs attention first.
export default async function KeyAccountsHome({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { branchId, userId, role } = await getSession();
  const { error, notice } = await searchParams;
  const me = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
  const accounts = await keyAccountHealth(role === "admin" ? null : branchId ? [branchId] : null);
  const sorted = [...accounts].sort((a, b) => ({ risk: 0, watch: 1, good: 2 })[a.flag] - ({ risk: 0, watch: 1, good: 2 })[b.flag] || b.balance - a.balance);
  const total = (f: (a: (typeof accounts)[number]) => number) => accounts.reduce((s, a) => s + f(a), 0);

  return (
    <div className="space-y-4">
      <Banner error={error} notice={notice} />
      <div className="card p-4">
        <p className="text-xs text-slate-500">Key account manager</p>
        <p className="text-lg font-semibold text-slate-900">{me?.name ?? "—"}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-center">
          <div className="rounded-lg bg-blue-50 p-2"><p className="text-base font-semibold text-blue-700">{accounts.length}</p><p className="text-[10px] text-blue-500">Key accounts</p></div>
          <div className="rounded-lg bg-emerald-50 p-2"><p className="text-base font-semibold text-emerald-700">{formatCurrency(total((a) => a.sales30))}</p><p className="text-[10px] text-emerald-600">Sales, last 30 days</p></div>
          <div className="rounded-lg bg-slate-50 p-2"><p className="text-base font-semibold text-slate-800">{formatCurrency(total((a) => a.balance))}</p><p className="text-[10px] text-slate-500">Receivable</p></div>
          <div className="rounded-lg bg-rose-50 p-2"><p className="text-base font-semibold text-rose-700">{formatCurrency(total((a) => a.overdue))}</p><p className="text-[10px] text-rose-500">Overdue</p></div>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">{total((a) => a.openActions)} open next action(s), {total((a) => a.overdueActions)} overdue — <Link className="text-blue-600 underline" href="/sfa/key-accounts/actions">see them</Link></p>
      </div>

      <div className="card divide-y divide-slate-100 p-2">
        {sorted.map((a) => (
          <Link key={a.id} href={`/sfa/key-accounts/${a.id}`} className="block px-2 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${DOT[a.flag]}`} /><p className="text-sm font-medium text-slate-900">{a.name}</p></div>
              <p className="text-xs font-medium text-slate-700">{formatCurrency(a.sales30)}</p>
            </div>
            <p className="ml-4 text-[11px] text-slate-500">Owes {formatCurrency(a.balance)} ({a.usedPct}% of limit){a.overdue ? ` · overdue ${formatCurrency(a.overdue)}` : ""}{a.lastOrderDays !== null ? ` · last order ${a.lastOrderDays}d ago` : " · no orders yet"}</p>
            {a.reasons.length > 0 && <p className="ml-4 text-[11px] text-amber-700">{a.reasons.join(" · ")}</p>}
          </Link>
        ))}
        {sorted.length === 0 && <p className="px-2 py-4 text-sm text-slate-400">No key accounts in your branch.</p>}
      </div>
    </div>
  );
}
