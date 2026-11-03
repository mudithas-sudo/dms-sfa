import Sidebar, { type NavItem } from "@/components/Sidebar";
import RoleSwitcher from "@/components/RoleSwitcher";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Bell, Building2, Warehouse, ShieldCheck, BarChart3, LayoutDashboard, ChevronDown } from "lucide-react";
import SearchBox from "@/components/SearchBox";
import { switcherLists } from "@/lib/switcher-lists";
import Forbidden from "@/components/Forbidden";
import MfaGate from "@/components/MfaGate";
import { getSetting } from "@/lib/settings";
import { groupAllowed, GROUP_ACCESS } from "@/lib/rbac";
import { roleLabel, ROLES, type RoleId } from "@/lib/constants";

export default async function AppShell({
  role,
  branchId,
  userId,
  navItems,
  title,
  group,
  children,
}: {
  role: RoleId;
  branchId: string | null;
  userId: string | null;
  navItems: NavItem[];
  title: string;
  group: keyof typeof GROUP_ACCESS;
  children: React.ReactNode;
}) {
  const allowed = groupAllowed(role, group);
  const branchScoped = role !== "admin" && role !== "management";

  const [mfaRoles, me, unread, lists, activeBranch] = await Promise.all([
    getSetting("mfa.privilegedRoles"),
    userId ? prisma.user.findUnique({ where: { id: userId }, select: { name: true, mfaEnrolled: true } }) : null,
    prisma.notification.count({
      where: { readAt: null, OR: [...(userId ? [{ userId }] : []), { role, userId: null }] },
    }),
    switcherLists(),
    branchScoped && branchId ? prisma.branch.findUnique({ where: { id: branchId } }) : null,
  ]);
  const { branches, users } = lists;
  const needsMfa = mfaRoles.split(",").includes(role) && !!me && !me.mfaEnrolled;

  const GROUP_ICON = { admin: Building2, branch: Warehouse, supervisor: ShieldCheck, management: BarChart3 } as const;
  const TitleIcon = GROUP_ICON[group as keyof typeof GROUP_ICON] ?? LayoutDashboard;
  const person = me?.name ?? roleLabel(role);
  const initials = person.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="p-2.5 sm:p-5">
      <div className="app-frame">
        <Sidebar navItems={navItems} roleLabel={roleLabel(role)} />
        <div className="work-panel">
          <header className="top-bar">
            <TitleIcon size={20} strokeWidth={1.75} className="shrink-0 text-slate-900" aria-hidden="true" />
            <div className="flex min-w-0 items-baseline gap-2">
              <h1 className="truncate text-xl font-semibold leading-tight text-slate-900">{title}</h1>
              {activeBranch && <span className="hidden truncate text-sm text-slate-500 lg:inline">{activeBranch.name}</span>}
            </div>
            <div className="no-print ml-auto flex items-center gap-2.5">
              <SearchBox items={navItems.map((n) => ({ href: n.href, label: n.label }))} />
              <Link href="/notifications" className="btn-round relative h-10 w-10" title="Notifications" aria-label="Notifications">
                <Bell size={18} />
                {unread > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[11px] font-semibold text-white">
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </Link>
              <details className="relative">
                <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-xl border border-slate-200 bg-white py-1 pl-1 pr-3 shadow-xs [&::-webkit-details-marker]:hidden">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-white">{initials}</span>
                  <span className="hidden max-w-[9rem] truncate text-sm font-medium text-slate-800 sm:inline">{person}</span>
                  <ChevronDown size={14} className="text-slate-500" aria-hidden="true" />
                </summary>
                <div className="absolute right-0 top-12 z-40 w-[min(92vw,640px)] rounded-2xl border border-slate-200 bg-white p-4 shadow-lg">
                  <p className="mb-2 text-xs font-semibold text-slate-500">Demo: switch role, branch or user</p>
                  <RoleSwitcher currentRole={role} currentBranchId={branchId} currentUserId={userId} branches={branches} users={users} />
                </div>
              </details>
            </div>
          </header>
          <main className="flex-1 overflow-y-auto px-8 pb-10 pt-6">{needsMfa ? <MfaGate userName={me!.name} roleName={roleLabel(role)} back={ROLES.find((r) => r.id === role)?.homePath ?? "/"} /> : allowed ? children : <Forbidden role={role} area={title} />}</main>
        </div>
      </div>
    </div>
  );
}
