import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import { formatDate } from "@/lib/format";
import { KA_ACTIVITY_TYPES } from "@/lib/key-accounts";
import { completeKeyAccountAction } from "@/app/actions/key-account-actions";

export default async function KeyAccountActionsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { branchId, role } = await getSession();
  const { notice, error } = await searchParams;
  const outlets = await prisma.outlet.findMany({ where: { channel: { name: { contains: "Key" } }, ...(role === "admin" || !branchId ? {} : { branchId }) }, select: { id: true, name: true } });
  const acts = await prisma.keyAccountActivity.findMany({ where: { outletId: { in: outlets.map((o) => o.id) }, status: "open", nextAction: { not: null } }, orderBy: { nextDue: "asc" } });
  const name = new Map(outlets.map((o) => [o.id, o.name]));
  const now = new Date();
  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold text-slate-900">Next actions</h2>
      <Banner error={error} notice={notice} />
      <div className="card divide-y divide-slate-100 p-2">
        {acts.map((a) => (
          <div key={a.id} className="px-2 py-3">
            <Link href={`/sfa/key-accounts/${a.outletId}`} className="text-sm font-medium text-blue-700 hover:underline">{name.get(a.outletId)}</Link>
            <p className="text-xs text-slate-700">{a.nextAction}</p>
            <p className={`text-[11px] ${a.nextDue && a.nextDue < now ? "font-medium text-rose-600" : "text-slate-500"}`}>{a.nextDue ? `Due ${formatDate(a.nextDue)}${a.nextDue < now ? " — overdue" : ""}` : "No due date"} · from {KA_ACTIVITY_TYPES[a.type]}</p>
            <form action={completeKeyAccountAction} className="mt-1"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="back" value="/sfa/key-accounts/actions" /><button className="text-xs text-blue-600 underline" type="submit">Mark done</button></form>
          </div>
        ))}
        {acts.length === 0 && <p className="px-2 py-4 text-sm text-slate-400">No open next actions.</p>}
      </div>
    </div>
  );
}
