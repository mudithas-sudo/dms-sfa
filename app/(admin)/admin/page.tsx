import { prisma } from "@/lib/prisma";
import KpiCard from "@/components/KpiCard";
import HeadOfficeOverview from "@/components/HeadOfficeOverview";
import { formatDateTime } from "@/lib/format";
import { Building2, Store, Package, Megaphone } from "lucide-react";
import Link from "next/link";

export default async function AdminOverview() {
  const [branchCount, outletCount, productCount, activePromoCount, recentLogs] = await Promise.all([
    prisma.branch.count(),
    prisma.outlet.count({ where: { status: "active" } }),
    prisma.product.count({ where: { status: "active" } }),
    prisma.promotion.count({ where: { status: "active" } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 8, include: { user: true } }),
  ]);

  return (
    <div className="space-y-6">
      <HeadOfficeOverview />
      <h2 className="pt-2 text-sm font-semibold text-slate-900">Master data &amp; platform</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Branches" value={String(branchCount)} icon={Building2} />
        <KpiCard label="Active Outlets" value={String(outletCount)} icon={Store} />
        <KpiCard label="Active Products" value={String(productCount)} icon={Package} />
        <KpiCard label="Active Promotions" value={String(activePromoCount)} icon={Megaphone} tone="good" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2 p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Quick Links</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Link href="/admin/branches" className="btn-secondary">Manage Branches</Link>
            <Link href="/admin/outlets" className="btn-secondary">Manage Outlets</Link>
            <Link href="/admin/products" className="btn-secondary">Manage Products</Link>
            <Link href="/admin/pricing" className="btn-secondary">Pricing Rules</Link>
            <Link href="/admin/promotions" className="btn-secondary">Promotions</Link>
            <Link href="/admin/audit-log" className="btn-secondary">Audit Log</Link>
          </div>
        </div>

        <div className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Recent Activity</h2>
          <ul className="space-y-3">
            {recentLogs.map((log) => (
              <li key={log.id} className="text-xs">
                <p className="font-medium text-slate-700">{log.summary}</p>
                <p className="text-slate-400">
                  {log.user.name} · {formatDateTime(log.createdAt)}
                </p>
              </li>
            ))}
            {recentLogs.length === 0 && <p className="text-xs text-slate-400">No activity yet.</p>}
          </ul>
        </div>
      </div>
    </div>
  );
}
