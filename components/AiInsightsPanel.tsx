import { prisma } from "@/lib/prisma";
import { formatCurrency, daysAgo, startOfToday } from "@/lib/format";
import AiInsightsToggle from "@/components/AiInsightsToggle";

// Every "insight" below is a simple, explainable rule over real seeded data —
// not a real model. Labeled clearly as a preview, per the proposal's scoping.
// Sections are grouped to match the two AI capability lists named in the
// customer's own DMS and SFA requirements documents.
export default async function AiInsightsPanel() {
  const since14 = daysAgo(14);
  const since30 = daysAgo(30);
  const todayStart = startOfToday();
  const now = new Date();

  const [
    outlets,
    overdueInvoices,
    todayOrders,
    todayAmount,
    branches,
    pendingClaims,
    warehouseStock,
    soldLines30d,
    expiredLots,
    promotions,
    recentVisits,
  ] = await Promise.all([
    prisma.outlet.findMany({ where: { status: "active" }, include: { salesOrders: { orderBy: { orderDate: "desc" }, take: 1 } } }),
    prisma.invoice.findMany({ where: { status: "overdue" }, include: { outlet: true }, orderBy: { dueDate: "asc" } }),
    prisma.salesOrder.count({ where: { orderDate: { gte: todayStart }, status: { not: "voided" } } }),
    prisma.salesOrder.aggregate({ where: { orderDate: { gte: todayStart }, status: { not: "voided" } }, _sum: { total: true } }),
    prisma.branch.findMany(),
    prisma.claim.count({ where: { status: { in: ["submitted", "reviewed"] } } }),
    prisma.stockBalance.findMany({ where: { locationType: "warehouse" }, include: { product: true, warehouse: true } }),
    prisma.salesOrderLine.findMany({
      where: { salesOrder: { orderDate: { gte: since30 }, status: { not: "voided" } } },
      select: { productId: true, qty: true, salesOrder: { select: { branchId: true } } },
    }),
    prisma.stockBalance.findMany({ where: { locationType: "warehouse", expiryDate: { lt: now } }, include: { warehouse: true } }),
    prisma.promotion.findMany({ where: { productId: { not: null }, startDate: { lte: now } }, include: { product: true } }),
    prisma.fieldVisit.findMany({ where: { checkinAt: { gte: since14 }, checkoutAt: { not: null } }, include: { outlet: true, salesperson: true } }),
  ]);

  const staleOutlets = outlets
    .filter((o) => !o.salesOrders[0] || o.salesOrders[0].orderDate < since14)
    .slice(0, 5);

  const creditRiskOutlets = overdueInvoices.slice(0, 5);

  const route = await prisma.route.findFirst({
    include: { stops: { include: { outlet: true }, orderBy: { sequence: "asc" } } },
  });
  const optimizedStops = route ? [...route.stops].sort((a, b) => a.outlet.lat - b.outlet.lat) : [];

  const summary = `Today the team logged ${todayOrders} order(s) totaling ${formatCurrency(todayAmount._sum.total ?? 0)} across ${branches.length} branches. ${overdueInvoices.length} invoice(s) are overdue, and ${pendingClaims} claim(s) are awaiting review.`;

  // --- Purchase order / replenishment recommendations (branch x product) ---
  const soldByBranchProduct = new Map<string, number>();
  for (const line of soldLines30d) {
    const key = `${line.salesOrder.branchId}:${line.productId}`;
    soldByBranchProduct.set(key, (soldByBranchProduct.get(key) ?? 0) + line.qty);
  }
  const stockByBranchProduct = new Map<string, { qty: number; productName: string; branchName: string }>();
  for (const row of warehouseStock) {
    if (!row.warehouse) continue;
    const key = `${row.warehouse.branchId}:${row.productId}`;
    const cur = stockByBranchProduct.get(key);
    const branchName = branches.find((b) => b.id === row.warehouse!.branchId)?.name ?? "";
    if (cur) cur.qty += row.qtyGood;
    else stockByBranchProduct.set(key, { qty: row.qtyGood, productName: row.product.name, branchName });
  }
  const reorderCandidates = Array.from(stockByBranchProduct.entries())
    .map(([key, v]) => {
      const soldQty = soldByBranchProduct.get(key) ?? 0;
      const avgDaily = soldQty / 30;
      const daysOfStock = avgDaily > 0 ? v.qty / avgDaily : Infinity;
      const suggestedQty = Math.max(0, Math.round(avgDaily * 14 - v.qty));
      return { ...v, avgDaily, daysOfStock, suggestedQty };
    })
    .filter((c) => c.avgDaily > 0 && c.daysOfStock < 7)
    .sort((a, b) => a.daysOfStock - b.daysOfStock)
    .slice(0, 5);

  // --- Distributor/branch risk score ---
  const overdueByBranch = new Map<string, number>();
  for (const inv of overdueInvoices) overdueByBranch.set(inv.branchId, (overdueByBranch.get(inv.branchId) ?? 0) + 1);
  const expiredByBranch = new Map<string, number>();
  for (const row of expiredLots) {
    if (!row.warehouse) continue;
    expiredByBranch.set(row.warehouse.branchId, (expiredByBranch.get(row.warehouse.branchId) ?? 0) + 1);
  }
  const branchRisk = branches
    .map((b) => {
      const overdueCount = overdueByBranch.get(b.id) ?? 0;
      const expiredCount = expiredByBranch.get(b.id) ?? 0;
      const score = overdueCount * 2 + expiredCount;
      const level = score >= 7 ? "High" : score >= 3 ? "Medium" : "Low";
      return { name: b.name, overdueCount, expiredCount, score, level };
    })
    .sort((a, b) => b.score - a.score);

  // --- Promotion effectiveness (simple before/during sales-velocity uplift) ---
  const promoEffectiveness = await Promise.all(
    promotions.slice(0, 5).map(async (promo) => {
      if (!promo.productId) return null;
      const periodEnd = promo.endDate < now ? promo.endDate : now;
      const daysDuring = Math.max(1, Math.round((periodEnd.getTime() - promo.startDate.getTime()) / 86400000));
      const beforeWindowStart = new Date(promo.startDate.getTime() - 14 * 86400000);

      const [duringLines, beforeLines] = await Promise.all([
        prisma.salesOrderLine.aggregate({
          where: { productId: promo.productId, salesOrder: { orderDate: { gte: promo.startDate, lte: periodEnd }, status: { not: "voided" } } },
          _sum: { qty: true },
        }),
        prisma.salesOrderLine.aggregate({
          where: { productId: promo.productId, salesOrder: { orderDate: { gte: beforeWindowStart, lt: promo.startDate }, status: { not: "voided" } } },
          _sum: { qty: true },
        }),
      ]);

      const avgDuring = (duringLines._sum.qty ?? 0) / daysDuring;
      const avgBefore = (beforeLines._sum.qty ?? 0) / 14;
      const upliftPct = avgBefore > 0 ? Math.round(((avgDuring - avgBefore) / avgBefore) * 100) : avgDuring > 0 ? 100 : 0;

      return { name: promo.name, product: promo.product?.name ?? "", upliftPct, hasData: avgBefore > 0 || avgDuring > 0 };
    }),
  );
  const promoResults = promoEffectiveness.filter((p): p is NonNullable<typeof p> => p !== null && p.hasData);

  // --- Visit-quality anomalies (suspiciously short visits) ---
  const shortVisits = recentVisits
    .filter((v) => v.checkoutAt && v.checkoutAt.getTime() - v.checkinAt.getTime() < 3 * 60000)
    .slice(0, 5);

  // --- Performance coaching (reps trailing their branch's average) ---
  const reps = await prisma.user.findMany({ where: { role: "sales_rep" } });
  const repOrderCounts = await Promise.all(
    reps.map(async (rep) => ({
      rep,
      orderCount: await prisma.salesOrder.count({ where: { salespersonId: rep.id, orderDate: { gte: since14 }, status: { not: "voided" } } }),
    })),
  );
  const branchAverages = new Map<string, number>();
  for (const b of branches) {
    const branchReps = repOrderCounts.filter((r) => r.rep.branchId === b.id);
    if (branchReps.length === 0) continue;
    branchAverages.set(b.id, branchReps.reduce((s, r) => s + r.orderCount, 0) / branchReps.length);
  }
  const coachingTips = repOrderCounts
    .filter((r) => {
      const avg = r.rep.branchId ? branchAverages.get(r.rep.branchId) : undefined;
      return avg !== undefined && avg > 0 && r.orderCount < avg * 0.7;
    })
    .slice(0, 5);

  return (
    <AiInsightsToggle>
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-700">Automated Daily Summary</h3>
        <p className="rounded-lg bg-white p-3 text-sm text-slate-700">{summary}</p>
      </div>

      <div className="border-t border-violet-200 pt-4">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-violet-500">Field &amp; Sales (SFA)</p>

        <div className="space-y-4">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-700">Next-Best-Action (Outlets Without a Recent Order)</h3>
            <ul className="space-y-1.5">
              {staleOutlets.map((o) => (
                <li key={o.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm">
                  <span className="text-slate-700">{o.name}</span>
                  <span className="text-xs text-amber-600">
                    {o.salesOrders[0] ? "Hasn't ordered in 14+ days" : "No order history"}
                  </span>
                </li>
              ))}
              {staleOutlets.length === 0 && <p className="text-xs text-slate-400">No stale outlets flagged.</p>}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-700">Credit Risk Flags (Overdue Balance)</h3>
            <ul className="space-y-1.5">
              {creditRiskOutlets.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm">
                  <span className="text-slate-700">{inv.outlet.name}</span>
                  <span className="text-xs text-rose-600">{formatCurrency(inv.amount)} overdue</span>
                </li>
              ))}
              {creditRiskOutlets.length === 0 && <p className="text-xs text-slate-400">No credit risk outlets flagged.</p>}
            </ul>
          </div>

          {route && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-700">
                Route Optimization Suggestion — {route.name}
              </h3>
              <div className="rounded-lg bg-white p-3">
                <p className="mb-2 text-xs text-slate-500">AI-suggested order (illustrative re-sequencing, not validated):</p>
                <ol className="space-y-1 text-sm text-slate-700">
                  {optimizedStops.map((s, i) => (
                    <li key={s.id}>{i + 1}. {s.outlet.name}</li>
                  ))}
                </ol>
              </div>
            </div>
          )}

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-700">Visit-Quality Anomalies</h3>
            <ul className="space-y-1.5">
              {shortVisits.map((v) => (
                <li key={v.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm">
                  <span className="text-slate-700">{v.salesperson.name} — {v.outlet.name}</span>
                  <span className="text-xs text-rose-600">
                    Suspiciously short visit ({Math.round((v.checkoutAt!.getTime() - v.checkinAt.getTime()) / 60000)} min)
                  </span>
                </li>
              ))}
              {shortVisits.length === 0 && <p className="text-xs text-slate-400">No visit-quality anomalies flagged.</p>}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-700">Performance Coaching</h3>
            <ul className="space-y-1.5">
              {coachingTips.map(({ rep, orderCount }) => (
                <li key={rep.id} className="rounded-lg bg-white px-3 py-2 text-sm text-slate-700">
                  {rep.name}&apos;s order count ({orderCount} in 14d) is trailing their branch average — consider a coaching check-in on route coverage.
                </li>
              ))}
              {coachingTips.length === 0 && <p className="text-xs text-slate-400">No reps trailing their branch average.</p>}
            </ul>
          </div>
        </div>
      </div>

      <div className="border-t border-violet-200 pt-4">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-violet-500">Distributor &amp; Merchandising (DMS)</p>

        <div className="space-y-4">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-700">Purchase Order Recommendations</h3>
            <ul className="space-y-1.5">
              {reorderCandidates.map((c, i) => (
                <li key={i} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm">
                  <span className="text-slate-700">{c.productName} — {c.branchName}</span>
                  <span className="text-xs text-amber-600">
                    {Math.max(0, Math.floor(c.daysOfStock))}d of stock left · suggest ordering {c.suggestedQty}
                  </span>
                </li>
              ))}
              {reorderCandidates.length === 0 && <p className="text-xs text-slate-400">No low-stock reorder candidates flagged.</p>}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-700">Distributor Risk Score</h3>
            <ul className="space-y-1.5">
              {branchRisk.map((b) => (
                <li key={b.name} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm">
                  <span className="text-slate-700">{b.name}</span>
                  <span className={`text-xs ${b.level === "High" ? "text-rose-600" : b.level === "Medium" ? "text-amber-600" : "text-emerald-600"}`}>
                    {b.level} ({b.overdueCount} overdue inv. · {b.expiredCount} expired lots)
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-700">Promotion Effectiveness</h3>
            <ul className="space-y-1.5">
              {promoResults.map((p, i) => (
                <li key={i} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm">
                  <span className="text-slate-700">{p.name} ({p.product})</span>
                  <span className={`text-xs ${p.upliftPct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {p.upliftPct >= 0 ? "+" : ""}{p.upliftPct}% sales velocity vs. pre-promo
                  </span>
                </li>
              ))}
              {promoResults.length === 0 && <p className="text-xs text-slate-400">Not enough data to estimate promotion effectiveness.</p>}
            </ul>
          </div>
        </div>
      </div>
    </AiInsightsToggle>
  );
}
