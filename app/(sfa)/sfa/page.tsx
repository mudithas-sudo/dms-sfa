import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { formatCurrency } from "@/lib/format";
import SyncStatusWidget from "@/components/SyncStatusWidget";
import { MapPin, ChevronRight, UserPlus, ClipboardList, CheckSquare, Calendar, Navigation, ClipboardEdit, Sun } from "lucide-react";

const MORE_LINKS = [
  { href: "/sfa/attendance", label: "Attendance", icon: Sun },
  { href: "/sfa/route", label: "Beat Plan", icon: Navigation },
  { href: "/sfa/nearby", label: "Nearby Outlets", icon: MapPin },
  { href: "/sfa/customers/new", label: "New Customer", icon: UserPlus },
  { href: "/sfa/orders", label: "Order History", icon: ClipboardList },
  { href: "/sfa/field-notes/new", label: "Field Note", icon: ClipboardEdit },
  { href: "/sfa/tasks", label: "My Tasks", icon: CheckSquare },
  { href: "/sfa/requests", label: "Leave & Expenses", icon: Calendar },
];

export default async function SfaHomePage() {
  const { userId, branchId } = await getSession();
  if (!userId || !branchId) return <p className="text-sm text-slate-500">No rep selected.</p>;

  const rep = await prisma.user.findUnique({ where: { id: userId }, include: { route: { include: { stops: { include: { outlet: true }, orderBy: { sequence: "asc" } } } } } });

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [visitsToday, ordersToday, activeVisit] = await Promise.all([
    prisma.fieldVisit.findMany({ where: { salespersonId: userId, checkinAt: { gte: startOfToday } }, include: { outlet: true } }),
    prisma.salesOrder.aggregate({ where: { salespersonId: userId, orderDate: { gte: startOfToday } }, _sum: { total: true }, _count: true }),
    prisma.fieldVisit.findFirst({ where: { salespersonId: userId, status: "in_progress" }, include: { outlet: true } }),
  ]);

  const stops = (rep?.route?.stops ?? []).slice(0, 6);

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <p className="text-xs text-slate-500">Good day,</p>
        <p className="text-lg font-semibold text-slate-900">{rep?.name}</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-blue-50 p-3">
            <p className="text-xs text-blue-500">Orders Today</p>
            <p className="text-lg font-semibold text-blue-700">{ordersToday._count}</p>
          </div>
          <div className="rounded-lg bg-emerald-50 p-3">
            <p className="text-xs text-emerald-600">Sales Today</p>
            <p className="text-lg font-semibold text-emerald-700">{formatCurrency(ordersToday._sum.total ?? 0)}</p>
          </div>
        </div>
      </div>

      <SyncStatusWidget />

      {activeVisit && (
        <div className="card border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-medium text-amber-700">Visit in progress</p>
          <p className="text-sm text-amber-900">{activeVisit.outlet.name}</p>
          <Link href="/sfa/visit/new" className="mt-2 inline-block text-xs font-medium text-amber-700 underline">
            Continue check-out
          </Link>
        </div>
      )}

      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Today&apos;s Beat Plan</h2>
          <Link href="/sfa/route" className="text-xs font-medium text-blue-600">View all</Link>
        </div>
        <ul className="divide-y divide-slate-100">
          {stops.map((s) => {
            const visited = visitsToday.some((v) => v.outletId === s.outletId);
            return (
              <li key={s.id}>
                <Link href={`/sfa/outlets/${s.outletId}`} className="flex items-center justify-between py-2.5">
                  <div className="flex items-center gap-2">
                    <MapPin size={16} className={visited ? "text-emerald-500" : "text-slate-300"} />
                    <div>
                      <p className="text-sm font-medium text-slate-900">{s.outlet.name}</p>
                      <p className="text-xs text-slate-500">{s.outlet.subChannel}</p>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-slate-300" />
                </Link>
              </li>
            );
          })}
          {stops.length === 0 && <p className="py-2 text-xs text-slate-400">No beat plan configured for your route.</p>}
        </ul>
      </div>

      <div className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">More</h2>
        <div className="grid grid-cols-4 gap-3">
          {MORE_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="flex flex-col items-center gap-1 rounded-lg p-2 text-center hover:bg-slate-50">
              <l.icon size={20} className="text-slate-500" />
              <span className="text-[10px] leading-tight text-slate-600">{l.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
