import { prisma } from "@/lib/prisma";
import { invoiceBalance } from "@/lib/finance";
import type { Filters, Scope } from "@/lib/reports";
import type { ModuleId } from "@/lib/rbac";

// Dashboard definitions: every tile has a title, a calculation and a drill-down into the report or screen behind
// the figure. Filters (branch, date range, channel, route, representative) are shared by all dashboards.

export interface Tile {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "warn" | "bad";
  href?: string; // drill-down target
}
export interface DashboardDef {
  id: string;
  title: string;
  blurb: string;
  module: ModuleId;
  filters: ("branch" | "date" | "channel" | "route" | "rep")[];
  tiles: (f: Filters, s: Scope) => Promise<Tile[]>;
}

const peso = (n: number) => `₱${Math.round(n).toLocaleString("en-PH")}`;
const num = (n: number) => n.toLocaleString("en-PH");
const iso = (d: Date) => d.toISOString().slice(0, 10);
const SALE = ["confirmed", "picked", "invoiced", "delivered", "partially_delivered"];

function branchIds(f: Filters, s: Scope): string[] | null {
  const chosen = (f.branch ?? "").split(",").filter(Boolean);
  if (s.branchIds === null) return chosen.length ? chosen : null;
  return chosen.length ? chosen.filter((c) => s.branchIds!.includes(c)) : s.branchIds;
}
const B = (ids: string[] | null) => (ids ? { branchId: { in: ids } } : {});
function period(f: Filters, days = 30) {
  const to = f.dateTo ? new Date(f.dateTo) : new Date();
  to.setHours(23, 59, 59, 999);
  const from = f.dateFrom ? new Date(f.dateFrom) : new Date(to.getTime() - days * 86400000);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}
const q = (f: Filters, extra: Record<string, string> = {}) => {
  const p = new URLSearchParams({ run: "1", ...extra });
  for (const k of ["branch", "dateFrom", "dateTo", "channel", "route", "rep"]) if (f[k]) p.set(k, f[k]);
  return p.toString();
};

