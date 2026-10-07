import { prisma } from "@/lib/prisma";
import { invoiceBalance, ledgerDelta, ageingBounds, bucketIndex, bucketLabels } from "@/lib/finance";
import { getAllSettings } from "@/lib/settings";
import type { ModuleId } from "@/lib/rbac";

// Standard report catalog. Every report is one definition — filters, columns and the query — so the screen, the
// export and the scheduled run always show the same figures. Branch scoping is applied here, not in the pages.

export type Cell = string | number | null;
export interface Column {
  key: string;
  label: string;
  type?: "money" | "int" | "date" | "pct" | "text";
}
export interface ReportResult {
  columns: Column[];
  rows: Record<string, Cell>[]; // optional `_href` makes a row drillable
  totals?: Record<string, Cell>;
  note?: string;
}
export interface FilterDef {
  key: string;
  label: string;
  type: "branch" | "channel" | "subchannel" | "route" | "rep" | "category" | "product" | "warehouse" | "customer" | "date" | "month" | "select" | "number" | "text";
  options?: { value: string; label: string }[];
  default?: string;
}
export interface Scope {
  branchIds: string[] | null; // null = every branch
  role: string;
  userName: string;
}
export type Filters = Record<string, string>;

export interface ReportDef {
  id: string;
  title: string;
  area: "customer" | "route" | "sales" | "inventory" | "purchasing" | "claims" | "receivables" | "field";
  purpose: string;
  module: ModuleId; // the permission that unlocks the report
  filters: FilterDef[];
  run: (f: Filters, s: Scope) => Promise<ReportResult>;
}

export const AREA_LABEL: Record<ReportDef["area"], string> = {
  customer: "Customer",
  route: "Route",
  sales: "Sales",
  inventory: "Inventory",
  purchasing: "Purchasing",
  claims: "Claims",
  receivables: "Receivables",
  field: "Field force (SFA)",
};

const SALE_STATUSES = ["confirmed", "picked", "invoiced", "delivered", "partially_delivered"];
const iso = (d: Date) => d.toISOString().slice(0, 10);

