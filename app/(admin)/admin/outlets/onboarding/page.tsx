import Link from "next/link";
import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/format";
import { decideOutletOnboarding } from "@/app/actions/admin-actions";

export default async function OutletOnboardingPage() {
  const [pending, decided] = await Promise.all([
    prisma.outlet.findMany({
      where: { onboardingStatus: "pending" },
      include: { branch: true, channel: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.outlet.findMany({
      where: { onboardingStatus: { in: ["approved", "rejected"] } },
      include: { branch: true, channel: true },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/admin/outlets" className="hover:underline">Outlets</Link>
        <span>/</span>
        <span className="text-slate-900">Onboarding Queue</span>
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold text-slate-900">Pending Approval</h2>
        <div className="space-y-3">
          {pending.map((o) => (
            <div key={o.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{o.name}</p>
                  <p className="text-xs text-slate-500">
                    {o.branch.name} · {o.channel.name} · {o.subChannel}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{o.address}</p>
                  <p className="mt-1 text-xs text-slate-500">Requested credit limit: {formatCurrency(o.creditLimit)} · Submitted {formatDate(o.createdAt)}</p>
                </div>
                <StatusBadge status={o.onboardingStatus} />
              </div>
              <form action={decideOutletOnboarding} className="mt-4 flex flex-wrap items-center gap-2">
                <input type="hidden" name="outletId" value={o.id} />
                <input className="input max-w-xs flex-1" name="reason" placeholder="Rejection reason (required if rejecting)" />
                <button type="submit" name="decision" value="approved" className="btn-primary">Approve</button>
                <button type="submit" name="decision" value="rejected" className="btn-danger">Reject</button>
              </form>
            </div>
          ))}
          {pending.length === 0 && <p className="text-sm text-slate-400">No outlets awaiting onboarding approval.</p>}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold text-slate-900">Recent Decisions</h2>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Outlet</th>
                <th className="th">Branch</th>
                <th className="th">Reason</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {decided.map((o) => (
                <tr key={o.id}>
                  <td className="td font-medium text-slate-900">{o.name}</td>
                  <td className="td">{o.branch.name}</td>
                  <td className="td text-xs text-slate-500">{o.onboardingReason ?? "—"}</td>
                  <td className="td"><StatusBadge status={o.onboardingStatus} /></td>
                </tr>
              ))}
              {decided.length === 0 && <tr><td className="td text-slate-400" colSpan={4}>No decisions yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
