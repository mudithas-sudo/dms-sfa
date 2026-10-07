import AppShell from "@/components/AppShell";
import { getSession } from "@/lib/session";
import type { NavItem } from "@/components/Sidebar";

const navItems: NavItem[] = [
  { href: "/admin", label: "Overview", icon: "Building2" },
  { href: "/admin/branches", label: "Branches", icon: "Building2", section: "Master data" },
  { href: "/admin/outlets", label: "Outlets", icon: "Store" },
  { href: "/admin/outlets/onboarding", label: "Onboarding Queue", icon: "UserCheck" },
  { href: "/admin/products", label: "Products", icon: "Package" },
  { href: "/admin/channels", label: "Channels", icon: "Layers" },
  { href: "/admin/routes", label: "Routes & Beat Plans", icon: "Map" },
  { href: "/admin/territories", label: "Territories", icon: "Map" },
  { href: "/admin/personnel", label: "Sales Personnel", icon: "Users" },
  { href: "/admin/warehouses-vans", label: "Warehouses & Vans", icon: "Warehouse" },
  { href: "/admin/reference-data", label: "Financial Reference Data", icon: "Landmark" },
  { href: "/admin/data-import", label: "Data Import & Migration", icon: "Upload" },
  { href: "/admin/pricing", label: "Pricing Engine", icon: "Tags", section: "Commercial" },
  { href: "/admin/customer-discounts", label: "Customer Discounts", icon: "Percent" },
  { href: "/admin/promotions", label: "Promotions", icon: "Megaphone" },
  { href: "/admin/network", label: "Branch Network View", icon: "Building2", section: "Reporting" },
  { href: "/admin/dashboards", label: "Dashboards", icon: "BarChart3" },
  { href: "/admin/reports", label: "Report Catalog", icon: "FileBarChart" },
  { href: "/admin/scheduled-reports", label: "Scheduled Reports", icon: "CalendarClock" },
  { href: "/admin/users", label: "Users & Roles", icon: "UserCog", section: "Governance" },
  { href: "/admin/permissions", label: "Permissions (RBAC)", icon: "Lock" },
  { href: "/admin/approval-authority", label: "Approval Authority", icon: "ShieldCheck" },
  { href: "/admin/settings", label: "Platform Configuration", icon: "Settings" },
  { href: "/admin/security", label: "Identity & Audit Integrity", icon: "KeyRound" },
  { href: "/admin/audit-log", label: "Audit Log", icon: "ScrollText" },
  { href: "/admin/devices", label: "Devices & Sync", icon: "Smartphone" },
  { href: "/admin/integrations", label: "Integrations & Gateway", icon: "Cable" },
  { href: "/admin/merchandising", label: "Merchandising Interface", icon: "Share2" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { role, branchId, userId } = await getSession();
  return (
    <AppShell role={role} branchId={branchId} userId={userId} navItems={navItems} group="admin" title="Central Administration">
      {children}
    </AppShell>
  );
}
