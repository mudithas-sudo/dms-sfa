import { prisma } from "@/lib/prisma";
import { ageingBounds, bucketIndex, bucketLabels, invoiceBalance } from "@/lib/finance";
import { getAllSettings } from "@/lib/settings";
import type { Scope } from "@/lib/reports";

// Head-office roll-up: every branch side by side for receivables and returns, so the central administrator can see
// where money is overdue and where goods are coming back without opening each branch.

export interface BranchRow {
  id: string;
  name: string;
  outstanding: number;
  overdue: number;
  buckets: number[];
  overdueInvoices: number;
  pendingCheques: number;
  collections: number;
  overLimit: number;
  onHold: number;
  customers: number;
  market: { count: number; value: number; awaitingCredit: number; outsidePolicy: number };
  van: { count: number; units: number; varianceOpen: number };
  central: { count: number; inTransit: number; discrepancies: number; units: number; awaitingApproval: number };
  claimsPending: number;
}

export async function branchRollup(scope: Scope, days = 30) {
  const settings = await getAllSettings();
  const bounds = ageingBounds(settings["ageing.buckets"]);
  const labels = bucketLabels(bounds);
  const from = new Date(Date.now() - days * 86400000);
  const ids = scope.branchIds;
  const branches = await prisma.branch.findMany({ where: ids ? { id: { in: ids } } : {}, orderBy: { name: "asc" } });
  const bid = { in: branches.map((b) => b.id) };

  const [invoices, pays, outlets, market, van, central, claims] = await Promise.all([
    prisma.invoice.findMany({ where: { branchId: bid, status: { in: ["unpaid", "partially_paid", "overdue"] } }, include: { arLedgerEntries: true, outlet: { select: { creditLimit: true } } } }),
    prisma.aRLedgerEntry.findMany({ where: { type: "payment", entryDate: { gte: from }, recStatus: { not: "reversed" }, OR: [{ paymentStatus: null }, { paymentStatus: { notIn: ["pending", "bounced"] } }], outlet: { branchId: bid } }, select: { amount: true, outlet: { select: { branchId: true } } } }),
    prisma.outlet.findMany({ where: { branchId: bid, status: { in: ["active", "blocked"] } }, select: { id: true, branchId: true, creditStatus: true } }),
    prisma.marketReturn.findMany({ where: { createdAt: { gte: from }, outlet: { branchId: bid } }, include: { product: { select: { unitPrice: true } }, outlet: { select: { branchId: true } } } }),
    prisma.vanReturn.findMany({ where: { createdAt: { gte: from }, van: { branchId: bid } }, include: { van: { select: { branchId: true } } } }),
    prisma.supplierReturn.findMany({ where: { createdAt: { gte: from }, warehouse: { branchId: bid } }, include: { warehouse: { select: { branchId: true } } } }),
    prisma.claim.findMany({ where: { status: { in: ["submitted", "under_review", "returned", "settlement_pending"] }, branchId: bid }, select: { branchId: true } }),
  ]);

  const rows: BranchRow[] = branches.map((b) => {
    const inv = invoices.filter((i) => i.branchId === b.id);
    const buckets = labels.map(() => 0);
    let outstanding = 0, overdue = 0, overdueInvoices = 0, pendingCheques = 0;
    const perOutlet = new Map<string, { limit: number; bal: number }>();
    for (const i of inv) {
      const bal = invoiceBalance(i);
      pendingCheques += i.arLedgerEntries.filter((e) => e.type === "payment" && e.paymentStatus === "pending" && e.recStatus !== "reversed").reduce((s, e) => s + e.amount, 0);
      if (bal <= 0) continue;
      outstanding += bal;
      const late = Math.floor((Date.now() - i.dueDate.getTime()) / 86400000);
      buckets[bucketIndex(late, bounds)] += bal;
      if (late > 0) {
        overdue += bal;
        overdueInvoices++;
      }
      const cur = perOutlet.get(i.outletId) ?? { limit: i.outlet.creditLimit, bal: 0 };
      cur.bal += bal;
      perOutlet.set(i.outletId, cur);
    }
    const mine = outlets.filter((o) => o.branchId === b.id);
    const m = market.filter((x) => x.outlet.branchId === b.id);
    const v = van.filter((x) => x.van.branchId === b.id);
    const c = central.filter((x) => x.warehouse.branchId === b.id);
    return {
      id: b.id, name: b.name, outstanding, overdue, buckets, overdueInvoices, pendingCheques,
      collections: pays.filter((p) => p.outlet.branchId === b.id).reduce((s, p) => s + p.amount, 0),
      overLimit: [...perOutlet.values()].filter((o) => o.limit > 0 && o.bal > o.limit).length,
      onHold: mine.filter((o) => ["on_hold", "blocked"].includes(o.creditStatus)).length,
      customers: mine.length,
      market: { count: m.length, value: m.reduce((s, x) => s + x.product.unitPrice * x.qty, 0), awaitingCredit: m.filter((x) => x.status === "pending").length, outsidePolicy: m.filter((x) => x.outsidePolicy).length },
      van: { count: v.length, units: v.reduce((s, x) => s + (x.qtyReceived ?? x.qty), 0), varianceOpen: v.filter((x) => ["variance_pending", "variance_open"].includes(x.status)).length },
      central: { count: c.length, inTransit: c.filter((x) => ["shipped", "in_transit"].includes(x.status)).length, discrepancies: c.filter((x) => !!x.discrepancyNote).length, units: c.reduce((s, x) => s + x.qty, 0), awaitingApproval: c.filter((x) => ["pending", "draft"].includes(x.status)).length },
      claimsPending: claims.filter((x) => x.branchId === b.id).length,
    };
  });
  return { rows, labels, days };
}
