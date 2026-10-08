import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { currentScope } from "@/lib/report-runner";
import StatusBadge from "@/components/StatusBadge";
import Banner from "@/components/Banner";
import ChannelPicker from "@/components/ChannelPicker";
import { formatCurrency, formatDateTime, daysAgo, daysBetween } from "@/lib/format";
import { decideOutletOnboarding, findDuplicateOutlets } from "@/app/actions/admin-actions";
import { channelOptions, VISIT_DAYS } from "@/lib/masterdata";
import { paymentTermOptions } from "@/lib/reference";

// Central onboarding queue — used by administrators and sales & finance supervisors.
export default async function OnboardingQueue({ back, error, notice }: { back: string; error?: string; notice?: string }) {
  const terms = await paymentTermOptions();
  const { userId } = await getSession();
  const scope = await currentScope();
  const mine = scope.branchIds ? { branchId: { in: scope.branchIds } } : {};
  const [pending, decided, channels, routes, creators] = await Promise.all([
    prisma.outlet.findMany({
      where: { onboardingStatus: "pending", ...mine },
      include: { branch: true, channel: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.outlet.findMany({
      where: { onboardingStatus: { in: ["approved", "rejected", "returned"] }, ...mine },
      include: { branch: true, channel: true },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
    channelOptions(),
    prisma.route.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const creatorName = new Map(creators.map((c) => [c.id, c.name]));
  const dupes = await Promise.all(pending.map((o) => findDuplicateOutlets(o.name, o.address, o.lat, o.lng, o.id)));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span className="text-slate-900">Customer onboarding queue</span>
      </div>
      <Banner error={error} notice={notice} />

      <div>
        <h2 className="mb-3 text-base font-semibold text-slate-900">Pending approval ({pending.length})</h2>
        <div className="space-y-3">
          {pending.map((o, idx) => {
            const waitingDays = Math.max(0, daysBetween(daysAgo(0), o.createdAt));
            const ownRecord = !!userId && o.createdById === userId;
            return (
              <div key={o.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex gap-3">
                    {o.photoData && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={o.photoData} alt="Storefront" className="h-16 w-16 rounded-lg object-cover" />
                    )}
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{o.name}</p>
                      <p className="text-xs text-slate-500">
                        {o.branch.name} · {o.channel.name} · {o.subChannel}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">{o.address}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {o.ownerName ?? o.contactPerson ?? "No contact"} · {o.phone ?? "no mobile"} · GPS {o.lat.toFixed(4)}, {o.lng.toFixed(4)}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Submitted {formatDateTime(o.createdAt)} by {o.createdById ? creatorName.get(o.createdById) ?? "—" : "—"} · requested credit {formatCurrency(o.creditLimit)}
                      </p>
                      {o.proposedRoute && <p className="text-xs text-slate-500">Proposed route / visit day: {o.proposedRoute} {o.proposedVisitDay ?? ""}</p>}
                      {o.remarks && <p className="text-xs text-slate-500">Rep remarks: {o.remarks}</p>}
                    </div>
                  </div>
                  <div className="text-right">
                    <StatusBadge status={o.onboardingStatus} />
                    <p className={`mt-1 text-xs ${waitingDays >= 3 ? "font-semibold text-rose-600" : "text-slate-500"}`}>Waiting {waitingDays} day(s)</p>
                  </div>
                </div>

                {dupes[idx].length > 0 && (
                  <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Probable duplicate of{" "}
                    {dupes[idx].map((d) => (
                      <Link key={d.id} href={`/admin/outlets/${d.id}`} className="underline">{d.name} ({d.code ?? "no code"})</Link>
                    ))}{" "}
                    — check before approving.
                  </p>
                )}
                {ownRecord && (
                  <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    You created this outlet, so another approver must decide it.
                  </p>
                )}

                <form action={decideOutletOnboarding} className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                  <input type="hidden" name="outletId" value={o.id} />
                  <input type="hidden" name="back" value={back} />
                  <p className="text-xs font-medium text-slate-600">Reviewer assigns the commercial details</p>
                  <ChannelPicker channels={channels} channelId={o.channelId} subChannel={o.subChannel} />
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div>
                      <label className="label">Route</label>
                      <select className="input" name="routeId" defaultValue={o.routeId ?? ""}>
                        <option value="">Keep proposed</option>
                        {routes.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">Visit day</label>
                      <select className="input" name="visitDay" defaultValue={o.visitDay ?? o.proposedVisitDay ?? ""}>
                        <option value="">Follow the route</option>
                        {VISIT_DAYS.map((d) => (
                          <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">Payment terms / price list</label>
                      <select className="input" name="paymentTerms" defaultValue={o.paymentTerms}>
                        {terms.map((t) => (
                          <option key={t.id} value={t.id}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">Credit limit (₱)</label>
                      <input className="input" name="creditLimit" type="number" defaultValue={o.creditLimit || 25000} />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input className="input max-w-sm flex-1" name="reason" placeholder="Reason (required to return or reject)" />
                    <button type="submit" name="decision" value="approved" className="btn-primary" disabled={ownRecord}>Approve</button>
                    <button type="submit" name="decision" value="returned" className="btn-secondary" disabled={ownRecord}>Return for correction</button>
                    <button type="submit" name="decision" value="rejected" className="btn-danger" disabled={ownRecord}>Reject</button>
                  </div>
                </form>
              </div>
            );
          })}
          {pending.length === 0 && <p className="text-sm text-slate-400">No outlets awaiting onboarding approval.</p>}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold text-slate-900">Recent decisions</h2>
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
              {decided.length === 0 && (
                <tr>
                  <td className="td text-slate-400" colSpan={4}>No decisions yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
