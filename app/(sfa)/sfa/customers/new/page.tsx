import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import PhotoCapture from "@/components/PhotoCapture";
import GeoFields from "@/components/GeoFields";
import StatusBadge from "@/components/StatusBadge";
import { registerCustomer } from "@/app/actions/sfa-field-actions";
import { VISIT_DAYS } from "@/lib/masterdata";
import Link from "next/link";

export default async function NewFieldCustomerPage({ searchParams }: { searchParams: Promise<{ edit?: string; error?: string; dups?: string }> }) {
  const { userId } = await getSession();
  const { edit, error, dups } = await searchParams;
  const [channels, mine, routes] = await Promise.all([
    prisma.channel.findMany({ orderBy: { name: "asc" } }),
    userId ? prisma.outlet.findMany({ where: { createdById: userId, onboardingStatus: { in: ["pending", "returned", "rejected"] } }, orderBy: { createdAt: "desc" }, take: 10 }) : [],
    prisma.route.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
  ]);
  const editing = edit ? mine.find((o) => o.id === edit && o.onboardingStatus === "returned") : null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{editing ? "Correct & resubmit" : "New Customer Registration"}</h2>
        <p className="text-xs text-slate-500">Goes to your supervisor for approval; they assign the route, price list and credit terms.</p>
      </div>
      <Banner error={error} />
      {editing?.onboardingReason && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Returned for correction: {editing.onboardingReason}</p>}

      <form action={registerCustomer} className="card space-y-3 p-4" key={editing?.id ?? "new"}>
        {editing && <input type="hidden" name="resubmitId" value={editing.id} />}
        {editing?.photoData && <input type="hidden" name="keepPhoto" value="1" />}
        <div>
          <label className="label" htmlFor="name">Business name *</label>
          <input className="input" id="name" name="name" defaultValue={editing?.name} required />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="channelId">Channel *</label>
            <select className="input" id="channelId" name="channelId" defaultValue={editing?.channelId} required>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="subChannel">Sub-channel *</label>
            <input className="input" id="subChannel" name="subChannel" defaultValue={editing?.subChannel} placeholder="e.g. Sari-sari store" required />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="address">Address *</label>
          <input className="input" id="address" name="address" defaultValue={editing?.address} required />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="ownerName">Owner</label>
            <input className="input" id="ownerName" name="ownerName" defaultValue={editing?.ownerName ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="contactPerson">Contact person</label>
            <input className="input" id="contactPerson" name="contactPerson" defaultValue={editing?.contactPerson ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="phone">Mobile</label>
            <input className="input" id="phone" name="phone" defaultValue={editing?.phone ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="businessRegRef">Business registration ref.</label>
            <input className="input" id="businessRegRef" name="businessRegRef" defaultValue={editing?.businessRegRef ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="proposedRoute">Proposed route</label>
            <select className="input" id="proposedRoute" name="proposedRoute" defaultValue={editing?.proposedRoute ?? ""}>
              <option value="">Let the supervisor decide</option>
              {routes.map((r) => (
                <option key={r.id} value={r.name}>{r.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="visitDay">Proposed visit day</label>
            <select className="input" id="visitDay" name="visitDay" defaultValue={editing?.proposedVisitDay ?? ""}>
              <option value="">—</option>
              {VISIT_DAYS.map((d) => (
                <option key={d} value={d} className="capitalize">{d}</option>
              ))}
            </select>
          </div>
        </div>
        <GeoFields lat={editing?.lat ?? 14.5995} lng={editing?.lng ?? 120.9842} withMock={false} />
        <div>
          <p className="label">Photo of the outlet front *</p>
          <PhotoCapture max={1} label={editing?.photoData ? "Replace photo" : "Take photo"} required={!editing?.photoData} />
        </div>
        <textarea className="input" name="remarks" rows={2} placeholder="Remarks (optional)" defaultValue={editing?.remarks ?? ""} />
        {dups && (
          <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
            <input type="checkbox" name="confirmDuplicate" value="1" className="mt-0.5" />
            <span>This is a different outlet from: {dups}</span>
          </label>
        )}
        <button type="submit" className="btn-primary w-full">{editing ? "Resubmit for approval" : "Submit for approval"}</button>
      </form>

      {mine.length > 0 && (
        <div className="card p-3">
          <p className="mb-1 text-xs font-semibold text-slate-900">My registrations</p>
          <ul className="divide-y divide-slate-100">
            {mine.map((o) => (
              <li key={o.id} className="flex items-center justify-between py-1.5 text-xs">
                <div>
                  <p className="font-medium text-slate-900">{o.name}</p>
                  {o.onboardingReason && <p className="text-amber-700">{o.onboardingReason}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={o.onboardingStatus} />
                  {o.onboardingStatus === "returned" && <Link className="text-blue-600 underline" href={`/sfa/customers/new?edit=${o.id}`}>Fix</Link>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
