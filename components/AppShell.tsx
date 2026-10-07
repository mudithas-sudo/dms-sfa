import Sidebar, { type NavItem } from "@/components/Sidebar";
import RoleSwitcher from "@/components/RoleSwitcher";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Bell } from "lucide-react";
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

  const [mfaRoles, me] = await Promise.all([
    getSetting("mfa.privilegedRoles"),
    userId ? prisma.user.findUnique({ where: { id: userId }, select: { name: true, mfaEnrolled: true } }) : null,
  ]);
  const needsMfa = mfaRoles.split(",").includes(role) && !!me && !me.mfaEnrolled;
  const [unread, branches, users, activeBranch] = await Promise.all([
    prisma.notification.count({
      where: { readAt: null, OR: [...(userId ? [{ userId }] : []), { role, userId: null }] },
    }),
    prisma.branch.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, branchId: true, role: true },
    }),
    branchScoped && branchId ? prisma.branch.findUnique({ where: { id: branchId } }) : null,
  ]);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar navItems={navItems} roleLabel={roleLabel(role)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
            {activeBranch && (
              <p className="text-xs text-slate-500">Branch: {activeBranch.name}</p>
            )}
          </div>
          <div className="no-print flex items-center gap-3">
            <Link href="/notifications" className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="Notifications">
              <Bell size={18} />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
            <RoleSwitcher
              currentRole={role}
              currentBranchId={branchId}
              currentUserId={userId}
              branches={branches}
              users={users}
            />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{needsMfa ? <MfaGate userName={me!.name} roleName={roleLabel(role)} back={ROLES.find((r) => r.id === role)?.homePath ?? "/"} /> : allowed ? children : <Forbidden role={role} area={title} />}</main>
      </div>
    </div>
  );
}
