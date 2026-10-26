import Sidebar, { type NavItem } from "@/components/Sidebar";
import RoleSwitcher from "@/components/RoleSwitcher";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Bell } from "lucide-react";
import { unstable_cache } from "next/cache";
import Forbidden from "@/components/Forbidden";
import MfaGate from "@/components/MfaGate";
import { getSetting } from "@/lib/settings";
import { groupAllowed, GROUP_ACCESS } from "@/lib/rbac";
import { roleLabel, ROLES, type RoleId } from "@/lib/constants";

// The role switcher's lists change only when someone edits branches or users, so they are kept for a minute instead of read on every page.
const switcherLists = unstable_cache(
  async () => {
    const [branches, users] = await Promise.all([
      prisma.branch.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, branchId: true, role: true } }),
    ]);
    return { branches, users };
  },
  ["app-shell-switcher-lists"],
  { revalidate: 60 },
);

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

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar navItems={navItems} roleLabel={roleLabel(role)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-20 flex-wrap items-center justify-between gap-3 px-8 pt-5">
          <div>
            <h1 className="text-2xl font-bold leading-tight text-slate-900">{title}</h1>
            {activeBranch && (
              <p className="mt-0.5 text-sm text-slate-500">Branch: {activeBranch.name}</p>
            )}
          </div>
          <div className="no-print ml-auto flex items-center gap-3">
            <Link href="/notifications" className="btn-round relative h-10 w-10" title="Notifications" aria-label="Notifications">
              <Bell size={18} />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-semibold text-white">
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
        <main className="flex-1 overflow-y-auto px-8 pb-10 pt-5">{needsMfa ? <MfaGate userName={me!.name} roleName={roleLabel(role)} back={ROLES.find((r) => r.id === role)?.homePath ?? "/"} /> : allowed ? children : <Forbidden role={role} area={title} />}</main>
      </div>
    </div>
  );
}
