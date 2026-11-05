import Link from "next/link";
import MobileBottomNav from "@/components/MobileBottomNav";
import ScrollToTop from "@/components/ScrollToTop";
import { prisma } from "@/lib/prisma";
import { signOut } from "@/app/actions/auth-actions";
import Forbidden from "@/components/Forbidden";
import { groupAllowed } from "@/lib/rbac";
import type { RoleId } from "@/lib/constants";

// The field app. On a phone it fills the screen; on a larger screen it is shown inside a phone-sized frame for the demo.
// Layout: a slim header, one scrolling content area, a floating bottom navigation pill — and nothing else fixed on top of the content.
export default async function MobileShell({
  role,
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
  const currentUser = userId ? await prisma.user.findUnique({ where: { id: userId }, include: { branch: true } }) : null;
  const initials = (currentUser?.name ?? "Sales Rep").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="mobile-app sm:flex sm:min-h-screen sm:justify-center sm:bg-slate-200 sm:py-6">
      <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-slate-50 sm:h-[812px] sm:max-w-[390px] sm:rounded-[2.5rem] sm:border-[6px] sm:border-slate-900 sm:shadow-lg">
        <header className="shrink-0 px-4 pb-1 pt-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="avatar h-10 w-10 bg-blue-600 text-white">{initials}</span>
              <div className="min-w-0">
                <p className="font-display truncate text-base font-bold leading-tight text-slate-900">{title}</p>
                <p className="truncate text-xs text-slate-500">
                  {currentUser?.name ?? "Sales Rep"}{currentUser?.branch?.name ? ` · ${currentUser.branch.name}` : ""}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
            <Link href="/notifications" aria-label="Notifications" className="btn-round h-10 w-10">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
            </Link>
            <form action={signOut}>
              <button type="submit" aria-label="Sign out" title="Sign out" className="btn-round h-10 w-10">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></svg>
              </button>
            </form>
            </div>
          </div>
        </header>
        <main id="app-scroll" className="flex-1 overflow-y-auto overscroll-contain bg-slate-50 px-4 pb-6 pt-3">
          <ScrollToTop />
          {groupAllowed(role, "sfa") ? children : <Forbidden role={role} area="Field Sales (mobile)" />}
        </main>
        <MobileBottomNav />
      </div>
    </div>
  );
}
