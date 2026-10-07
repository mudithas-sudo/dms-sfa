import AppShell from "@/components/AppShell";
import { getSession } from "@/lib/session";
import type { NavItem } from "@/components/Sidebar";

const navItems: NavItem[] = [
  { href: "/management", label: "Cross-Branch Dashboard", icon: "BarChart3" },
  { href: "/management/network", label: "Branch Network View", icon: "Building2" },
  { href: "/management/dashboards", label: "Dashboards", icon: "LayoutDashboard" },
  { href: "/management/reports", label: "Report Catalog", icon: "FileBarChart" },
];

export default async function ManagementLayout({ children }: { children: React.ReactNode }) {
  const { role, branchId, userId } = await getSession();
  return (
    <AppShell role={role} branchId={branchId} userId={userId} navItems={navItems} group="management" title="Management & Reporting">
      {children}
    </AppShell>
  );
}