function range(f: Filters, defaultDays = 30): { from: Date; to: Date } {
  const to = f.dateTo ? new Date(f.dateTo) : new Date();
  to.setHours(23, 59, 59, 999);
  const from = f.dateFrom ? new Date(f.dateFrom) : new Date(to.getTime() - defaultDays * 86400000);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

// Branch ids a report may read: the user's scope, narrowed by the branch filter when one is chosen.
function branches(f: Filters, s: Scope): string[] | null {
  const chosen = (f.branch ?? "").split(",").filter(Boolean);
  if (s.branchIds === null) return chosen.length ? chosen : null;
  if (!chosen.length) return s.branchIds;
  return chosen.filter((c) => s.branchIds!.includes(c));
}
const inBranches = (ids: string[] | null) => (ids === null ? {} : { branchId: { in: ids } });

const D = (label = "From", key = "dateFrom"): FilterDef => ({ key, label, type: "date" });
const BR: FilterDef = { key: "branch", label: "Branch", type: "branch" };

function sum<T>(rows: T[], pick: (r: T) => number) {
  return rows.reduce((a, r) => a + pick(r), 0);
}

export const REPORTS: ReportDef[] = [
  // ---------------------------------------------------------------- customer
  {
    id: "customer-master",
    title: "Customer master listing",
    area: "customer",
    purpose: "Outlets with channel, route, status and credit terms.",
    module: "master_data",
    filters: [BR, { key: "channel", label: "Channel", type: "channel" }, { key: "subChannel", label: "Sub-channel", type: "subchannel" }, { key: "route", label: "Route", type: "route" }, { key: "status", label: "Status", type: "select", options: ["active", "inactive", "blocked"].map((v) => ({ value: v, label: v })) }],
    async run(f, s) {
      const ids = branches(f, s);
      const outlets = await prisma.outlet.findMany({
        where: { ...inBranches(ids), ...(f.channel ? { channelId: f.channel } : {}), ...(f.subChannel ? { subChannel: f.subChannel } : {}), ...(f.route ? { routeId: f.route } : {}), ...(f.status ? { status: f.status } : {}) },
        include: { branch: true, channel: true, route: true },
        orderBy: [{ branch: { name: "asc" } }, { name: "asc" }],
      });
      return {
        columns: [
          { key: "code", label: "Code" }, { key: "name", label: "Customer" }, { key: "branch", label: "Branch" }, { key: "channel", label: "Channel" }, { key: "sub", label: "Sub-channel" },
          { key: "route", label: "Route" }, { key: "status", label: "Status" }, { key: "terms", label: "Terms" }, { key: "limit", label: "Credit limit", type: "money" }, { key: "credit", label: "Credit status" },
        ],
        rows: outlets.map((o) => ({ _href: s.role === "admin" ? `/admin/outlets/${o.id}` : null, code: o.code, name: o.name, branch: o.branch.name, channel: o.channel.name, sub: o.subChannel, route: o.route?.name ?? "—", status: o.status, terms: o.paymentTerms.replace("_", " "), limit: o.creditLimit, credit: o.creditStatus.replace("_", " ") })),
        totals: { name: `${outlets.length} customers`, limit: sum(outlets, (o) => o.creditLimit) },
      };
    },
  },
  {
    id: "new-inactive-customers",
    title: "New and inactive customers",
    area: "customer",
    purpose: "Outlets added or deactivated in a period.",
    module: "master_data",
    filters: [BR, D(), D("To", "dateTo"), { key: "status", label: "Show", type: "select", options: [{ value: "new", label: "New" }, { value: "inactive", label: "Deactivated / blocked" }] }],
    async run(f, s) {
      const ids = branches(f, s);
      const { from, to } = range(f, 90);
      const rows: Record<string, Cell>[] = [];
      if (f.status !== "inactive") {
        const created = await prisma.outlet.findMany({ where: { ...inBranches(ids), createdAt: { gte: from, lte: to } }, include: { branch: true, channel: true }, orderBy: { createdAt: "desc" } });
        for (const o of created) rows.push({ _href: s.role === "admin" ? `/admin/outlets/${o.id}` : null, event: "New", date: iso(o.createdAt), code: o.code, name: o.name, branch: o.branch.name, channel: o.channel.name, status: o.status, detail: `Onboarding ${o.onboardingStatus}` });
      }
      if (f.status !== "new") {
        const logs = await prisma.auditLog.findMany({ where: { entity: "Outlet", createdAt: { gte: from, lte: to }, OR: [{ summary: { contains: "eactivat" } }, { summary: { contains: "lock" } }] }, orderBy: { createdAt: "desc" } });
        const outlets = await prisma.outlet.findMany({ where: { id: { in: logs.map((l) => l.entityId) }, ...inBranches(ids) }, include: { branch: true, channel: true } });
        for (const l of logs) {
          const o = outlets.find((x) => x.id === l.entityId);
          if (o) rows.push({ _href: s.role === "admin" ? `/admin/outlets/${o.id}` : null, event: "Deactivated / blocked", date: iso(l.createdAt), code: o.code, name: o.name, branch: o.branch.name, channel: o.channel.name, status: o.status, detail: l.summary });
        }
      }
      return { columns: [{ key: "event", label: "Event" }, { key: "date", label: "Date", type: "date" }, { key: "code", label: "Code" }, { key: "name", label: "Customer" }, { key: "branch", label: "Branch" }, { key: "channel", label: "Channel" }, { key: "status", label: "Status now" }, { key: "detail", label: "Detail" }], rows, totals: { name: `${rows.length} records` } };
    },
  },
  // ---------------------------------------------------------------- route
  {
    id: "route-coverage",
    title: "Route coverage and visit summary",
    area: "route",
    purpose: "Planned versus completed visits per route and representative.",
    module: "reports",
    filters: [BR, { key: "route", label: "Route", type: "route" }, { key: "rep", label: "Representative", type: "rep" }, D(), D("To", "dateTo")],
    async run(f, s) {
      const ids = branches(f, s);
      const { from, to } = range(f, 14);
      const visits = await prisma.fieldVisit.findMany({
        where: { checkinAt: { gte: from, lte: to }, outlet: { ...inBranches(ids), ...(f.route ? { routeId: f.route } : {}) }, ...(f.rep ? { salespersonId: f.rep } : {}) },
        include: { outlet: { include: { route: true } }, salesperson: true },
      });
      const orders = await prisma.salesOrder.findMany({ where: { orderDate: { gte: from, lte: to }, status: { in: SALE_STATUSES }, ...inBranches(ids) }, select: { outletId: true, salespersonId: true } });
      const groups = new Map<string, typeof visits>();
      for (const v of visits) groups.set(`${v.outlet.routeId ?? "-"}|${v.salespersonId}`, [...(groups.get(`${v.outlet.routeId ?? "-"}|${v.salespersonId}`) ?? []), v]);
      const rows: Record<string, Cell>[] = [];
      for (const [, vs] of groups) {
        const route = vs[0].outlet.route;
        const rep = vs[0].salesperson;
        const outletsOnRoute = route ? await prisma.outlet.count({ where: { routeId: route.id, status: "active" } }) : 0;
        const visited = new Set(vs.filter((v) => v.status !== "skipped").map((v) => v.outletId));
        const planned = vs.filter((v) => v.visitType === "planned");
        const productive = new Set(vs.filter((v) => orders.some((o) => o.outletId === v.outletId && o.salespersonId === rep.id)).map((v) => v.id)).size;
        rows.push({
          _href: route && s.role === "admin" ? `/admin/routes/${route.id}` : null,
          route: route?.name ?? "No route", rep: rep.name, outlets: outletsOnRoute, visited: visited.size, total: vs.length, planned: planned.length,
          unplanned: vs.filter((v) => v.visitType === "unplanned").length, skipped: vs.filter((v) => v.status === "skipped").length, productive,
          coverage: outletsOnRoute ? Math.round((visited.size / outletsOnRoute) * 100) : null,
        });
      }
      rows.sort((a, b) => String(a.route).localeCompare(String(b.route)));
      return {
        columns: [{ key: "route", label: "Route" }, { key: "rep", label: "Representative" }, { key: "outlets", label: "Outlets on route", type: "int" }, { key: "visited", label: "Outlets visited", type: "int" }, { key: "total", label: "Visits", type: "int" }, { key: "planned", label: "Planned", type: "int" }, { key: "unplanned", label: "Unplanned", type: "int" }, { key: "skipped", label: "Skipped", type: "int" }, { key: "productive", label: "Productive", type: "int" }, { key: "coverage", label: "Coverage", type: "pct" }],
        rows,
        totals: { route: "Total", total: sum(rows, (r) => Number(r.total)), planned: sum(rows, (r) => Number(r.planned)), unplanned: sum(rows, (r) => Number(r.unplanned)), skipped: sum(rows, (r) => Number(r.skipped)), productive: sum(rows, (r) => Number(r.productive)) },
      };
    },
  },
  // ---------------------------------------------------------------- sales
  {
    id: "sales-by-dimension",
    title: "Sales by SKU, category and customer",
    area: "sales",
    purpose: "Quantity and value sold, grouped as you choose.",
    module: "sales",
    filters: [BR, D(), D("To", "dateTo"), { key: "channel", label: "Channel", type: "channel" }, { key: "category", label: "Category", type: "category" }, { key: "sku", label: "SKU", type: "product" }, { key: "customer", label: "Customer", type: "customer" }, { key: "groupBy", label: "Group by", type: "select", default: "sku", options: [{ value: "sku", label: "SKU" }, { value: "category", label: "Category" }, { value: "customer", label: "Customer" }] }],
    async run(f, s) {
      const ids = branches(f, s);
      const { from, to } = range(f);
      const lines = await prisma.salesOrderLine.findMany({
        where: { salesOrder: { orderDate: { gte: from, lte: to }, status: { in: SALE_STATUSES }, ...inBranches(ids), ...(f.customer ? { outletId: f.customer } : {}), ...(f.channel ? { outlet: { channelId: f.channel } } : {}) }, ...(f.sku ? { productId: f.sku } : {}), ...(f.category ? { product: { category: f.category } } : {}) },
        include: { product: true, salesOrder: { include: { outlet: true } } },
      });
      const g = f.groupBy || "sku";
      const map = new Map<string, { label: string; code: string; qty: number; gross: number; disc: number; orders: Set<string>; href: string | null }>();
      for (const l of lines) {
        const key = g === "sku" ? l.productId : g === "category" ? l.product.category : l.salesOrder.outletId;
        const cur = map.get(key) ?? { label: g === "sku" ? l.product.name : g === "category" ? l.product.category : l.salesOrder.outlet.name, code: g === "sku" ? l.product.sku : g === "customer" ? l.salesOrder.outlet.code ?? "" : "", qty: 0, gross: 0, disc: 0, orders: new Set<string>(), href: null };
        cur.qty += l.qty;
        cur.gross += l.unitPrice * l.qty;
        cur.disc += l.discount;
        cur.orders.add(l.salesOrderId);
        map.set(key, cur);
      }
      const rows = [...map.values()].sort((a, b) => b.gross - b.disc - (a.gross - a.disc)).map((m) => ({ code: m.code, name: m.label, orders: m.orders.size, qty: m.qty, gross: m.gross, disc: m.disc, net: m.gross - m.disc }));
      return {
        columns: [{ key: "code", label: g === "category" ? "" : "Code" }, { key: "name", label: g === "sku" ? "Product" : g === "category" ? "Category" : "Customer" }, { key: "orders", label: "Orders", type: "int" }, { key: "qty", label: "Quantity", type: "int" }, { key: "gross", label: "Gross value", type: "money" }, { key: "disc", label: "Discounts", type: "money" }, { key: "net", label: "Net value", type: "money" }],
        rows,
        totals: { name: "Total", qty: sum(rows, (r) => r.qty), gross: sum(rows, (r) => r.gross), disc: sum(rows, (r) => r.disc), net: sum(rows, (r) => r.net) },
      };
    },
  },
  {
    id: "sales-vs-target",
    title: "Sales by representative against target",
    area: "sales",
    purpose: "Achievement against the monthly sales target.",
    module: "sales",
    filters: [BR, { key: "rep", label: "Representative", type: "rep" }, { key: "month", label: "Period", type: "month", default: iso(new Date()).slice(0, 7) }],
    async run(f, s) {
      const ids = branches(f, s);
      const month = f.month || iso(new Date()).slice(0, 7);
      const from = new Date(`${month}-01T00:00:00`);
      const to = new Date(from.getFullYear(), from.getMonth() + 1, 0, 23, 59, 59, 999);
      const reps = await prisma.user.findMany({ where: { role: "sales_rep", active: true, ...inBranches(ids), ...(f.rep ? { id: f.rep } : {}) }, include: { branch: true }, orderBy: { name: "asc" } });
      const [orders, targets] = await Promise.all([
        prisma.salesOrder.groupBy({ by: ["salespersonId"], where: { orderDate: { gte: from, lte: to }, status: { in: SALE_STATUSES }, salespersonId: { in: reps.map((r) => r.id) } }, _sum: { total: true }, _count: true }),
        prisma.target.findMany({ where: { period: month, metric: "sales_value", userId: { in: reps.map((r) => r.id) } } }),
      ]);
      const rows = reps.map((r) => {
        const sales = orders.find((o) => o.salespersonId === r.id)?._sum.total ?? 0;
        const target = targets.find((t) => t.userId === r.id)?.targetValue ?? null;
        return { rep: r.name, branch: r.branch?.name ?? "—", orders: orders.find((o) => o.salespersonId === r.id)?._count ?? 0, sales, target, gap: target != null ? sales - target : null, ach: target ? Math.round((sales / target) * 100) : null };
      });
      return {
        columns: [{ key: "rep", label: "Representative" }, { key: "branch", label: "Branch" }, { key: "orders", label: "Orders", type: "int" }, { key: "sales", label: "Sales", type: "money" }, { key: "target", label: "Target", type: "money" }, { key: "gap", label: "Gap to target", type: "money" }, { key: "ach", label: "Achievement", type: "pct" }],
        rows,
        totals: { rep: "Total", orders: sum(rows, (r) => r.orders), sales: sum(rows, (r) => r.sales), target: sum(rows, (r) => Number(r.target ?? 0)) },
        note: `Period ${month}. Targets are maintained per representative and month.`,
      };
    },
  },
  {
    id: "document-register",
    title: "Invoice, void and returns register",
    area: "sales",
    purpose: "Documents with status and reason.",
    module: "sales",
    filters: [BR, D(), D("To", "dateTo"), { key: "docType", label: "Document type", type: "select", options: [{ value: "invoice", label: "Invoices" }, { value: "void", label: "Voids / cancellations" }, { value: "return", label: "Market returns" }, { value: "credit_note", label: "Credit notes" }] }, { key: "status", label: "Status", type: "text" }],
    async run(f, s) {
      const ids = branches(f, s);
      const { from, to } = range(f);
      const rows: Record<string, Cell>[] = [];
      const want = (t: string) => !f.docType || f.docType === t;
      if (want("invoice")) {
        const inv = await prisma.invoice.findMany({ where: { invoiceDate: { gte: from, lte: to }, ...inBranches(ids), ...(f.status ? { status: f.status } : {}) }, include: { outlet: true }, orderBy: { invoiceDate: "desc" } });
        for (const i of inv) rows.push({ _href: `/supervisor/invoices/${i.id}`, type: "Invoice", number: i.invoiceNumber, date: iso(i.invoiceDate), customer: i.outlet.name, amount: i.amount, status: i.status, reason: i.status === "voided" ? "Voided" : "" });
      }
      if (want("void")) {
        const ords = await prisma.salesOrder.findMany({ where: { orderDate: { gte: from, lte: to }, status: { in: ["voided", "cancelled"] }, ...inBranches(ids) }, include: { outlet: true } });
        for (const o of ords) rows.push({ _href: `/supervisor/orders/${o.id}`, type: o.status === "voided" ? "Void" : "Cancellation", number: o.orderNumber, date: iso(o.orderDate), customer: o.outlet.name, amount: o.total, status: o.status, reason: o.voidReason ?? o.cancelReason ?? "" });
      }
      if (want("return")) {
        const rets = await prisma.marketReturn.findMany({ where: { createdAt: { gte: from, lte: to }, outlet: inBranches(ids) }, include: { outlet: true, product: true } });
        for (const r of rets) rows.push({ _href: "/supervisor/market-returns", type: "Market return", number: r.id.slice(-8).toUpperCase(), date: iso(r.createdAt), customer: r.outlet.name, amount: r.product.unitPrice * r.qty, status: r.status, reason: r.reason.replace(/_/g, " ") });
      }
      if (want("credit_note")) {
        const cns = await prisma.creditNote.findMany({ where: { issuedAt: { gte: from, lte: to }, outlet: inBranches(ids) }, include: { outlet: true } });
        for (const c of cns) rows.push({ _href: "/supervisor/finance-documents", type: "Credit note", number: c.noteNumber, date: iso(c.issuedAt), customer: c.outlet.name, amount: c.amount, status: c.status, reason: c.reason });
      }
      rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return { columns: [{ key: "type", label: "Type" }, { key: "number", label: "Number" }, { key: "date", label: "Date", type: "date" }, { key: "customer", label: "Customer" }, { key: "amount", label: "Amount", type: "money" }, { key: "status", label: "Status" }, { key: "reason", label: "Reason" }], rows, totals: { type: `${rows.length} documents`, amount: sum(rows, (r) => Number(r.amount)) } };
    },
  },
  // ---------------------------------------------------------------- inventory
  {
    id: "stock-on-hand",
    title: "Stock on hand and stock movement",
    area: "inventory",
    purpose: "Balances by warehouse, SKU, lot and expiry — or the movements behind them.",
    module: "inventory",
    filters: [BR, { key: "warehouse", label: "Warehouse", type: "warehouse" }, { key: "category", label: "Category", type: "category" }, { key: "sku", label: "SKU", type: "product" }, { key: "stockStatus", label: "Stock status", type: "select", options: ["good", "damaged", "expired", "quarantine"].map((v) => ({ value: v, label: v })) }, { key: "mode", label: "Show", type: "select", default: "balances", options: [{ value: "balances", label: "Balances" }, { value: "movements", label: "Movements" }] }, D(), D("To", "dateTo")],
    async run(f, s) {
      const ids = branches(f, s);
      const whs = await prisma.warehouse.findMany({ where: { ...inBranches(ids), ...(f.warehouse ? { id: f.warehouse } : {}) } });
      const whIds = whs.map((w) => w.id);
      const wname = new Map(whs.map((w) => [w.id, w.name]));
      const products = await prisma.product.findMany({ where: { ...(f.category ? { category: f.category } : {}), ...(f.sku ? { id: f.sku } : {}) } });
      const pmap = new Map(products.map((p) => [p.id, p]));
      if (f.mode === "movements") {
        const { from, to } = range(f, 7);
        const mv = await prisma.stockMovement.findMany({ where: { createdAt: { gte: from, lte: to }, locationType: "warehouse", warehouseId: { in: whIds }, productId: { in: products.map((p) => p.id) }, ...(f.stockStatus ? { bucket: f.stockStatus } : {}) }, orderBy: { createdAt: "desc" }, take: 500 });
        return { columns: [{ key: "when", label: "When", type: "date" }, { key: "wh", label: "Warehouse" }, { key: "sku", label: "SKU" }, { key: "name", label: "Product" }, { key: "lot", label: "Lot" }, { key: "bucket", label: "Bucket" }, { key: "type", label: "Movement" }, { key: "qty", label: "Qty", type: "int" }, { key: "ref", label: "Document" }, { key: "by", label: "By" }], rows: mv.map((m) => ({ when: m.createdAt.toISOString().slice(0, 16).replace("T", " "), wh: wname.get(m.warehouseId ?? "") ?? "", sku: pmap.get(m.productId)?.sku ?? "", name: pmap.get(m.productId)?.name ?? "", lot: m.lotNumber, bucket: m.bucket, type: m.type.replace(/_/g, " "), qty: m.qty, ref: m.refNumber ?? "", by: m.userName ?? "" })), note: mv.length === 500 ? "First 500 movements shown — narrow the dates or filters." : undefined };
      }
      const bal = await prisma.stockBalance.findMany({ where: { locationType: "warehouse", warehouseId: { in: whIds }, productId: { in: products.map((p) => p.id) } }, orderBy: [{ productId: "asc" }, { expiryDate: "asc" }] });
      const rows = bal
        .filter((b) => !f.stockStatus || (f.stockStatus === "good" ? b.qtyGood : f.stockStatus === "damaged" ? b.qtyDamaged : f.stockStatus === "expired" ? b.qtyExpired : b.qtyQuarantine) > 0)
        .map((b) => ({ _href: `/branch/warehouse-stock/${b.productId}`, wh: wname.get(b.warehouseId ?? "") ?? "", sku: pmap.get(b.productId)?.sku ?? "", name: pmap.get(b.productId)?.name ?? "", lot: b.lotNumber, expiry: b.expiryDate ? iso(b.expiryDate) : "", good: b.qtyGood, damaged: b.qtyDamaged, expired: b.qtyExpired, quarantine: b.qtyQuarantine, reserved: b.qtyReserved, available: b.qtyGood - b.qtyReserved, value: b.qtyGood * (pmap.get(b.productId)?.unitPrice ?? 0) }));
      return { columns: [{ key: "wh", label: "Warehouse" }, { key: "sku", label: "SKU" }, { key: "name", label: "Product" }, { key: "lot", label: "Lot" }, { key: "expiry", label: "Expiry", type: "date" }, { key: "good", label: "Good", type: "int" }, { key: "damaged", label: "Damaged", type: "int" }, { key: "expired", label: "Expired", type: "int" }, { key: "quarantine", label: "Quarantine", type: "int" }, { key: "reserved", label: "Reserved", type: "int" }, { key: "available", label: "Available", type: "int" }, { key: "value", label: "Good value", type: "money" }], rows, totals: { name: "Total", good: sum(rows, (r) => r.good), damaged: sum(rows, (r) => r.damaged), expired: sum(rows, (r) => r.expired), quarantine: sum(rows, (r) => r.quarantine), reserved: sum(rows, (r) => r.reserved), available: sum(rows, (r) => r.available), value: sum(rows, (r) => r.value) } };
    },
  },
  {
    id: "near-expiry",
    title: "Near-expiry and expired stock",
    area: "inventory",
    purpose: "Lots approaching or past expiry.",
    module: "inventory",
    filters: [BR, { key: "warehouse", label: "Warehouse", type: "warehouse" }, { key: "days", label: "Days to expiry (up to)", type: "number", default: "60" }],
    async run(f, s) {
      const ids = branches(f, s);
      const days = Number(f.days || 60);
      const limit = new Date(Date.now() + days * 86400000);
      const bal = await prisma.stockBalance.findMany({ where: { locationType: "warehouse", warehouse: { ...inBranches(ids), ...(f.warehouse ? { id: f.warehouse } : {}) }, expiryDate: { not: null, lte: limit } }, include: { product: true, warehouse: true }, orderBy: { expiryDate: "asc" } });
      const now = Date.now();
      const rows = bal
        .filter((b) => b.qtyGood + b.qtyExpired + b.qtyDamaged + b.qtyQuarantine > 0)
        .map((b) => {
          const left = Math.floor((b.expiryDate!.getTime() - now) / 86400000);
          const qty = b.qtyGood + b.qtyExpired + b.qtyQuarantine;
          return { _href: `/branch/near-expiry`, wh: b.warehouse?.name ?? "", sku: b.product.sku, name: b.product.name, lot: b.lotNumber, expiry: iso(b.expiryDate!), left, band: left < 0 ? "Expired" : left <= 30 ? "Critical" : "Warning", qty, value: qty * b.product.unitPrice };
        });
      return { columns: [{ key: "wh", label: "Warehouse" }, { key: "sku", label: "SKU" }, { key: "name", label: "Product" }, { key: "lot", label: "Lot" }, { key: "expiry", label: "Expiry", type: "date" }, { key: "left", label: "Days left", type: "int" }, { key: "band", label: "Band" }, { key: "qty", label: "Quantity", type: "int" }, { key: "value", label: "Value at risk", type: "money" }], rows, totals: { name: "Total", qty: sum(rows, (r) => r.qty), value: sum(rows, (r) => r.value) } };
    },
  },
  {
    id: "van-inventory",
    title: "Van-level inventory",
    area: "inventory",
    purpose: "Stock on each van: good, damaged and value.",
    module: "van",
    filters: [BR],
    async run(f, s) {
      const ids = branches(f, s);
      const vans = await prisma.van.findMany({ where: inBranches(ids), include: { assignedUser: true, branch: true }, orderBy: { code: "asc" } });
      const bal = await prisma.stockBalance.findMany({ where: { locationType: "van", vanId: { in: vans.map((v) => v.id) } }, include: { product: true } });
      const rows = vans.map((v) => {
        const b = bal.filter((x) => x.vanId === v.id);
        return { _href: `/branch/van-stock?van=${v.id}`, van: v.code, rep: v.assignedUser?.name ?? v.driverName, branch: v.branch.name, skus: new Set(b.filter((x) => x.qtyGood + x.qtyDamaged > 0).map((x) => x.productId)).size, good: sum(b, (x) => x.qtyGood), damaged: sum(b, (x) => x.qtyDamaged + x.qtyExpired), value: sum(b, (x) => x.qtyGood * x.product.unitPrice) };
      });
      return { columns: [{ key: "van", label: "Van" }, { key: "rep", label: "Representative" }, { key: "branch", label: "Branch" }, { key: "skus", label: "SKUs", type: "int" }, { key: "good", label: "Good units", type: "int" }, { key: "damaged", label: "Damaged / expired", type: "int" }, { key: "value", label: "Good value", type: "money" }], rows, totals: { van: "Total", good: sum(rows, (r) => r.good), damaged: sum(rows, (r) => r.damaged), value: sum(rows, (r) => r.value) } };
    },
  },
  // ---------------------------------------------------------------- purchasing
  {
    id: "po-variance",
    title: "Purchase order status and receiving variance",
    area: "purchasing",
    purpose: "Ordered versus received quantities and discrepancies.",
    module: "purchasing",
    filters: [BR, D(), D("To", "dateTo"), { key: "status", label: "Status", type: "select", options: ["pending", "partially_received", "received", "exception", "cancelled"].map((v) => ({ value: v, label: v.replace("_", " ") })) }, { key: "po", label: "PO number", type: "text" }],
    async run(f, s) {
      const ids = branches(f, s);
      const { from, to } = range(f, 90);
      const pos = await prisma.purchaseOrder.findMany({ where: { orderDate: { gte: from, lte: to }, ...inBranches(ids), ...(f.status ? { status: f.status } : {}), ...(f.po ? { poNumber: { contains: f.po } } : {}) }, include: { branch: true, lines: true, goodsReceipts: { where: { status: "posted" }, include: { lines: true } } }, orderBy: { orderDate: "desc" } });
      const rows = pos.map((p) => {
        const ordered = sum(p.lines, (l) => l.qtyOrdered);
        const received = sum(p.goodsReceipts.flatMap((g) => g.lines), (l) => l.qtyReceived);
        return { _href: `/branch/purchase-orders/${p.id}`, po: p.poNumber, branch: p.branch.name, supplier: p.supplier ?? "", date: iso(p.orderDate), status: p.status.replace("_", " "), ordered, received, variance: received - ordered, value: sum(p.lines, (l) => l.qtyOrdered * l.unitCost), note: p.exceptionReason ?? "" };
      });
      return { columns: [{ key: "po", label: "PO" }, { key: "branch", label: "Branch" }, { key: "supplier", label: "Supplier" }, { key: "date", label: "Date", type: "date" }, { key: "status", label: "Status" }, { key: "ordered", label: "Ordered", type: "int" }, { key: "received", label: "Received", type: "int" }, { key: "variance", label: "Variance", type: "int" }, { key: "value", label: "PO value", type: "money" }, { key: "note", label: "Exception" }], rows, totals: { po: `${rows.length} POs`, ordered: sum(rows, (r) => r.ordered), received: sum(rows, (r) => r.received), variance: sum(rows, (r) => r.variance), value: sum(rows, (r) => r.value) } };
    },
  },
  // ---------------------------------------------------------------- claims
  {
    id: "claims-register",
    title: "Claims register and settlement status",
    area: "claims",
    purpose: "Claims with approval and settlement state.",
    module: "promotions",
    filters: [BR, { key: "promotion", label: "Promotion", type: "select" }, { key: "status", label: "Status", type: "select", options: ["draft", "submitted", "under_review", "returned", "approved", "rejected", "settlement_pending", "settled"].map((v) => ({ value: v, label: v.replace(/_/g, " ") })) }, D(), D("To", "dateTo")],
    async run(f, s) {
      const ids = branches(f, s);
      const { from, to } = range(f, 180);
      const claims = await prisma.claim.findMany({ where: { submittedAt: { gte: from, lte: to }, ...(ids ? { OR: [{ branchId: { in: ids } }, { branchId: null }] } : {}), ...(f.promotion ? { promotionId: f.promotion } : {}), ...(f.status ? { status: f.status } : {}) }, include: { promotion: true, submittedBy: true }, orderBy: { submittedAt: "desc" } });
      const rows = claims.map((c) => ({ _href: `/supervisor/claims/${c.id}`, number: c.claimNumber, promo: c.promotion.name, by: c.submittedBy.name, date: iso(c.submittedAt), eligible: c.eligibleAmount, amount: c.amount, status: c.status.replace(/_/g, " "), ref: c.settlementReference ?? "", age: Math.floor((Date.now() - c.submittedAt.getTime()) / 86400000) }));
      return { columns: [{ key: "number", label: "Claim" }, { key: "promo", label: "Promotion" }, { key: "by", label: "Raised by" }, { key: "date", label: "Date", type: "date" }, { key: "eligible", label: "Eligible", type: "money" }, { key: "amount", label: "Claimed", type: "money" }, { key: "status", label: "Status" }, { key: "ref", label: "Settlement ref." }, { key: "age", label: "Age (days)", type: "int" }], rows, totals: { number: `${rows.length} claims`, eligible: sum(rows, (r) => Number(r.eligible ?? 0)), amount: sum(rows, (r) => Number(r.amount)) } };
    },
  },
  // ---------------------------------------------------------------- receivables
  {
    id: "receivables-ageing",
    title: "Receivables ageing and collections",
    area: "receivables",
    purpose: "Outstanding balances by ageing bucket and receipts applied.",
    module: "finance",
    filters: [BR, { key: "customer", label: "Customer", type: "customer" }, { key: "bucket", label: "Only customers with balance in", type: "select" }, { key: "asOf", label: "As of", type: "date" }],
    async run(f, s) {
      const ids = branches(f, s);
      const settings = await getAllSettings();
      const bounds = ageingBounds(settings["ageing.buckets"]);
      const labels = bucketLabels(bounds);
      const asOf = f.asOf ? new Date(f.asOf) : new Date();
      asOf.setHours(23, 59, 59, 999);
      const invoices = await prisma.invoice.findMany({ where: { invoiceDate: { lte: asOf }, status: { not: "voided" }, ...inBranches(ids), ...(f.customer ? { outletId: f.customer } : {}) }, include: { outlet: true, arLedgerEntries: true } });
      const byOutlet = new Map<string, { name: string; code: string; limit: number; b: number[]; receipts: number }>();
      for (const inv of invoices) {
        const entries = inv.arLedgerEntries.filter((e) => e.entryDate <= asOf);
        const bal = invoiceBalance({ amount: inv.amount, arLedgerEntries: entries });
        const cur = byOutlet.get(inv.outletId) ?? { name: inv.outlet.name, code: inv.outlet.code ?? "", limit: inv.outlet.creditLimit, b: labels.map(() => 0), receipts: 0 };
        if (bal > 0) cur.b[bucketIndex(Math.floor((asOf.getTime() - inv.dueDate.getTime()) / 86400000), bounds)] += bal;
        cur.receipts += entries.filter((e) => e.type === "payment" && e.recStatus !== "reversed" && e.paymentStatus !== "pending" && e.paymentStatus !== "bounced" && asOf.getTime() - e.entryDate.getTime() <= 30 * 86400000).reduce((a, e) => a + e.amount, 0);
        byOutlet.set(inv.outletId, cur);
      }
      let rows = [...byOutlet.entries()].map(([id, o]) => {
        const row: Record<string, Cell> = { _href: `/supervisor/payment-reconciliation?outlet=${id}`, code: o.code, name: o.name };
        labels.forEach((_, i) => (row[`b${i}`] = o.b[i]));
        row.total = o.b.reduce((a, x) => a + x, 0);
        row.limit = o.limit;
        row.over = Number(row.total) > o.limit ? "Over limit" : "";
        row.receipts = o.receipts;
        return row;
      });
      if (f.bucket) rows = rows.filter((r) => Number(r[`b${f.bucket}`] ?? 0) > 0);
      rows = rows.filter((r) => Number(r.total) > 0 || Number(r.receipts) > 0).sort((a, b) => Number(b.total) - Number(a.total));
      const totals: Record<string, Cell> = { name: "Total", total: sum(rows, (r) => Number(r.total)), receipts: sum(rows, (r) => Number(r.receipts)) };
      labels.forEach((_, i) => (totals[`b${i}`] = sum(rows, (r) => Number(r[`b${i}`]))));
      return { columns: [{ key: "code", label: "Code" }, { key: "name", label: "Customer" }, ...labels.map((l, i) => ({ key: `b${i}`, label: l, type: "money" as const })), { key: "total", label: "Total", type: "money" }, { key: "limit", label: "Credit limit", type: "money" }, { key: "over", label: "Flag" }, { key: "receipts", label: "Receipts (30 days)", type: "money" }], rows, totals, note: `Balances as of ${iso(asOf)}.` };
    },
  },
  // ---------------------------------------------------------------- field force
  {
    id: "field-activity",
    title: "Field activity report",
    area: "field",
    purpose: "Attendance, visits, orders, collections and field execution per representative.",
    module: "reports",
    filters: [BR, { key: "rep", label: "Representative", type: "rep" }, D(), D("To", "dateTo")],
    async run(f, s) {
      const ids = branches(f, s);
      const { from, to } = range(f, 7);
      const reps = await prisma.user.findMany({ where: { role: "sales_rep", active: true, ...inBranches(ids), ...(f.rep ? { id: f.rep } : {}) }, orderBy: { name: "asc" } });
      const rid = reps.map((r) => r.id);
      const [att, visits, orders, pays, tasks, notes] = await Promise.all([
        prisma.attendance.findMany({ where: { userId: { in: rid }, dayDate: { gte: from, lte: to } } }),
        prisma.fieldVisit.findMany({ where: { salespersonId: { in: rid }, checkinAt: { gte: from, lte: to } } }),
        prisma.salesOrder.findMany({ where: { salespersonId: { in: rid }, orderDate: { gte: from, lte: to }, status: { in: SALE_STATUSES } }, select: { salespersonId: true, total: true } }),
        prisma.aRLedgerEntry.findMany({ where: { collectedBy: { in: rid }, type: "payment", entryDate: { gte: from, lte: to }, recStatus: { not: "reversed" } }, select: { collectedBy: true, amount: true } }),
        prisma.task.findMany({ where: { assignedToId: { in: rid }, createdAt: { gte: from, lte: to } }, select: { assignedToId: true, status: true } }),
        prisma.fieldNote.findMany({ where: { salespersonId: { in: rid }, createdAt: { gte: from, lte: to } }, select: { salespersonId: true } }),
      ]);
      const rows = reps.map((r) => {
        const v = visits.filter((x) => x.salespersonId === r.id);
        const done = v.filter((x) => x.status === "completed");
        const minutes = done.filter((x) => x.checkoutAt).map((x) => (x.checkoutAt!.getTime() - x.checkinAt.getTime()) / 60000);
        const ords = orders.filter((o) => o.salespersonId === r.id);
        const productive = v.filter((x) => x.outcome === "order_taken").length;
        return { rep: r.name, days: att.filter((a) => a.userId === r.id).length, visits: v.length, completed: done.length, skipped: v.filter((x) => x.status === "skipped").length, productive, prodPct: v.length ? Math.round((productive / v.length) * 100) : null, avgMin: minutes.length ? Math.round(sum(minutes, (m) => m) / minutes.length) : null, orders: ords.length, sales: sum(ords, (o) => o.total), collections: sum(pays.filter((p) => p.collectedBy === r.id), (p) => p.amount), tasks: `${tasks.filter((t) => t.assignedToId === r.id && t.status === "completed").length}/${tasks.filter((t) => t.assignedToId === r.id).length}`, notes: notes.filter((n) => n.salespersonId === r.id).length };
      });
      return { columns: [{ key: "rep", label: "Representative" }, { key: "days", label: "Days worked", type: "int" }, { key: "visits", label: "Visits", type: "int" }, { key: "completed", label: "Completed", type: "int" }, { key: "skipped", label: "Skipped", type: "int" }, { key: "productive", label: "Productive", type: "int" }, { key: "prodPct", label: "Productive %", type: "pct" }, { key: "avgMin", label: "Avg. time in outlet (min)", type: "int" }, { key: "orders", label: "Orders", type: "int" }, { key: "sales", label: "Sales", type: "money" }, { key: "collections", label: "Collections", type: "money" }, { key: "tasks", label: "Tasks done" }, { key: "notes", label: "Field notes", type: "int" }], rows, totals: { rep: "Total", days: sum(rows, (r) => r.days), visits: sum(rows, (r) => r.visits), completed: sum(rows, (r) => r.completed), productive: sum(rows, (r) => r.productive), orders: sum(rows, (r) => r.orders), sales: sum(rows, (r) => r.sales), collections: sum(rows, (r) => r.collections) } };
    },
  },
  {
    id: "sfa-orders",
    title: "SFA orders report",
    area: "field",
    purpose: "Orders captured in the field with type, status and value.",
    module: "sales",
    filters: [BR, { key: "rep", label: "Representative", type: "rep" }, D(), D("To", "dateTo"), { key: "orderType", label: "Order type", type: "select", options: [{ value: "pre_sales", label: "Pre-sales" }, { value: "van_sale", label: "Van sale" }] }, { key: "status", label: "Status", type: "text" }],
    async run(f, s) {
      const ids = branches(f, s);
      const { from, to } = range(f, 14);
      const orders = await prisma.salesOrder.findMany({ where: { orderDate: { gte: from, lte: to }, source: "sfa", ...inBranches(ids), ...(f.rep ? { salespersonId: f.rep } : {}), ...(f.orderType ? { orderType: f.orderType } : {}), ...(f.status ? { status: f.status } : {}) }, include: { outlet: true, salesperson: true }, orderBy: { orderDate: "desc" } });
      const rows = orders.map((o) => ({ _href: `/supervisor/orders/${o.id}`, number: o.orderNumber, date: iso(o.orderDate), rep: o.salesperson.name, customer: o.outlet.name, type: o.orderType.replace("_", " "), status: o.status.replace("_", " "), discount: o.discountTotal, total: o.total }));
      return { columns: [{ key: "number", label: "Order" }, { key: "date", label: "Date", type: "date" }, { key: "rep", label: "Representative" }, { key: "customer", label: "Customer" }, { key: "type", label: "Type" }, { key: "status", label: "Status" }, { key: "discount", label: "Discount", type: "money" }, { key: "total", label: "Total", type: "money" }], rows, totals: { number: `${rows.length} orders`, discount: sum(rows, (r) => r.discount), total: sum(rows, (r) => r.total) } };
    },
  },
  {
    id: "sfa-collections",
    title: "SFA collections report",
    area: "field",
    purpose: "Cash, cheque and transfer collections by representative.",
    module: "finance",
    filters: [BR, { key: "rep", label: "Representative", type: "rep" }, D(), D("To", "dateTo"), { key: "method", label: "Mode", type: "select", options: [{ value: "cash", label: "Cash" }, { value: "cheque", label: "Cheque" }, { value: "bank_transfer", label: "Bank transfer" }, { value: "other", label: "Other" }] }],
    async run(f, s) {
      const ids = branches(f, s);
      const { from, to } = range(f, 14);
      const reps = await prisma.user.findMany({ where: { role: "sales_rep", ...inBranches(ids), ...(f.rep ? { id: f.rep } : {}) } });
      const entries = await prisma.aRLedgerEntry.findMany({ where: { type: "payment", collectedBy: { in: reps.map((r) => r.id) }, entryDate: { gte: from, lte: to }, ...(f.method ? { method: f.method } : {}) }, include: { outlet: true }, orderBy: { entryDate: "desc" } });
      const rname = new Map(reps.map((r) => [r.id, r.name]));
      const rows = entries.map((e) => ({ _href: `/supervisor/payment-reconciliation?outlet=${e.outletId}`, date: e.entryDate.toISOString().slice(0, 16).replace("T", " "), rep: rname.get(e.collectedBy ?? "") ?? "", customer: e.outlet.name, method: (e.method ?? "").replace("_", " "), ref: e.reference ?? "", cheque: e.chequeNumber ? `${e.chequeNumber} · ${e.chequeBank ?? ""}` : "", status: e.recStatus === "reversed" ? "reversed" : e.paymentStatus ?? "cleared", amount: e.amount }));
      return { columns: [{ key: "date", label: "When" }, { key: "rep", label: "Representative" }, { key: "customer", label: "Customer" }, { key: "method", label: "Mode" }, { key: "ref", label: "Reference" }, { key: "cheque", label: "Cheque" }, { key: "status", label: "Status" }, { key: "amount", label: "Amount", type: "money" }], rows, totals: { date: `${rows.length} receipts`, amount: sum(rows, (r) => r.amount) } };
    },
  },
  {
    id: "sfa-sales",
    title: "SFA sales report",
    area: "field",
    purpose: "Daily sales by representative.",
    module: "sales",
    filters: [BR, { key: "rep", label: "Representative", type: "rep" }, D(), D("To", "dateTo")],
    async run(f, s) {
      const ids = branches(f, s);
      const { from, to } = range(f, 14);
      const orders = await prisma.salesOrder.findMany({ where: { orderDate: { gte: from, lte: to }, source: "sfa", status: { in: SALE_STATUSES }, ...inBranches(ids), ...(f.rep ? { salespersonId: f.rep } : {}) }, include: { salesperson: true } });
      const map = new Map<string, { date: string; rep: string; orders: number; value: number; disc: number }>();
      for (const o of orders) {
        const key = `${iso(o.orderDate)}|${o.salespersonId}`;
        const cur = map.get(key) ?? { date: iso(o.orderDate), rep: o.salesperson.name, orders: 0, value: 0, disc: 0 };
        cur.orders += 1;
        cur.value += o.total;
        cur.disc += o.discountTotal;
        map.set(key, cur);
      }
      const rows = [...map.values()].sort((a, b) => b.date.localeCompare(a.date) || a.rep.localeCompare(b.rep));
      return { columns: [{ key: "date", label: "Date", type: "date" }, { key: "rep", label: "Representative" }, { key: "orders", label: "Orders", type: "int" }, { key: "disc", label: "Discounts", type: "money" }, { key: "value", label: "Sales", type: "money" }], rows, totals: { date: "Total", orders: sum(rows, (r) => r.orders), disc: sum(rows, (r) => r.disc), value: sum(rows, (r) => r.value) } };
    },
  },
];

export function reportById(id: string) {
  return REPORTS.find((r) => r.id === id);
}

export function resolveRelativeDates(f: Filters, rel?: string | null): Filters {
  if (!rel) return f;
  const now = new Date();
  const day = (d: Date) => iso(d);
  if (rel === "previous_day") {
    const y = new Date(now.getTime() - 86400000);
    return { ...f, dateFrom: day(y), dateTo: day(y) };
  }
  if (rel === "previous_week") return { ...f, dateFrom: day(new Date(now.getTime() - 7 * 86400000)), dateTo: day(new Date(now.getTime() - 86400000)) };
  if (rel === "previous_month") {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return { ...f, dateFrom: day(first), dateTo: day(last), month: day(first).slice(0, 7), asOf: day(last) };
  }
  return f;
}

// Filter options loaded once per page so every report form has real choices.
export async function filterOptions(scope: Scope) {
  const ids = scope.branchIds;
  const [branchRows, channels, routes, reps, products, warehouses, outlets, promotions] = await Promise.all([
    prisma.branch.findMany({ where: ids ? { id: { in: ids } } : {}, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.channel.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.route.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { role: "sales_rep", ...(ids ? { branchId: { in: ids } } : {}) }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.product.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, category: true } }),
    prisma.warehouse.findMany({ where: ids ? { branchId: { in: ids } } : {}, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.outlet.findMany({ where: ids ? { branchId: { in: ids } } : {}, orderBy: { name: "asc" }, select: { id: true, name: true, subChannel: true }, take: 400 }),
    prisma.promotion.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, version: true } }),
  ]);
  const pick = (rows: { id: string; name: string }[]) => rows.map((r) => ({ value: r.id, label: r.name }));
  return {
    branch: pick(branchRows),
    channel: pick(channels),
    route: pick(routes),
    rep: pick(reps),
    product: pick(products),
    warehouse: pick(warehouses),
    customer: pick(outlets),
    category: [...new Set(products.map((p) => p.category))].sort().map((c) => ({ value: c, label: c })),
    subchannel: [...new Set(outlets.map((o) => o.subChannel))].sort().map((c) => ({ value: c, label: c })),
    promotion: promotions.map((p) => ({ value: p.id, label: `${p.name} (v${p.version})` })),
  };
}

// Reads the persisted ledger sign convention in one place for reports that need balances directly.
export const ledgerTotal = (entries: Parameters<typeof ledgerDelta>[0][]) => entries.reduce((a, e) => a + ledgerDelta(e), 0);
