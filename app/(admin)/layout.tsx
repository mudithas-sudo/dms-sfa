import AppShell from "@/components/AppShell";
import { getSession } from "@/lib/session";
import type { NavItem } from "@/components/Sidebar";

const navItems: NavItem[] = [
  { href: "/admin", label: "Overview", icon: "Building2" },
  { href: "/admin/branches", label: "Branches", icon: "Building2" },
  { href: "/admin/outlets", label: "Outlets", icon: "Store" },
  { href: "/admin/outlets/onboarding", label: "Onboarding Queue", icon: "UserCheck" },
  { href: "/admin/products", label: "Products", icon: "Package" },
  { href: "/admin/channels", label: "Channels", icon: "Layers" },
  { href: "/admin/routes", label: "Routes & Beat Plans", icon: "Map" },
  { href: "/admin/territories", label: "Territories", icon: "Map" },
  { href: "/admin/personnel", label: "Sales Personnel", icon: "Users" },
  { href: "/admin/warehouses-vans", label: "Warehouses & Vans", icon: "Warehouse" },
  { href: "/admin/pricing", label: "Pricing Rules", icon: "Tags" },
  { href: "/admin/customer-discounts", label: "Customer Discounts", icon: "Percent" },
  { href: "/admin/promotions", label: "Promotions", icon: "Megaphone" },
  { href: "/admin/scheduled-reports", label: "Scheduled Reports", icon: "CalendarClock" },
  { href: "/admin/permissions", label: "Permissions (RBAC)", icon: "Lock" },
  { href: "/admin/audit-log", label: "Audit Log", icon: "ScrollText" },
  { href: "/admin/integrations", label: "Integrations & Platform", icon: "Cable" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { role, branchId, userId } = await getSession();
  return (
    <AppShell role={role} branchId={branchId} userId={userId} navItems={navItems} title="Central Administration">
      {children}
    </AppShell>
  );
}
