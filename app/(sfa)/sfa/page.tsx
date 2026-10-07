import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import SyncStatusWidget from "@/components/SyncStatusWidget";
import SfaSupervisorHome from "@/components/SfaSupervisorHome";
import { daysFromNow, formatCurrency, formatDateTime } from "@/lib/format";
import { dayStart } from "@/lib/van";
import { scorecardFor } from "@/lib/scorecard";
import { MapPin, ChevronRight, UserPlus, ClipboardList, CheckSquare, Calendar, Navigation, ClipboardEdit, Sun, Trophy, FileBarChart, RefreshCw, Undo2 } from "lucide-react";

const MORE_LINKS = [
  { href: "/sfa/attendance", label: "Attendance", icon: Sun },
  { href: "/sfa/route", label: "Beat Plan", icon: Navigation },
  { href: "/sfa/nearby", label: "Nearby", icon: MapPin },
  { href: "/sfa/customers/new", label: "New Customer", icon: UserPlus },
  { href: "/sfa/orders", label: "Orders", icon: ClipboardList },
  { href: "/sfa/field-notes/new", label: "Field Forms", icon: ClipboardEdit },
  { href: "/sfa/tasks", label: "My Tasks", icon: CheckSquare },
  { href: "/sfa/requests", label: "Leave & Expenses", icon: Calendar },
  { href: "/sfa/market-returns/new", label: "Returns", icon: Undo2 },
  { href: "/sfa/scorecard", label: "Scorecard", icon: Trophy },
  { href: "/sfa/reports", label: "Reports", icon: FileBarChart },
  { href: "/sfa/sync", label: "Sync", icon: RefreshCw },
];

