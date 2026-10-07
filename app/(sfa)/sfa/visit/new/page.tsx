import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import GeoFields from "@/components/GeoFields";
import PhotoCapture from "@/components/PhotoCapture";
import { checkInVisit, checkOutVisit } from "@/app/actions/sfa-field-actions";
import { formatDateTime } from "@/lib/format";
import { formatDistance } from "@/lib/geo";
import { getAllSettings, num } from "@/lib/settings";
import { COMPLAINT_CATEGORIES, NO_ORDER_REASONS, VISIT_OUTCOMES } from "@/lib/field-constants";
import { dayStart } from "@/lib/van";

export default async function VisitPage({ searchParams }: { searchParams: Promise<{ outlet?: string; error?: string; notice?: string; far?: string }> }) {
  const { userId, branchId } = await getSession();
  if (!userId || !branchId) return <p className="text-sm text-slate-500">No rep selected.</p>;
  const { outlet: outletParam, error, notice, far } = await searchParams;
  const s = await getAllSettings();

  const activeVisit = await prisma.fieldVisit.findFirst({ where: { salespersonId: userId, status: "in_progress" }, include: { outlet: true } });

  if (activeVisit) {
    const o = activeVisit.outlet;
    const [orders, collections] = await Promise.all([
      prisma.salesOrder.count({ where: { salespersonId: userId, outletId: o.id, orderDate: { gte: activeVisit.checkinAt } } }),
      prisma.aRLedgerEntry.count({ where: { collectedBy: userId, outletId: o.id, type: "payment", entryDate: { gte: activeVisit.checkinAt } } }),
    ]);
    return (
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Visit in progress</h2>
        <Banner error={error} notice={notice} />
        <div className="card p-4">
          <p className="text-sm font-medium text-slate-900">{o.name}</p>
          <p className="text-xs text-slate-500">Checked in {formatDateTime(activeVisit.checkinAt)} · {formatDistance(activeVisit.distanceM ?? 0)} from the outlet · {activeVisit.visitType}</p>
          {activeVisit.outOfTolerance && <p className="mt-1 text-xs text-amber-700">Outside location tolerance — reason: {activeVisit.overrideReason}</p>}
          {activeVisit.mockLocation && <p className="mt-1 text-xs text-rose-600">Mock-location signal flagged.</p>}
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
            <Link href={`/sfa/order/new?outlet=${o.id}`} className="btn-secondary px-1 py-2">Order{orders ? ` (${orders})` : ""}</Link>
            <Link href={`/sfa/collections/new?outlet=${o.id}`} className="btn-secondary px-1 py-2">Collect{collections ? ` (${collections})` : ""}</Link>
            <Link href={`/sfa/field-notes/new?outlet=${o.id}`} className="btn-secondary px-1 py-2">Field form</Link>
          </div>
        </div>
        <form action={checkOutVisit} className="card space-y-3 p-4">
          <input type="hidden" name="visitId" value={activeVisit.id} />
          <div>
            <label className="label" htmlFor="outcome">Visit outcome *</label>
            <select className="input" id="outcome" name="outcome" defaultValue={orders ? "order_taken" : collections ? "collection_only" : ""} required>
              <option value="">— choose —</option>
              {VISIT_OUTCOMES.map((o2) => (
                <option key={o2.id} value={o2.id}>{o2.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="noOrderReason">Reason (required when no order)</label>
            <select className="input" id="noOrderReason" name="noOrderReason" defaultValue="">
              <option value="">—</option>
              {NO_ORDER_REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="serviceRating">Service rating</label>
              <select className="input" id="serviceRating" name="serviceRating" defaultValue="">
                <option value="">—</option>
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>{"★".repeat(n)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="complaintCategory">Complaint type</label>
              <select className="input" id="complaintCategory" name="complaintCategory" defaultValue="">
                <option value="">—</option>
                {COMPLAINT_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <input className="input" name="complaint" placeholder="Customer complaint (optional)" />
          <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" name="followUp" /> Needs follow-up</label>
          <input className="input" type="date" name="followUpDue" aria-label="Follow-up due" />
          <textarea className="input" name="feedback" rows={3} placeholder="Notes: outlet condition, requests, competitor activity…" />
          <PhotoCapture max={num(s, "photo.maxPerForm")} label="Add visit photo" />
          <GeoFields lat={o.lat} lng={o.lng} withMock={false} />
          <button type="submit" className="btn-primary w-full">Check out</button>
          {num(s, "visit.minDurationMin") > 0 && <p className="text-[10px] text-slate-400">Visits shorter than {num(s, "visit.minDurationMin")} minutes are flagged to your supervisor.</p>}
        </form>
      </div>
    );
  }

  const [outlets, attendance] = await Promise.all([
    prisma.outlet.findMany({ where: { branchId, status: "active" }, orderBy: { name: "asc" } }),
    prisma.attendance.findFirst({ where: { userId, dayDate: { gte: dayStart() } } }),
  ]);
  const chosen = outlets.find((o) => o.id === outletParam) ?? outlets[0];

  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold text-slate-900">Check in at a customer</h2>
      <Banner error={error} notice={notice} />
      {!attendance && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Start your day on the <Link className="underline" href="/sfa/attendance">Attendance</Link> screen before checking in.</p>}
      <form action={checkInVisit} className="card space-y-3 p-4" key={chosen?.id}>
        <div>
          <label className="label" htmlFor="outletId">Customer</label>
          <select className="input" id="outletId" name="outletId" defaultValue={chosen?.id}>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        {chosen && <GeoFields lat={chosen.lat} lng={chosen.lng} />}
        {far && (
          <div>
            <label className="label" htmlFor="overrideReason">Reason for checking in {formatDistance(Number(far))} away *</label>
            <input className="input" id="overrideReason" name="overrideReason" required placeholder="e.g. Store entrance is on the next street" />
          </div>
        )}
        <p className="text-[11px] text-slate-500">Check-in must be within {num(s, "visit.toleranceM")} m of the customer ({s["visit.toleranceMode"] === "block" ? "blocked beyond that" : "a reason is needed beyond that"}). Only one visit can be open at a time. A customer outside today&apos;s route is recorded as an unplanned visit for your supervisor.</p>
        <button type="submit" className="btn-primary w-full">Check in</button>
      </form>
      {chosen && <Link className="block text-center text-xs text-blue-600 underline" href={`/sfa/outlets/${chosen.id}`}>Open {chosen.name} profile</Link>}
    </div>
  );
}
