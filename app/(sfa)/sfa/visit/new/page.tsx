import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { checkInVisit, checkOutVisit } from "@/app/actions/sfa-actions";
import { formatDateTime } from "@/lib/format";
import { Camera } from "lucide-react";

export default async function VisitPage({
  searchParams,
}: {
  searchParams: Promise<{ outlet?: string }>;
}) {
  const { userId, branchId } = await getSession();
  if (!userId || !branchId) return <p className="text-sm text-slate-500">No rep selected.</p>;
  const { outlet: outletParam } = await searchParams;

  const activeVisit = await prisma.fieldVisit.findFirst({
    where: { salespersonId: userId, status: "in_progress" },
    include: { outlet: true },
  });

  if (activeVisit) {
    return (
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-slate-900">Field Visit — Check Out</h2>
        <div className="card p-4">
          <p className="text-sm font-medium text-slate-900">{activeVisit.outlet.name}</p>
          <p className="text-xs text-slate-500">Checked in {formatDateTime(activeVisit.checkinAt)}</p>
          <p className="mt-1 text-xs text-slate-500">
            GPS: {activeVisit.checkinLat.toFixed(4)}, {activeVisit.checkinLng.toFixed(4)}
          </p>
        </div>
        <form action={checkOutVisit} className="card space-y-4 p-4">
          <input type="hidden" name="visitId" value={activeVisit.id} />
          <div>
            <label className="label" htmlFor="feedback">Feedback / Notes</label>
            <textarea className="input" id="feedback" name="feedback" rows={4} placeholder="Outlet condition, competitor activity, stock requests..." />
          </div>
          <button type="button" className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 py-6 text-sm text-slate-400">
            <Camera size={18} /> Tap to attach photo (placeholder)
          </button>
          <button type="submit" className="btn-primary w-full">Check Out</button>
        </form>
      </div>
    );
  }

  const outlets = await prisma.outlet.findMany({ where: { branchId, status: "active" }, orderBy: { name: "asc" } });

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">Field Visit — Check In</h2>
      <form action={checkInVisit} className="card space-y-4 p-4">
        <div>
          <label className="label" htmlFor="outletId">Outlet</label>
          <select className="input" id="outletId" name="outletId" defaultValue={outletParam}>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        <p className="text-xs text-slate-500">Tapping check-in will simulate capturing your current GPS location at the outlet.</p>
        <button type="submit" className="btn-primary w-full">Check In</button>
      </form>
    </div>
  );
}
