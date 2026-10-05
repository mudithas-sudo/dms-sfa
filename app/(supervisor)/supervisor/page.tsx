import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import KpiCard from "@/components/KpiCard";
import AiInsightsPanel from "@/components/AiInsightsPanel";
import { ShieldCheck, ReceiptText, Wallet, Users } from "lucide-react";

export default async function SupervisorOverview() {
  const { branchId } = await getSession();

  const [pendingApprovals, pendingClaims, overdueInvoices, repsCount] = await Promise.all([
    prisma.approvalRequest.count({ where: { status: "pending" } }),
    prisma.claim.count({ where: { status: { in: ["submitted", "reviewed"] } } }),
    prisma.invoice.aggregate({
      where: { status: "overdue", ...(branchId ? { branchId } : {}) },
      _sum: { amount: true },
      _count: true,
    }),
    branchId ? prisma.user.count({ where: { branchId, role: "sales_rep" } }) : Promise.resolve(0),
  ]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Pending Approvals" value={String(pendingApprovals)} icon={ShieldCheck} tone={pendingApprovals > 0 ? "warn" : "good"} />
        <KpiCard label="Pending Claims" value={String(pendingClaims)} icon={ReceiptText} tone={pendingClaims > 0 ? "warn" : "good"} />
        <KpiCard label="Overdue AR" value={`₱${(overdueInvoices._sum.amount ?? 0).toLocaleString()}`} sublabel={`${overdueInvoices._count} invoices`} icon={Wallet} tone="bad" />
        <KpiCard label="Sales Reps on Team" value={String(repsCount)} icon={Users} />
      </div>

      <div className="card p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Quick Links</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Link href="/supervisor/approvals" className="btn-secondary">Approvals</Link>
          <Link href="/supervisor/orders" className="btn-secondary">Orders (Void)</Link>
          <Link href="/supervisor/claims" className="btn-secondary">Claims Review</Link>
          <Link href="/supervisor/ar-aging" className="btn-secondary">AR Aging</Link>
          <Link href="/supervisor/payment-reconciliation" className="btn-secondary">Payment Reconciliation</Link>
          <Link href="/supervisor/team-dashboard" className="btn-secondary">Team Dashboard</Link>
          <Link href="/supervisor/coverage" className="btn-secondary">Coverage Monitoring</Link>
          <Link href="/supervisor/scorecards" className="btn-secondary">Rep Scorecards</Link>
        </div>
      </div>

      <AiInsightsPanel />
    </div>
  );
}
