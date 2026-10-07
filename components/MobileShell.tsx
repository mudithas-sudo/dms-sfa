import RoleSwitcher from "@/components/RoleSwitcher";
import MobileBottomNav from "@/components/MobileBottomNav";
import { prisma } from "@/lib/prisma";
import Forbidden from "@/components/Forbidden";
import { groupAllowed } from "@/lib/rbac";
import type { RoleId } from "@/lib/constants";

export default async function MobileShell({
  role,
  branchId,
  userId,
  title,
  children,
}: {
  role: RoleId;
  branchId: string | null;
  userId: string | null;
  title: string;
  children: React.ReactNode;
}) {
  const [branches, users, currentUser] = await Promise.all([
    prisma.branch.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, branchId: true, role: true },
    }),
    userId ? prisma.user.findUnique({ where: { id: userId }, include: { branch: true } }) : null,
  ]);

  return (
    <div className="flex min-h-screen justify-center bg-slate-200 py-6">
      <div className="flex h-[812px] w-full max-w-[390px] flex-col overflow-hidden rounded-[2rem] border-4 border-slate-900 bg-slate-50 shadow-2xl">
        <div className="shrink-0 border-b border-slate-200 bg-white px-4 pb-2 pt-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">{title}</p>
              <p className="text-xs text-slate-500">
                {currentUser?.name ?? "Sales Rep"} · {currentUser?.branch?.name ?? ""}
              </p>
            </div>
          </div>
          <div className="mt-2">
            <RoleSwitcher
              currentRole={role}
              currentBranchId={branchId}
              currentUserId={userId}
              branches={branches}
              users={users}
            />
          </div>
        </div>
        <main className="flex-1 overflow-y-auto bg-slate-50 px-4 py-4">
          {groupAllowed(role, "sfa") ? children : <Forbidden role={role} area="Field Sales (mobile)" />}
        </main>
        <MobileBottomNav />
      </div>
    </div>
  );
}
