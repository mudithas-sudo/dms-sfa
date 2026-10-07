import AppShell from "@/components/AppShell";
import { getSession } from "@/lib/session";
import type { NavItem } from "@/components/Sidebar";

const navItems: NavItem[] = [
  { href: "/management", label: "Cross-Branch Dashboard", icon: "BarChart3" },
];

export default async function ManagementLayout({ children }: { children: React.ReactNode }) {
  const { role, branchId, userId } = await getSession();
  return (
    <AppShell role={role} branchId={branchId} userId={userId} navItems={navItems} group="management" title="Management & Reporting">
      {children}
    </AppShell>
  );
}
