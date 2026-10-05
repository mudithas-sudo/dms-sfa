import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { startAttendanceDay, endAttendanceDay } from "@/app/actions/sfa-actions";
import { formatDateTime } from "@/lib/format";

export default async function AttendancePage() {
  const { userId } = await getSession();
  if (!userId) return <p className="text-sm text-slate-500">No rep selected.</p>;

  const [active, recent, rep] = await Promise.all([
    prisma.attendance.findFirst({ where: { userId, status: "in_progress" } }),
    prisma.attendance.findMany({ where: { userId, status: "completed" }, orderBy: { dayDate: "desc" }, take: 5 }),
    prisma.user.findUnique({ where: { id: userId }, include: { branch: true } }),
  ]);

  const lat = rep?.branch ? 14.5995 : 0;
  const lng = rep?.branch ? 120.9842 : 0;

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">Attendance</h2>

      {active ? (
        <div className="card border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-800">Day in progress</p>
          <p className="text-xs text-amber-700">Started {formatDateTime(active.startAt!)}</p>
          <form action={endAttendanceDay} className="mt-3">
            <input type="hidden" name="attendanceId" value={active.id} />
            <input type="hidden" name="lat" value={lat} />
            <input type="hidden" name="lng" value={lng} />
            <button type="submit" className="btn-primary w-full">End Day</button>
          </form>
        </div>
      ) : (
        <div className="card p-4">
          <p className="text-sm text-slate-600">You haven&apos;t started your day yet.</p>
          <form action={startAttendanceDay} className="mt-3">
            <input type="hidden" name="lat" value={lat} />
            <input type="hidden" name="lng" value={lng} />
            <button type="submit" className="btn-primary w-full">Start Day (simulated GPS)</button>
          </form>
        </div>
      )}

      <div className="card p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Recent Days</h3>
        <ul className="space-y-2">
          {recent.map((a) => (
            <li key={a.id} className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm last:border-0">
              <span>{a.dayDate.toLocaleDateString("en-PH")}</span>
              <span className="text-xs text-slate-500">
                {a.startAt && formatDateTime(a.startAt).split(",").pop()} – {a.endAt && formatDateTime(a.endAt).split(",").pop()}
              </span>
            </li>
          ))}
          {recent.length === 0 && <p className="text-xs text-slate-400">No completed days yet.</p>}
        </ul>
      </div>
    </div>
  );
}
