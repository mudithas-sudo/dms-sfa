import Sidebar, { type NavItem } from "@/components/Sidebar";
import RoleSwitcher from "@/components/RoleSwitcher";
import { prisma } from "@/lib/prisma";
import { roleLabel, type RoleId } from "@/lib/constants";

export default async function AppShell({
  role,
  branchId,
  userId,
  navItems,
  title,
  children,
}: {
  role: RoleId;
  branchId: string | null;
  userId: string | null;
  navItems: NavItem[];
  title: string;
  children: React.ReactNode;
}) {
  const branchScoped = role !== "admin" && role !== "management";

  const [branches, users, activeBranch] = await Promise.all([
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
          <div className="no-print">
            <RoleSwitcher
              currentRole={role}
              currentBranchId={branchId}
              currentUserId={userId}
              branches={branches}
              users={users}
            />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
