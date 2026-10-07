import AppShell from "@/components/AppShell";
import { getSession } from "@/lib/session";
import type { NavItem } from "@/components/Sidebar";

const navItems: NavItem[] = [
  { href: "/supervisor", label: "Overview", icon: "LayoutDashboard" },
  { href: "/supervisor/approvals", label: "Approvals", icon: "ShieldCheck" },
  { href: "/supervisor/onboarding", label: "Customer Onboarding", icon: "UserCheck" },
  { href: "/supervisor/orders", label: "Orders (Void Requests)", icon: "AlertOctagon" },
  { href: "/supervisor/claims", label: "Claims Review", icon: "ReceiptText" },
  { href: "/supervisor/ar-aging", label: "AR Aging", icon: "Wallet" },
  { href: "/supervisor/payment-reconciliation", label: "Payment Reconciliation", icon: "ArrowLeftRight" },
  { href: "/supervisor/credit", label: "Credit Control", icon: "ShieldCheck" },
  { href: "/supervisor/finance-documents", label: "Debit / Credit / Write-off", icon: "ReceiptText" },
  { href: "/supervisor/market-returns", label: "Market Returns", icon: "Undo2" },
  { href: "/supervisor/team-dashboard", label: "Team Dashboard", icon: "Users" },
  { href: "/supervisor/tasks", label: "Task Assignment", icon: "ListChecks" },
  { href: "/supervisor/requests", label: "Leave & Expenses", icon: "CalendarCheck" },
  { href: "/supervisor/change-requests", label: "Customer Change Requests", icon: "UserCheck" },
  { href: "/supervisor/targets", label: "Targets", icon: "BarChart3" },
  { href: "/supervisor/coverage", label: "Coverage Monitoring", icon: "MapPinned" },
  { href: "/supervisor/scorecards", label: "Rep Scorecards", icon: "BarChart3" },
  { href: "/supervisor/dashboards", label: "Dashboards", icon: "BarChart3" },
  { href: "/supervisor/reports", label: "Reports", icon: "FileBarChart" },
];

export default async function SupervisorLayout({ children }: { children: React.ReactNode }) {
  const { role, branchId, userId } = await getSession();
  return (
    <AppShell role={role} branchId={branchId} userId={userId} navItems={navItems} group="supervisor" title="Sales & Finance Supervisor">
      {children}
    </AppShell>
  );
}
