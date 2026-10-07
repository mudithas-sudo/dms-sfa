import Link from "next/link";
import RoleSwitcher from "@/components/RoleSwitcher";
import MobileBottomNav from "@/components/MobileBottomNav";
import ScrollToTop from "@/components/ScrollToTop";
import { prisma } from "@/lib/prisma";
import Forbidden from "@/components/Forbidden";
import { groupAllowed } from "@/lib/rbac";
import type { RoleId } from "@/lib/constants";

// The field app. On a phone it fills the screen; on a larger screen it is shown inside a phone-sized frame for the demo.
// Layout: a slim header, one scrolling content area, a bottom navigation bar — and nothing else fixed on top of the content.
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
    <div className="mobile-app sm:flex sm:min-h-screen sm:justify-center sm:bg-slate-200 sm:py-6">
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-slate-50 sm:h-[812px] sm:max-w-[390px] sm:rounded-[2rem] sm:border-4 sm:border-slate-900 sm:shadow-2xl">
        <header className="shrink-0 border-b border-slate-200 bg-white px-4 pb-2 pt-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-slate-900">{title}</p>
              <p className="truncate text-xs text-slate-500">
                {currentUser?.name ?? "Sales Rep"}{currentUser?.branch?.name ? ` · ${currentUser.branch.name}` : ""}
              </p>
            </div>
            <Link href="/notifications" aria-label="Notifications" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 active:bg-slate-100">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
            </Link>
          </div>
          <details className="mt-1 text-xs">
            <summary className="flex min-h-[36px] cursor-pointer items-center text-slate-400">Demo: switch role or user</summary>
            <div className="pb-1">
              <RoleSwitcher currentRole={role} currentBranchId={branchId} currentUserId={userId} branches={branches} users={users} />
            </div>
          </details>
        </header>
        <main id="app-scroll" className="flex-1 overflow-y-auto overscroll-contain bg-slate-50 px-4 py-4">
          <ScrollToTop />
          {groupAllowed(role, "sfa") ? children : <Forbidden role={role} area="Field Sales (mobile)" />}
        </main>
        <MobileBottomNav role={role} />
      </div>
    </div>
  );
}
