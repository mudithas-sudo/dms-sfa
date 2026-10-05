import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import KpiCard from "@/components/KpiCard";
import { formatCurrency, daysAgo } from "@/lib/format";
import { TrendingUp, MapPin, Wallet, ClipboardList } from "lucide-react";

export default async function ScorecardDetailPage({ params }: { params: Promise<{ repId: string }> }) {
  const { repId } = await params;
  const rep = await prisma.user.findUnique({ where: { id: repId }, include: { branch: true, route: true } });
  if (!rep) notFound();

  const since = daysAgo(30);
  const [orders, visits, claims, fieldNotes, tasks] = await Promise.all([
    prisma.salesOrder.findMany({ where: { salespersonId: repId, orderDate: { gte: since } }, include: { outlet: true } }),
    prisma.fieldVisit.count({ where: { salespersonId: repId, checkinAt: { gte: since } } }),
    prisma.claim.count({ where: { submittedById: repId, submittedAt: { gte: since } } }),
    prisma.fieldNote.count({ where: { salespersonId: repId, createdAt: { gte: since } } }),
    prisma.task.findMany({ where: { assignedToId: repId }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  const validOrders = orders.filter((o) => o.status !== "voided");
  const salesValue = validOrders.reduce((s, o) => s + o.total, 0);
  const avgOrderValue = validOrders.length > 0 ? salesValue / validOrders.length : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/supervisor/scorecards" className="hover:underline">Scorecards</Link>
        <span>/</span>
        <span className="text-slate-900">{rep.name}</span>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-slate-900">{rep.name}</h2>
        <p className="text-sm text-slate-500">{rep.branch?.name} · {rep.route?.name ?? "No route assigned"}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Orders (30d)" value={String(validOrders.length)} icon={ClipboardList} />
        <KpiCard label="Sales Value" value={formatCurrency(salesValue)} sublabel={`Avg ${formatCurrency(avgOrderValue)}/order`} icon={TrendingUp} tone="good" />
        <KpiCard label="Field Visits" value={String(visits)} icon={MapPin} />
        <KpiCard label="Claims Submitted" value={String(claims)} icon={Wallet} />
      </div>

      <div className="card p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Field Execution Notes (30d)</h3>
        <p className="text-sm text-slate-600">{fieldNotes} shelf audits / merchandising / competitor observations logged.</p>
      </div>

      <div className="card p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Assigned Tasks</h3>
        <ul className="space-y-2">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm last:border-0">
              <span>{t.title}</span>
              <span className={t.status === "completed" ? "text-emerald-600" : "text-amber-600"}>{t.status}</span>
            </li>
          ))}
          {tasks.length === 0 && <p className="text-xs text-slate-400">No tasks assigned.</p>}
        </ul>
      </div>
    </div>
  );
}
