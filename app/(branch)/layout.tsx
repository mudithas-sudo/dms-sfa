import AppShell from "@/components/AppShell";
import { getSession } from "@/lib/session";
import type { NavItem } from "@/components/Sidebar";

const navItems: NavItem[] = [
  { href: "/branch", label: "Overview", icon: "LayoutDashboard" },
  { href: "/branch/purchase-orders", label: "Purchase Orders", icon: "ClipboardList" },
  { href: "/branch/warehouse-stock", label: "Warehouse Stock", icon: "Warehouse" },
  { href: "/branch/opening-balance", label: "Opening Balance", icon: "Inbox" },
  { href: "/branch/stock-count", label: "Stock Count", icon: "ListChecks" },
  { href: "/branch/stock-transfers", label: "Stock Transfers", icon: "ArrowLeftRight" },
  { href: "/branch/stock-adjustments", label: "Stock Adjustments", icon: "SlidersHorizontal" },
  { href: "/branch/near-expiry", label: "Near-Expiry Alerts", icon: "AlertTriangle" },
  { href: "/branch/picklists", label: "Picklists", icon: "ClipboardCheck" },
  { href: "/branch/deliveries", label: "Deliveries", icon: "PackageCheck" },
  { href: "/branch/van-loading", label: "Van Loading", icon: "Truck" },
  { href: "/branch/van-stock", label: "Van Stock Balances", icon: "Boxes" },
  { href: "/branch/van-returns", label: "Van Returns", icon: "Undo2" },
  { href: "/branch/supplier-returns", label: "Returns to Central Warehouse", icon: "Undo2" },
  { href: "/branch/replenishment-requests", label: "Van Stock Requests", icon: "Inbox" },
  { href: "/branch/eod-reconciliation", label: "End-of-Day Reconciliation", icon: "CalendarCheck" },
];

export default async function BranchLayout({ children }: { children: React.ReactNode }) {
  const { role, branchId, userId } = await getSession();
  return (
    <AppShell role={role} branchId={branchId} userId={userId} navItems={navItems} group="branch" title="Branch / Warehouse Operations">
      {children}
    </AppShell>
  );
}