export default async function SfaHomePage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { userId, branchId, role } = await getSession();
  if (!userId || !branchId) return <p className="text-sm text-slate-500">No rep selected.</p>;
  const { error, notice } = await searchParams;
  if (role === "key_account") redirect("/sfa/key-accounts");
  if (role === "supervisor" || role === "admin") {
    const me = await prisma.user.findUnique({ where: { id: userId } });
    return (
      <div className="space-y-3">
        <Banner error={error} notice={notice} />
        <SfaSupervisorHome branchId={branchId} name={me?.name ?? "Supervisor"} />
      </div>
    );
  }

  const start = dayStart();
  const month = new Date().toISOString().slice(0, 7);
  const [rep, visitsToday, orders, activeVisit, attendance, tasksDue, unread, device, held] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, include: { route: { include: { stops: { include: { outlet: true }, orderBy: { sequence: "asc" } } } } } }),
    prisma.fieldVisit.findMany({ where: { salespersonId: userId, checkinAt: { gte: start } }, include: { outlet: true } }),
    prisma.salesOrder.aggregate({ where: { salespersonId: userId, orderDate: { gte: start }, status: { notIn: ["draft", "voided", "cancelled"] } }, _sum: { total: true }, _count: true }),
    prisma.fieldVisit.findFirst({ where: { salespersonId: userId, status: "in_progress" }, include: { outlet: true } }),
    prisma.attendance.findFirst({ where: { userId, dayDate: { gte: start } } }),
    prisma.task.count({ where: { assignedToId: userId, status: { in: ["pending", "acknowledged", "in_progress"] }, OR: [{ dueDate: null }, { dueDate: { lte: daysFromNow(1) } }] } }),
    prisma.notification.count({ where: { OR: [{ userId }, { role: "sales_rep", branchId }], readAt: null } }).catch(() => 0),
    prisma.deviceRegistration.findUnique({ where: { userId } }),
    prisma.salesOrder.count({ where: { salespersonId: userId, status: "on_hold" } }),
  ]);
  const card = await scorecardFor(userId, month);
  const sales = card.rows[0];

  const done = visitsToday.filter((v) => v.status === "completed");
  const minutes = done.filter((v) => v.checkoutAt).reduce((a, v) => a + (v.checkoutAt!.getTime() - v.checkinAt.getTime()) / 60000, 0);
  const today = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][new Date().getDay()];
  const stops = (rep?.route?.stops ?? []).filter((s) => !s.outlet.visitDay || s.outlet.visitDay === today);
  const planned = stops.length;
  const productive = visitsToday.filter((v) => v.outcome === "order_taken").length;

  return (
    <div className="space-y-4">
      <Banner error={error} notice={notice} />
      <div className="card p-4">
        <p className="text-xs text-slate-500">Good day,</p>
        <p className="text-lg font-semibold text-slate-900">{rep?.name}</p>
        <p className="text-[11px] text-slate-500">{attendance ? (attendance.status === "completed" ? "Day ended" : `Working since ${formatDateTime(attendance.startAt!).split(",").pop()}`) : <Link className="text-blue-600 underline" href="/sfa/attendance">Start your day</Link>}</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-blue-50 p-3"><p className="text-xs text-blue-500">Orders today</p><p className="text-lg font-semibold text-blue-700">{orders._count}</p></div>
          <div className="rounded-lg bg-emerald-50 p-3"><p className="text-xs text-emerald-600">Sales today</p><p className="text-lg font-semibold text-emerald-700">{formatCurrency(orders._sum.total ?? 0)}</p></div>
        </div>
      </div>

      <div className="card p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Field activity today</h2>
        <div className="grid grid-cols-4 gap-2 text-center">
          <div><p className="text-base font-semibold text-slate-900">{planned}</p><p className="text-[10px] text-slate-500">Planned</p></div>
          <div><p className="text-base font-semibold text-slate-900">{done.length}</p><p className="text-[10px] text-slate-500">Completed</p></div>
          <div><p className="text-base font-semibold text-slate-900">{productive}</p><p className="text-[10px] text-slate-500">Productive</p></div>
          <div><p className="text-base font-semibold text-slate-900">{Math.round(minutes)}</p><p className="text-[10px] text-slate-500">Min in outlets</p></div>
        </div>
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="text-xs text-slate-500">This month&apos;s sales target</p>
          {sales.target ? (
            <>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${(sales.achievement ?? 0) >= 100 ? "bg-emerald-500" : (sales.achievement ?? 0) >= 70 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${Math.min(100, sales.achievement ?? 0)}%` }} /></div>
              <p className="mt-1 text-[11px] text-slate-600">{formatCurrency(sales.value)} of {formatCurrency(sales.target)} — {sales.achievement}%</p>
            </>
          ) : (
            <p className="text-[11px] text-slate-400">No target set for {month}.</p>
          )}
        </div>
      </div>

      {(tasksDue > 0 || held > 0 || unread > 0) && (
        <div className="card space-y-1 p-3 text-xs">
          {tasksDue > 0 && <Link href="/sfa/tasks" className="flex justify-between text-slate-700"><span>📋 {tasksDue} task(s) due soon</span><ChevronRight size={14} /></Link>}
          {held > 0 && <Link href="/sfa/orders" className="flex justify-between text-amber-700"><span>⏳ {held} order(s) waiting for approval</span><ChevronRight size={14} /></Link>}
          {unread > 0 && <Link href="/notifications" className="flex justify-between text-slate-700"><span>🔔 {unread} unread notification(s)</span><ChevronRight size={14} /></Link>}
        </div>
      )}

      <SyncStatusWidget lastSync={device?.lastSyncAt ? formatDateTime(device.lastSyncAt) : null} />

      {activeVisit && (
        <div className="card border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-medium text-amber-700">Visit in progress</p>
          <p className="text-sm text-amber-900">{activeVisit.outlet.name}</p>
          <Link href="/sfa/visit/new" className="mt-2 inline-block text-xs font-medium text-amber-700 underline">Continue / check out</Link>
        </div>
      )}

      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Today&apos;s Beat Plan</h2>
          <Link href="/sfa/route" className="text-xs font-medium text-blue-600">View all</Link>
        </div>
        <ul className="divide-y divide-slate-100">
          {stops.slice(0, 6).map((s) => {
            const v = visitsToday.find((x) => x.outletId === s.outletId);
            return (
              <li key={s.id}>
                <Link href={`/sfa/outlets/${s.outletId}`} className="flex items-center justify-between py-2.5">
                  <div className="flex items-center gap-2">
                    <MapPin size={16} className={v?.status === "completed" ? "text-emerald-500" : v?.status === "skipped" ? "text-amber-500" : "text-slate-300"} />
                    <div>
                      <p className="text-sm font-medium text-slate-900">{s.outlet.name}</p>
                      <p className="text-xs text-slate-500">{s.outlet.subChannel}{v ? ` · ${v.status.replace("_", " ")}` : ""}</p>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-slate-300" />
                </Link>
              </li>
            );
          })}
          {stops.length === 0 && <p className="py-2 text-xs text-slate-400">No stops planned for today.</p>}
        </ul>
      </div>

      <div className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">More</h2>
        <div className="grid grid-cols-4 gap-2">
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
