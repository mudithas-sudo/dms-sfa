import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { MapPin, ChevronRight } from "lucide-react";

export default async function RoutePlanPage() {
  const { userId } = await getSession();
  if (!userId) return <p className="text-sm text-slate-500">No rep selected.</p>;

  const rep = await prisma.user.findUnique({
    where: { id: userId },
    include: { route: { include: { stops: { include: { outlet: true }, orderBy: { sequence: "asc" } } } } },
  });

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const visitsToday = await prisma.fieldVisit.findMany({ where: { salespersonId: userId, checkinAt: { gte: startOfToday } } });
  const visitedIds = new Set(visitsToday.map((v) => v.outletId));

  const stops = rep?.route?.stops ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Today&apos;s Beat Plan</h2>
        <p className="text-xs text-slate-500">{rep?.route?.name ?? "No route assigned"} · {stops.length} stops in fixed sequence</p>
      </div>

      <div className="card divide-y divide-slate-100 p-2">
        {stops.map((s) => {
          const visited = visitedIds.has(s.outletId);
          return (
            <Link key={s.id} href={`/sfa/outlets/${s.outletId}`} className="flex items-center justify-between px-2 py-3">
              <div className="flex items-center gap-3">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${visited ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                  {s.sequence}
                </span>
                <div>
                  <p className="text-sm font-medium text-slate-900">{s.outlet.name}</p>
                  <p className="text-xs text-slate-500">{s.outlet.subChannel}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {visited ? <MapPin size={16} className="text-emerald-500" /> : null}
                <ChevronRight size={16} className="text-slate-300" />
              </div>
            </Link>
          );
        })}
        {stops.length === 0 && <p className="px-2 py-4 text-sm text-slate-400">No beat plan configured for your route.</p>}
      </div>
    </div>
  );
}
