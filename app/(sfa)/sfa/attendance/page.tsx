import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import DeviceClock from "@/components/DeviceClock";
import { endDay, openItems, startDay } from "@/app/actions/sfa-workforce-actions";
import { formatDateTime } from "@/lib/format";
import { dayStart } from "@/lib/van";

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { userId } = await getSession();
  if (!userId) return <p className="text-sm text-slate-500">No rep selected.</p>;
  const { error, notice } = await searchParams;

  const [today, recent, rep] = await Promise.all([
    prisma.attendance.findFirst({ where: { userId, dayDate: { gte: dayStart() } } }),
    prisma.attendance.findMany({ where: { userId, status: "completed", dayDate: { lt: dayStart() } }, orderBy: { dayDate: "desc" }, take: 6 }),
    prisma.user.findUnique({ where: { id: userId }, include: { branch: true, route: { include: { stops: { include: { outlet: true }, orderBy: { sequence: "asc" }, take: 1 } } } } }),
  ]);
  const first = rep?.route?.stops[0]?.outlet;
  const lat = first?.lat ?? 14.5995;
  const lng = first?.lng ?? 120.9842;
  const items = today?.status === "in_progress" ? await openItems(userId) : [];

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">Attendance</h2>
      <Banner error={error} notice={notice} />

      {!today && (
        <div className="card p-4">
          <p className="text-sm text-slate-600">You haven&apos;t started your day yet. Starting the day stamps your time and GPS position and unlocks check-ins.</p>
          <form action={startDay} className="mt-3">
            <input type="hidden" name="lat" value={lat} /><input type="hidden" name="lng" value={lng} /><DeviceClock />
            <button type="submit" className="btn-primary w-full">Start day (GPS stamped)</button>
          </form>
        </div>
      )}

      {today?.status === "in_progress" && (
        <div className="card border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-800">Day in progress</p>
          <p className="text-xs text-amber-700">Started {formatDateTime(today.startAt!)} · {today.startVariance === "late" ? "late start" : "on time"}{today.clockSkewFlag ? " · device clock differs from the server" : ""}</p>
          {today.reopenReason && <p className="mt-1 text-xs text-amber-700">Reopened by {today.reopenedBy}: {today.reopenReason}</p>}
          {items.length > 0 && (
            <ul className="mt-2 list-disc pl-4 text-xs text-rose-700">
              {items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
          <form action={endDay} className="mt-3">
            <input type="hidden" name="attendanceId" value={today.id} /><input type="hidden" name="lat" value={lat} /><input type="hidden" name="lng" value={lng} />
            <button type="submit" className="btn-primary w-full" disabled={items.length > 0}>End day</button>
          </form>
          <p className="mt-2 text-[11px] text-amber-700">The day cannot end while a visit is open, a van reconciliation is outstanding or drafts are pending. Quick links: <Link className="underline" href="/sfa/visit/new">Visit</Link> · <Link className="underline" href="/sfa/eod">End-of-day</Link> · <Link className="underline" href="/sfa/orders">Orders</Link></p>
        </div>
      )}

      {today?.status === "completed" && (
        <div className="card border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-medium text-emerald-800">Day completed</p>
          <p className="text-xs text-emerald-700">{formatDateTime(today.startAt!)} → {formatDateTime(today.endAt!)}. To add more work, ask your supervisor to reopen the day.</p>
        </div>
      )}

      <div className="card p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Recent days</h3>
        <ul className="space-y-2">
          {recent.map((a) => (
            <li key={a.id} className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm last:border-0">
              <span>{a.dayDate.toLocaleDateString("en-PH")}{a.startVariance === "late" ? " · late" : ""}</span>
              <span className="text-xs text-slate-500">{a.startAt && formatDateTime(a.startAt).split(",").pop()} – {a.endAt && formatDateTime(a.endAt).split(",").pop()}</span>
            </li>
          ))}
          {recent.length === 0 && <p className="text-xs text-slate-400">No completed days yet.</p>}
        </ul>
      </div>
    </div>
  );
}
