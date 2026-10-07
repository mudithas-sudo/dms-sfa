import { prisma } from "@/lib/prisma";
import { invoiceBalance } from "@/lib/finance";
import { branchRollup, type BranchRow } from "@/lib/network";
import { typeLabel } from "@/lib/approval-types";
import { getAllSettings } from "@/lib/settings";
import type { Scope } from "@/lib/reports";

// Head-office control tower: everything the central administrator needs to see about every distribution branch in one
// place — sales against target, receivables, returns, stock, claims, approvals waiting for head office and the
// exceptions that need someone to act.

const SALE = ["confirmed", "picked", "invoiced", "delivered", "partially_delivered"];
const DAY = 86400000;

export interface BranchCard extends BranchRow {
  sales: number;
  salesPrev: number;
  target: number;
  salesMtd: number;
  stockValue: number;
  nearExpiryLots: number;
  expiredUnits: number;
  claimsValue: number;
  einvoicePending: number;
  einvoiceRejected: number;
  poExceptions: number;
  approvalsPending: number;
}

export interface AttentionItem {
  tone: "red" | "amber" | "blue";
  title: string;
  detail: string;
  count: number;
  href: string;
}

export async function headOfficeCards(scope: Scope, days = 30) {
  const base = await branchRollup(scope, days);
  const ids = base.rows.map((r) => r.id);
  const bid = { in: ids };
  const now = Date.now();
  const from = new Date(now - days * DAY);
  const prevFrom = new Date(now - 2 * days * DAY);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const month = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}`;
  const nearLimit = new Date(now + 60 * DAY);

  const [orders, targets, users, stock, claims, einv, pos, approvals] = await Promise.all([
    prisma.salesOrder.findMany({ where: { branchId: bid, status: { in: SALE }, orderDate: { gte: prevFrom } }, select: { branchId: true, total: true, orderDate: true } }),
    prisma.target.findMany({ where: { metric: "sales_value", period: month } }),
    prisma.user.findMany({ where: { branchId: bid }, select: { id: true, branchId: true } }),
    prisma.stockBalance.findMany({ where: { locationType: "warehouse", warehouse: { branchId: bid } }, select: { qtyGood: true, qtyExpired: true, expiryDate: true, product: { select: { unitPrice: true } }, warehouse: { select: { branchId: true } } } }),
    prisma.claim.findMany({ where: { branchId: bid, status: { in: ["submitted", "under_review", "returned", "settlement_pending"] } }, select: { branchId: true, amount: true } }),
    prisma.invoice.groupBy({ by: ["branchId", "einvoiceStatus"], where: { branchId: bid, status: { not: "voided" }, einvoiceStatus: { in: ["not_sent", "rejected"] } }, _count: true }),
    prisma.purchaseOrder.groupBy({ by: ["branchId"], where: { branchId: bid, status: "exception" }, _count: true }),
    prisma.approvalRequest.groupBy({ by: ["branchId"], where: { branchId: bid, status: "pending" }, _count: true }),
  ]);

  const userBranch = new Map(users.map((u) => [u.id, u.branchId]));
  const cards: BranchCard[] = base.rows.map((r) => {
    const mine = orders.filter((o) => o.branchId === r.id);
    const st = stock.filter((s) => s.warehouse?.branchId === r.id);
    return {
      ...r,
      sales: mine.filter((o) => o.orderDate >= from).reduce((s, o) => s + o.total, 0),
      salesPrev: mine.filter((o) => o.orderDate < from).reduce((s, o) => s + o.total, 0),
      salesMtd: mine.filter((o) => o.orderDate >= monthStart).reduce((s, o) => s + o.total, 0),
      target: targets.filter((t) => t.branchId === r.id || (t.userId && userBranch.get(t.userId) === r.id)).reduce((s, t) => s + t.targetValue, 0),
      stockValue: st.reduce((s, x) => s + x.qtyGood * x.product.unitPrice, 0),
      nearExpiryLots: st.filter((x) => x.qtyGood > 0 && x.expiryDate && x.expiryDate <= nearLimit).length,
      expiredUnits: st.reduce((s, x) => s + x.qtyExpired, 0),
      claimsValue: claims.filter((c) => c.branchId === r.id).reduce((s, c) => s + c.amount, 0),
      einvoicePending: einv.filter((e) => e.branchId === r.id && e.einvoiceStatus === "not_sent").reduce((s, e) => s + e._count, 0),
      einvoiceRejected: einv.filter((e) => e.branchId === r.id && e.einvoiceStatus === "rejected").reduce((s, e) => s + e._count, 0),
      poExceptions: pos.find((p) => p.branchId === r.id)?._count ?? 0,
      approvalsPending: approvals.find((a) => a.branchId === r.id)?._count ?? 0,
    };
  });
  return { cards, labels: base.labels, days };
}

export async function topOverdueCustomers(scope: Scope, limit = 10, branchId?: string) {
  const ids = branchId ? [branchId] : scope.branchIds;
  const invoices = await prisma.invoice.findMany({
    where: { ...(ids ? { branchId: { in: ids } } : {}), status: { in: ["unpaid", "partially_paid", "overdue"] }, dueDate: { lt: new Date() } },
    include: { arLedgerEntries: true, outlet: { select: { id: true, name: true, code: true, creditStatus: true, branch: { select: { id: true, name: true } } } } },
  });
  const byOutlet = new Map<string, { outlet: (typeof invoices)[number]["outlet"]; overdue: number; invoices: number; oldest: number }>();
  for (const i of invoices) {
    const bal = invoiceBalance(i);
    if (bal <= 0) continue;
    const late = Math.floor((Date.now() - i.dueDate.getTime()) / DAY);
    const cur = byOutlet.get(i.outletId) ?? { outlet: i.outlet, overdue: 0, invoices: 0, oldest: 0 };
    cur.overdue += bal;
    cur.invoices++;
    cur.oldest = Math.max(cur.oldest, late);
    byOutlet.set(i.outletId, cur);
  }
  return [...byOutlet.values()].sort((a, b) => b.overdue - a.overdue).slice(0, limit);
}

// What the central administrator has to act on or chase, network-wide.
export async function networkAttention(scope: Scope, base: { admin: string; supervisor?: string }): Promise<AttentionItem[]> {
  const ids = scope.branchIds;
  const b = ids ? { branchId: { in: ids } } : {};
  const settings = await getAllSettings();
  const hoTypes = (settings["approval.headOfficeTypes"] ?? "").split(",").filter(Boolean);
  const [hoApprovals, creditHolds, marketAwaiting, outside, centralAwaiting, centralDisc, vanVar, rejected, errors, poExc, claimsOpen, lowStock, changeReq] = await Promise.all([
    prisma.approvalRequest.findMany({ where: { status: "pending", ...b }, select: { type: true, amount: true, level: true, reason: true } }),
    prisma.outlet.count({ where: { ...b, status: { in: ["active", "blocked"] }, creditStatus: { in: ["on_hold", "blocked"] } } }),
    prisma.marketReturn.count({ where: { status: "pending", outlet: ids ? { branchId: { in: ids } } : undefined } }),
    prisma.marketReturn.count({ where: { outsidePolicy: true, status: "pending", outlet: ids ? { branchId: { in: ids } } : undefined } }),
    prisma.supplierReturn.count({ where: { status: { in: ["pending", "draft"] }, warehouse: ids ? { branchId: { in: ids } } : undefined } }),
    prisma.supplierReturn.count({ where: { discrepancyNote: { not: null }, warehouse: ids ? { branchId: { in: ids } } : undefined } }),
    prisma.vanReturn.count({ where: { status: { in: ["variance_pending", "variance_open"] }, van: ids ? { branchId: { in: ids } } : undefined } }),
    prisma.invoice.count({ where: { ...b, einvoiceStatus: "rejected" } }),
    prisma.integrationMessage.count({ where: { status: "error" } }),
    prisma.purchaseOrder.count({ where: { ...b, status: "exception" } }),
    prisma.claim.count({ where: { ...b, status: { in: ["submitted", "under_review", "returned", "settlement_pending"] } } }),
    prisma.stockBalance.count({ where: { locationType: "warehouse", qtyExpired: { gt: 0 }, warehouse: ids ? { branchId: { in: ids } } : undefined } }),
    prisma.customerChangeRequest.count({ where: { status: "pending", ...(ids ? { outlet: { branchId: { in: ids } } } : {}) } }),
  ]);
  // Write-offs and anything above a supervisor limit are flagged for head office in the request itself.
  const ho = hoApprovals.filter((a) => hoTypes.includes(a.type) || /head office/i.test(a.reason));
  const hoByType = new Map<string, number>();
  for (const a of ho) hoByType.set(typeLabel(a.type), (hoByType.get(typeLabel(a.type)) ?? 0) + 1);
  const items: AttentionItem[] = [];
  const push = (it: AttentionItem) => it.count > 0 && items.push(it);
  push({ tone: "red", title: "Approvals waiting for head office", detail: [...hoByType.entries()].map(([k, v]) => `${v} × ${k}`).join(" · ") || "—", count: ho.length, href: `${base.supervisor ?? base.admin}/approvals` });
  push({ tone: "red", title: "Customers on credit hold or blocked", detail: "Orders for these customers are stopped until payment or an exception", count: creditHolds, href: `${base.admin}/reports/credit-exposure?run=1` });
  push({ tone: "amber", title: "Market returns awaiting a credit note", detail: `${outside} of them are outside the return policy`, count: marketAwaiting, href: `${base.admin}/reports/returns-register?run=1` });
  push({ tone: "amber", title: "Central-warehouse returns awaiting approval", detail: "Bad or expired stock a branch wants to send back to Company F and B", count: centralAwaiting, href: `${base.admin}/reports/returns-register?run=1` });
  push({ tone: "red", title: "Central-warehouse return discrepancies", detail: "Quantity received differs from quantity shipped", count: centralDisc, href: `${base.admin}/reports/returns-register?run=1` });
  push({ tone: "amber", title: "Van returns with open variance", detail: "Stock count differs on return to the branch warehouse", count: vanVar, href: `${base.admin}/reports/van-inventory?run=1` });
  push({ tone: "amber", title: "Promotion claims in progress", detail: "Submitted, under review, returned or awaiting settlement", count: claimsOpen, href: `${base.admin}/reports/claims-register?run=1` });
  push({ tone: "amber", title: "Customer change requests pending", detail: "Master-data changes raised from the field", count: changeReq, href: `${base.supervisor ?? base.admin}/change-requests` });
  push({ tone: "amber", title: "Purchase orders in the exception queue", detail: "ERP orders that could not be matched or received", count: poExc, href: `${base.admin}/reports/po-variance?run=1` });
  push({ tone: "red", title: "E-invoices rejected by the tax platform", detail: "Fix the customer TIN or data and resend", count: rejected, href: `${base.supervisor ?? base.admin}/einvoicing` });
  push({ tone: "red", title: "Integration messages in the error queue", detail: "Failed ERP / merchandising / e-invoice exchanges waiting for resend", count: errors, href: "/admin/integrations" });
  push({ tone: "amber", title: "Warehouse lots holding expired stock", detail: "Expired units are excluded from sale — return or write them off", count: lowStock, href: `${base.admin}/reports/near-expiry?run=1` });
  const rank = { red: 0, amber: 1, blue: 2 };
  return items.sort((a, b2) => rank[a.tone] - rank[b2.tone] || b2.count - a.count);
}

// One branch in depth — the page the central administrator opens from the branch comparison.
export async function branchDetail(branchId: string, days = 30) {
  const scope: Scope = { branchIds: [branchId], role: "admin", userName: "Head office" };
  const [{ cards, labels }, top] = await Promise.all([headOfficeCards(scope, days), topOverdueCustomers(scope, 10, branchId)]);
  const from = new Date(Date.now() - days * DAY);
  const [branch, market, central, van, claims, collections, creditNotes, lots, reps, approvals] = await Promise.all([
    prisma.branch.findUnique({ where: { id: branchId } }),
    prisma.marketReturn.findMany({ where: { createdAt: { gte: from }, outlet: { branchId } }, include: { product: true, outlet: true, creditNote: true }, orderBy: { createdAt: "desc" }, take: 15 }),
    prisma.supplierReturn.findMany({ where: { createdAt: { gte: from }, warehouse: { branchId } }, include: { product: true }, orderBy: { createdAt: "desc" }, take: 15 }),
    prisma.vanReturn.findMany({ where: { createdAt: { gte: from }, van: { branchId } }, include: { product: true, van: true }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.claim.findMany({ where: { branchId, status: { in: ["submitted", "under_review", "returned", "settlement_pending"] } }, include: { promotion: true }, orderBy: { submittedAt: "desc" }, take: 10 }),
    prisma.aRLedgerEntry.findMany({ where: { type: "payment", entryDate: { gte: from }, recStatus: { not: "reversed" }, outlet: { branchId } }, select: { amount: true, method: true, paymentStatus: true } }),
    prisma.creditNote.findMany({ where: { issuedAt: { gte: from }, outlet: { branchId } }, select: { amount: true, status: true } }),
    prisma.stockBalance.findMany({ where: { locationType: "warehouse", warehouse: { branchId }, OR: [{ qtyExpired: { gt: 0 } }, { qtyGood: { gt: 0 }, expiryDate: { lte: new Date(Date.now() + 60 * DAY) } }] }, include: { product: true }, orderBy: { expiryDate: "asc" }, take: 10 }),
    prisma.user.count({ where: { branchId, role: "sales_rep" } }),
    prisma.approvalRequest.findMany({ where: { branchId, status: "pending" }, orderBy: { createdAt: "asc" }, take: 8 }),
  ]);
  const modes = new Map<string, number>();
  for (const c of collections) {
    if (c.paymentStatus === "bounced") continue;
    modes.set(c.method ?? "other", (modes.get(c.method ?? "other") ?? 0) + c.amount);
  }
  return { branch, card: cards[0], labels, top, market, central, van, claims, collections: [...modes.entries()], creditNotes, lots, reps, approvals, days };
}

// ---------------------------------------------------------------------------------------------------------------
// Dedicated head-office screens: receivables from every branch, and every return record across branches.
// ---------------------------------------------------------------------------------------------------------------

export async function receivablesView(scope: Scope, branchId: string | undefined, days: number) {
  const narrowed: Scope = branchId ? { ...scope, branchIds: [branchId] } : scope;
  const base = await branchRollup(narrowed, days);
  const ids = narrowed.branchIds;
  const invoices = await prisma.invoice.findMany({
    where: { ...(ids ? { branchId: { in: ids } } : {}), status: { in: ["unpaid", "partially_paid", "overdue"] } },
    include: { arLedgerEntries: true, outlet: { select: { id: true, name: true, code: true, creditLimit: true, creditStatus: true, paymentTerms: true, branch: { select: { id: true, name: true } } } } },
  });
  const perOutlet = new Map<string, { outlet: (typeof invoices)[number]["outlet"]; balance: number; overdue: number; invoices: number; oldest: number; nextDue: Date | null }>();
  const now = Date.now();
  for (const i of invoices) {
    const bal = invoiceBalance(i);
    if (bal <= 0) continue;
    const cur = perOutlet.get(i.outletId) ?? { outlet: i.outlet, balance: 0, overdue: 0, invoices: 0, oldest: 0, nextDue: null };
    cur.balance += bal;
    cur.invoices++;
    const late = Math.floor((now - i.dueDate.getTime()) / DAY);
    if (late > 0) {
      cur.overdue += bal;
      cur.oldest = Math.max(cur.oldest, late);
    } else if (!cur.nextDue || i.dueDate < cur.nextDue) cur.nextDue = i.dueDate;
    perOutlet.set(i.outletId, cur);
  }
  const customers = [...perOutlet.values()];
  return {
    ...base,
    topBalances: [...customers].sort((a, b) => b.balance - a.balance).slice(0, 15),
    overdueCustomers: customers.filter((c) => c.overdue > 0).sort((a, b) => b.overdue - a.overdue).slice(0, 25),
    overLimit: customers.filter((c) => c.outlet.creditLimit > 0 && c.balance > c.outlet.creditLimit).sort((a, b) => b.balance - b.outlet.creditLimit - (a.balance - a.outlet.creditLimit)),
    customerCount: customers.length,
  };
}

export async function returnsView(scope: Scope, branchId: string | undefined, days: number) {
  const narrowed: Scope = branchId ? { ...scope, branchIds: [branchId] } : scope;
  const ids = narrowed.branchIds;
  const from = new Date(Date.now() - days * DAY);
  const [rollup, market, central, van] = await Promise.all([
    branchRollup(narrowed, days),
    prisma.marketReturn.findMany({ where: { createdAt: { gte: from }, outlet: ids ? { branchId: { in: ids } } : undefined }, include: { product: true, outlet: { include: { branch: true } }, creditNote: true }, orderBy: { createdAt: "desc" }, take: 300 }),
    prisma.supplierReturn.findMany({ where: { createdAt: { gte: from }, warehouse: ids ? { branchId: { in: ids } } : undefined }, include: { product: true, warehouse: { include: { branch: true } } }, orderBy: { createdAt: "desc" }, take: 300 }),
    prisma.vanReturn.findMany({ where: { createdAt: { gte: from }, van: ids ? { branchId: { in: ids } } : undefined }, include: { product: true, van: { include: { branch: true } } }, orderBy: { createdAt: "desc" }, take: 300 }),
  ]);
  return { rows: rollup.rows, market, central, van, days };
}