export const DASHBOARDS: DashboardDef[] = [
  {
    id: "customer",
    title: "Customer",
    blurb: "Active, new and inactive outlets, onboarding approvals and channel mix.",
    module: "master_data",
    filters: ["branch", "date", "channel", "route"],
    async tiles(f, s) {
      const ids = branchIds(f, s);
      const { from, to } = period(f, 90);
      const scope = { ...B(ids), ...(f.channel ? { channelId: f.channel } : {}), ...(f.route ? { routeId: f.route } : {}) };
      const [active, created, inactive, pending, byChannel, buyers] = await Promise.all([
        prisma.outlet.count({ where: { ...scope, status: "active" } }),
        prisma.outlet.count({ where: { ...scope, createdAt: { gte: from, lte: to } } }),
        prisma.outlet.count({ where: { ...scope, status: { in: ["inactive", "blocked"] } } }),
        prisma.outlet.count({ where: { ...scope, onboardingStatus: { in: ["pending", "returned"] } } }),
        prisma.outlet.groupBy({ by: ["channelId"], where: { ...scope, status: "active" }, _count: true }),
        prisma.salesOrder.findMany({ where: { orderDate: { gte: from, lte: to }, status: { in: SALE }, ...B(ids) }, select: { outletId: true }, distinct: ["outletId"] }),
      ]);
      const channels = await prisma.channel.findMany({ select: { id: true, name: true } });
      const bought = new Set(buyers.map((b) => b.outletId));
      const allActive = await prisma.outlet.findMany({ where: { ...scope, status: "active" }, select: { id: true } });
      const idle = allActive.filter((o) => !bought.has(o.id)).length;
      return [
        { label: "Active outlets", value: num(active), href: `/reports/customer-master?${q(f, { status: "active" })}` },
        { label: "New outlets (period)", value: num(created), href: `/reports/new-inactive-customers?${q(f, { status: "new" })}` },
        { label: "Inactive / blocked", value: num(inactive), tone: inactive ? "warn" : undefined, href: `/reports/customer-master?${q(f, { status: "inactive" })}` },
        { label: "Onboarding approvals pending", value: num(pending), tone: pending ? "warn" : undefined, href: "/supervisor/onboarding" },
        { label: "Active outlets without a purchase", value: num(idle), sub: `${iso(from)} to ${iso(to)}`, tone: idle ? "warn" : undefined, href: `/reports/customer-master?${q(f, { status: "active" })}` },
        ...byChannel.map((c) => ({ label: `Outlets — ${channels.find((x) => x.id === c.channelId)?.name ?? "Channel"}`, value: num(c._count), href: `/reports/customer-master?${q(f, { channel: c.channelId })}` })),
      ];
    },
  },
  {
    id: "route",
    title: "Route",
    blurb: "Planned versus visited outlets, coverage and unassigned routes.",
    module: "reports",
    filters: ["branch", "date", "route", "rep"],
    async tiles(f, s) {
      const ids = branchIds(f, s);
      const { from, to } = period(f, 14);
      const visits = await prisma.fieldVisit.findMany({ where: { checkinAt: { gte: from, lte: to }, outlet: { ...B(ids), ...(f.route ? { routeId: f.route } : {}) }, ...(f.rep ? { salespersonId: f.rep } : {}) }, select: { outletId: true, status: true, visitType: true, outcome: true } });
      const routes = await prisma.route.findMany({ where: { status: "active", ...(f.route ? { id: f.route } : {}) }, include: { reps: true, _count: { select: { outlets: true } } } });
      const outletsOnRoutes = await prisma.outlet.count({ where: { ...B(ids), status: "active", routeId: { not: null }, ...(f.route ? { routeId: f.route } : {}) } });
      const visited = new Set(visits.filter((v) => v.status !== "skipped").map((v) => v.outletId));
      const planned = visits.filter((v) => v.visitType === "planned").length;
      const completed = visits.filter((v) => v.status === "completed").length;
      const unassigned = routes.filter((r) => r.reps.length === 0);
      return [
        { label: "Planned visits", value: num(planned), href: `/reports/route-coverage?${q(f)}` },
        { label: "Completed visits", value: num(completed), sub: planned ? `${Math.round((completed / planned) * 100)}% of planned` : undefined, href: `/reports/route-coverage?${q(f)}` },
        { label: "Route coverage", value: outletsOnRoutes ? `${Math.round((visited.size / outletsOnRoutes) * 100)}%` : "—", sub: `${visited.size} of ${outletsOnRoutes} outlets visited`, tone: outletsOnRoutes && visited.size / outletsOnRoutes < 0.6 ? "warn" : "good", href: `/reports/route-coverage?${q(f)}` },
        { label: "Productive visits", value: num(visits.filter((v) => v.outcome === "order_taken").length), href: `/reports/field-activity?${q(f)}` },
        { label: "Active routes", value: num(routes.length), sub: routes.length ? `${(routes.reduce((a, r) => a + r._count.outlets, 0) / routes.length).toFixed(1)} outlets per route` : undefined, href: "/admin/routes" },
        { label: "Routes without a representative", value: num(unassigned.length), tone: unassigned.length ? "bad" : "good", sub: unassigned.slice(0, 3).map((r) => r.name).join(", "), href: "/admin/routes" },
      ];
    },
  },
  {
    id: "sales",
    title: "Sales",
    blurb: "Sales value and volume against target, discounts, voids and cancellations.",
    module: "sales",
    filters: ["branch", "date", "channel", "route", "rep"],
    async tiles(f, s) {
      const ids = branchIds(f, s);
      const { from, to } = period(f, 30);
      const orderWhere = { orderDate: { gte: from, lte: to }, ...B(ids), ...(f.rep ? { salespersonId: f.rep } : {}), outlet: { ...(f.channel ? { channelId: f.channel } : {}), ...(f.route ? { routeId: f.route } : {}) } };
      const [orders, lines, voided, cancelled, invoices] = await Promise.all([
        prisma.salesOrder.aggregate({ where: { ...orderWhere, status: { in: SALE } }, _sum: { total: true, discountTotal: true }, _count: true }),
        prisma.salesOrderLine.groupBy({ by: ["productId"], where: { salesOrder: { ...orderWhere, status: { in: SALE } } }, _sum: { qty: true, lineTotal: true } }),
        prisma.salesOrder.count({ where: { ...orderWhere, status: "voided" } }),
        prisma.salesOrder.count({ where: { ...orderWhere, status: "cancelled" } }),
        prisma.invoice.count({ where: { invoiceDate: { gte: from, lte: to }, ...B(ids) } }),
      ]);
      const month = iso(to).slice(0, 7);
      const repIds = ids ? (await prisma.user.findMany({ where: { role: "sales_rep", branchId: { in: ids } }, select: { id: true } })).map((u) => u.id) : null;
      const targets = await prisma.target.aggregate({ where: { metric: "sales_value", period: month, ...(f.rep ? { userId: f.rep } : repIds ? { userId: { in: repIds } } : {}) }, _sum: { targetValue: true } });
      const top = [...lines].sort((a, b) => (b._sum.lineTotal ?? 0) - (a._sum.lineTotal ?? 0))[0];
      const topName = top ? (await prisma.product.findUnique({ where: { id: top.productId } }))?.name : undefined;
      const sales = orders._sum.total ?? 0;
      const target = targets._sum?.targetValue ?? 0;
      return [
        { label: "Sales value", value: peso(sales), sub: `${num(orders._count)} orders`, tone: "good", href: `/reports/sales-by-dimension?${q(f)}` },
        { label: "Sales volume (units)", value: num(lines.reduce((a, l) => a + (l._sum.qty ?? 0), 0)), href: `/reports/sales-by-dimension?${q(f, { groupBy: "category" })}` },
        { label: `Against target (${month})`, value: target ? `${Math.round((sales / target) * 100)}%` : "No target", sub: target ? `${peso(sales)} of ${peso(target)}` : undefined, tone: target && sales < target ? "warn" : "good", href: `/reports/sales-vs-target?${q(f, { month })}` },
        { label: "Promotion discount given", value: peso(orders._sum.discountTotal ?? 0), href: `/reports/sales-by-dimension?${q(f)}` },
        { label: "Invoices issued", value: num(invoices), href: `/reports/document-register?${q(f, { docType: "invoice" })}` },
        { label: "Voids / cancellations", value: `${voided} / ${cancelled}`, tone: voided + cancelled ? "warn" : undefined, href: `/reports/document-register?${q(f, { docType: "void" })}` },
        { label: "Top SKU by value", value: topName ?? "—", sub: top ? peso(top._sum.lineTotal ?? 0) : undefined, href: `/reports/sales-by-dimension?${q(f)}` },
      ];
    },
  },
  {
    id: "inventory",
    title: "Inventory",
    blurb: "Stock on hand, good and bad stock, near-expiry and expired lots, van balances.",
    module: "inventory",
    filters: ["branch"],
    async tiles(f, s) {
      const ids = branchIds(f, s);
      const wh = { locationType: "warehouse", warehouse: ids ? { branchId: { in: ids } } : undefined };
      const [bal, vanBal, adj] = await Promise.all([
        prisma.stockBalance.findMany({ where: wh, include: { product: true } }),
        prisma.stockBalance.findMany({ where: { locationType: "van", van: ids ? { branchId: { in: ids } } : undefined }, include: { product: true } }),
        prisma.stockAdjustment.count({ where: { status: { in: ["pending", "pending_approval"] }, warehouse: ids ? { branchId: { in: ids } } : undefined } }).catch(() => 0),
      ]);
      const now = Date.now();
      const near = bal.filter((b) => b.expiryDate && b.expiryDate.getTime() > now && b.expiryDate.getTime() - now <= 60 * 86400000 && b.qtyGood > 0).length;
      const expired = bal.filter((b) => (b.expiryDate && b.expiryDate.getTime() <= now && (b.qtyGood > 0 || b.qtyExpired > 0)) || b.qtyExpired > 0).length;
      const val = (rows: typeof bal) => rows.reduce((a, b) => a + b.qtyGood * b.product.unitPrice, 0);
      const qs = ids ? `&branch=${ids.join(",")}` : "";
      return [
        { label: "Warehouse stock value (good)", value: peso(val(bal)), href: `/reports/stock-on-hand?run=1${qs}` },
        { label: "Good units", value: num(bal.reduce((a, b) => a + b.qtyGood, 0)), href: `/reports/stock-on-hand?run=1&stockStatus=good${qs}` },
        { label: "Damaged / quarantine units", value: num(bal.reduce((a, b) => a + b.qtyDamaged + b.qtyQuarantine, 0)), tone: "warn", href: `/reports/stock-on-hand?run=1&stockStatus=damaged${qs}` },
        { label: "Near-expiry lots (60 days)", value: num(near), tone: near ? "warn" : "good", href: `/reports/near-expiry?run=1${qs}` },
        { label: "Expired lots", value: num(expired), tone: expired ? "bad" : "good", href: `/reports/near-expiry?run=1&days=0${qs}` },
        { label: "Van stock value", value: peso(val(vanBal)), href: `/reports/van-inventory?run=1${qs}` },
        { label: "Adjustments awaiting approval", value: num(adj), tone: adj ? "warn" : undefined, href: "/branch/stock-adjustments" },
      ];
    },
  },
  {
    id: "purchasing",
    title: "Purchasing",
    blurb: "Purchase orders open and closed, receiving discrepancies and goods in transit.",
    module: "purchasing",
    filters: ["branch", "date"],
    async tiles(f, s) {
      const ids = branchIds(f, s);
      const { from, to } = period(f, 90);
      const pos = await prisma.purchaseOrder.findMany({ where: { orderDate: { gte: from, lte: to }, ...B(ids) }, include: { goodsReceipts: { where: { status: "posted" }, orderBy: { receivedDate: "asc" } } } });
      const [review, transit] = await Promise.all([
        prisma.goodsReceipt.count({ where: { status: "pending_review", warehouse: ids ? { branchId: { in: ids } } : undefined } }),
        prisma.stockTransfer.count({ where: { status: "in_transit" } }).catch(() => 0),
      ]);
      const lead = pos.filter((p) => p.goodsReceipts[0]).map((p) => (p.goodsReceipts[0].receivedDate.getTime() - p.orderDate.getTime()) / 86400000);
      const by = (st: string) => pos.filter((p) => p.status === st).length;
      return [
        { label: "Open POs", value: num(by("pending")), href: `/reports/po-variance?${q(f, { status: "pending" })}` },
        { label: "Partially received", value: num(by("partially_received")), tone: by("partially_received") ? "warn" : undefined, href: `/reports/po-variance?${q(f, { status: "partially_received" })}` },
        { label: "Closed (received)", value: num(by("received")), tone: "good", href: `/reports/po-variance?${q(f, { status: "received" })}` },
        { label: "PO exceptions", value: num(by("exception")), tone: by("exception") ? "bad" : undefined, href: `/reports/po-variance?${q(f, { status: "exception" })}` },
        { label: "Receipts awaiting variance review", value: num(review), tone: review ? "warn" : undefined, href: "/branch/purchase-orders" },
        { label: "Goods in transit (transfers)", value: num(transit), href: "/branch/stock-transfers" },
        { label: "Average lead time (days)", value: lead.length ? (lead.reduce((a, b) => a + b, 0) / lead.length).toFixed(1) : "—", sub: "order to first receipt", href: `/reports/po-variance?${q(f)}` },
      ];
    },
  },
  {
    id: "claims",
    title: "Claims",
    blurb: "Claims submitted, approved, rejected and settled; value by status and ageing.",
    module: "promotions",
    filters: ["branch", "date"],
    async tiles(f, s) {
      const ids = branchIds(f, s);
      const { from, to } = period(f, 180);
      const claims = await prisma.claim.findMany({ where: { submittedAt: { gte: from, lte: to }, ...(ids ? { OR: [{ branchId: { in: ids } }, { branchId: null }] } : {}) } });
      const st = (...x: string[]) => claims.filter((c) => x.includes(c.status));
      const val = (rows: typeof claims) => peso(rows.reduce((a, c) => a + c.amount, 0));
      const old = claims.filter((c) => ["submitted", "under_review", "returned"].includes(c.status) && Date.now() - c.submittedAt.getTime() > 14 * 86400000);
      const link = (status: string) => `/reports/claims-register?${q(f, { status })}`;
      return [
        { label: "Submitted / under review", value: num(st("submitted", "under_review").length), sub: val(st("submitted", "under_review")), tone: "warn", href: link("submitted") },
        { label: "Returned for correction", value: num(st("returned").length), sub: val(st("returned")), href: link("returned") },
        { label: "Approved", value: num(st("approved").length), sub: val(st("approved")), tone: "good", href: link("approved") },
        { label: "Rejected", value: num(st("rejected").length), sub: val(st("rejected")), href: link("rejected") },
        { label: "Settlement pending", value: num(st("settlement_pending").length), sub: val(st("settlement_pending")), href: link("settlement_pending") },
        { label: "Settled", value: num(st("settled").length), sub: val(st("settled")), tone: "good", href: link("settled") },
        { label: "Ageing over 14 days (open)", value: num(old.length), sub: val(old), tone: old.length ? "bad" : "good", href: `/reports/claims-register?${q(f)}` },
      ];
    },
  },
  {
    id: "returns",
    title: "Returns",
    blurb: "Market, van and central-warehouse returns across branches.",
    module: "sales",
    filters: ["branch", "date"],
    async tiles(f, s) {
      const ids = branchIds(f, s);
      const { from, to } = period(f, 30);
      const [mk, vn, ct] = await Promise.all([
        prisma.marketReturn.findMany({ where: { createdAt: { gte: from, lte: to }, outlet: ids ? { branchId: { in: ids } } : undefined }, include: { product: true } }),
        prisma.vanReturn.findMany({ where: { createdAt: { gte: from, lte: to }, van: ids ? { branchId: { in: ids } } : undefined } }),
        prisma.supplierReturn.findMany({ where: { createdAt: { gte: from, lte: to }, warehouse: ids ? { branchId: { in: ids } } : undefined } }),
      ]);
      const link = (t: string, extra = "") => `/reports/returns-register?${q(f, { docType: t })}${extra}`;
      return [
        { label: "Market returns", value: num(mk.length), sub: peso(mk.reduce((a, r) => a + r.product.unitPrice * r.qty, 0)), href: link("market") },
        { label: "Awaiting credit note", value: num(mk.filter((r) => r.status === "pending").length), tone: mk.some((r) => r.status === "pending") ? "warn" : "good", href: link("market", "&status=pending") },
        { label: "Outside return policy", value: num(mk.filter((r) => r.outsidePolicy).length), href: link("market") },
        { label: "Van returns", value: num(vn.length), sub: `${vn.reduce((a, r) => a + (r.qtyReceived ?? r.qty), 0)} units`, href: link("van") },
        { label: "Van returns with open variance", value: num(vn.filter((r) => ["variance_pending", "variance_open"].includes(r.status)).length), tone: vn.some((r) => ["variance_pending", "variance_open"].includes(r.status)) ? "bad" : "good", href: link("van") },
        { label: "Returns to central warehouse", value: num(ct.length), sub: `${ct.reduce((a, r) => a + r.qty, 0)} units`, href: link("central") },
        { label: "In transit to central", value: num(ct.filter((r) => ["shipped", "in_transit"].includes(r.status)).length), href: link("central") },
        { label: "Central-return discrepancies", value: num(ct.filter((r) => !!r.discrepancyNote).length), tone: ct.some((r) => !!r.discrepancyNote) ? "bad" : "good", href: link("central") },
      ];
    },
  },
  {
    id: "receivables",
    title: "Receivables",
    blurb: "Outstanding balance, ageing, overdue invoices, collections and customers over limit.",
    module: "finance",
    filters: ["branch", "date"],
    async tiles(f, s) {
      const ids = branchIds(f, s);
      const { from, to } = period(f, 30);
      const invoices = await prisma.invoice.findMany({ where: { status: { in: ["unpaid", "partially_paid", "overdue"] }, ...B(ids) }, include: { arLedgerEntries: true, outlet: true } });
      const pays = await prisma.aRLedgerEntry.aggregate({ where: { type: "payment", entryDate: { gte: from, lte: to }, recStatus: { not: "reversed" }, OR: [{ paymentStatus: null }, { paymentStatus: { notIn: ["pending", "bounced"] } }], outlet: ids ? { branchId: { in: ids } } : undefined }, _sum: { amount: true } });
      const now = new Date();
      let outstanding = 0;
      let overdue = 0;
      let overdueCount = 0;
      const perOutlet = new Map<string, { limit: number; bal: number }>();
      for (const i of invoices) {
        const b = invoiceBalance(i);
        if (b <= 0) continue;
        outstanding += b;
        if (i.dueDate < now) {
          overdue += b;
          overdueCount++;
        }
        const cur = perOutlet.get(i.outletId) ?? { limit: i.outlet.creditLimit, bal: 0 };
        cur.bal += b;
        perOutlet.set(i.outletId, cur);
      }
      const over = [...perOutlet.values()].filter((o) => o.bal > o.limit).length;
      const pending = await prisma.aRLedgerEntry.aggregate({ where: { type: "payment", paymentStatus: "pending", recStatus: { not: "reversed" }, outlet: ids ? { branchId: { in: ids } } : undefined }, _sum: { amount: true } });
      return [
        { label: "Outstanding balance", value: peso(outstanding), href: `/reports/receivables-ageing?${q(f)}` },
        { label: "Overdue", value: peso(overdue), sub: `${overdueCount} invoices`, tone: overdue ? "bad" : "good", href: `/reports/receivables-ageing?${q(f)}` },
        { label: "Collections (period)", value: peso(pays._sum.amount ?? 0), tone: "good", href: `/reports/sfa-collections?${q(f)}` },
        { label: "Customers over credit limit", value: num(over), tone: over ? "bad" : "good", href: "/supervisor/credit" },
        { label: "Cheques pending clearance", value: peso(pending._sum.amount ?? 0), href: "/supervisor/payment-reconciliation" },
        { label: "Customers on hold / blocked", value: num(await prisma.outlet.count({ where: { creditStatus: { in: ["on_hold", "blocked"] }, ...B(ids) } })), href: "/supervisor/credit" },
      ];
    },
  },
];

export function dashboardById(id: string) {
  return DASHBOARDS.find((d) => d.id === id);
}
