import { prisma } from "@/lib/prisma";
import { invoiceBalance, outletBalance } from "@/lib/finance";

export const KA_ACTIVITY_TYPES: Record<string, string> = {
  business_review: "Business review meeting",
  negotiation: "Terms / pricing negotiation",
  promo_check: "Promotion & display execution check",
  executive_visit: "Executive / buyer visit",
  issue_resolution: "Issue resolution (delivery, claims, credit)",
  planning: "Joint business planning",
};

const SALE = ["confirmed", "picked", "invoiced", "delivered", "partially_delivered"];

export interface AccountHealth {
  id: string;
  name: string;
  code: string | null;
  branchId: string;
  creditLimit: number;
  creditStatus: string;
  balance: number;
  overdue: number;
  usedPct: number;
  sales30: number;
  salesPrev30: number;
  lastOrderDays: number | null;
  lastActivityDays: number | null;
  openActions: number;
  overdueActions: number;
  flag: "good" | "watch" | "risk";
  reasons: string[];
}

// Key accounts are the customers in the Key Accounts channel. For each, a one-line health picture.
export async function keyAccountHealth(branchIds: string[] | null): Promise<AccountHealth[]> {
  const channel = await prisma.channel.findFirst({ where: { name: { contains: "Key" } } });
  if (!channel) return [];
  const outlets = await prisma.outlet.findMany({ where: { channelId: channel.id, status: { in: ["active", "blocked"] }, ...(branchIds ? { branchId: { in: branchIds } } : {}) }, orderBy: { name: "asc" } });
  const ids = outlets.map((o) => o.id);
  const now = Date.now();
  const d30 = new Date(now - 30 * 86400000);
  const d60 = new Date(now - 60 * 86400000);
  const [orders, invoices, acts] = await Promise.all([
    prisma.salesOrder.findMany({ where: { outletId: { in: ids }, orderDate: { gte: d60 }, status: { in: SALE } }, select: { outletId: true, total: true, orderDate: true } }),
    prisma.invoice.findMany({ where: { outletId: { in: ids }, status: { in: ["unpaid", "partially_paid", "overdue"] } }, include: { arLedgerEntries: true } }),
    prisma.keyAccountActivity.findMany({ where: { outletId: { in: ids } }, orderBy: { createdAt: "desc" } }),
  ]);
  const lastOrders = await prisma.salesOrder.groupBy({ by: ["outletId"], where: { outletId: { in: ids }, status: { in: SALE } }, _max: { orderDate: true } });
  const out: AccountHealth[] = [];
  for (const o of outlets) {
    const balance = Math.max(0, await outletBalance(o.id));
    let overdue = 0;
    for (const i of invoices.filter((x) => x.outletId === o.id)) {
      const b = invoiceBalance(i);
      if (b > 0 && i.dueDate.getTime() < now) overdue += b;
    }
    const mine = orders.filter((x) => x.outletId === o.id);
    const sales30 = mine.filter((x) => x.orderDate >= d30).reduce((s, x) => s + x.total, 0);
    const salesPrev30 = mine.filter((x) => x.orderDate < d30).reduce((s, x) => s + x.total, 0);
    const last = lastOrders.find((x) => x.outletId === o.id)?._max.orderDate;
    const a = acts.filter((x) => x.outletId === o.id);
    const open = a.filter((x) => x.status === "open" && x.nextAction);
    const usedPct = o.creditLimit > 0 ? Math.round((balance / o.creditLimit) * 100) : 0;
    const reasons: string[] = [];
    if (o.creditStatus !== "active") reasons.push(`credit ${o.creditStatus.replace("_", " ")}`);
    if (overdue > 0) reasons.push("overdue balance");
    if (usedPct >= 90) reasons.push(`${usedPct}% of credit used`);
    const lastOrderDays = last ? Math.floor((now - last.getTime()) / 86400000) : null;
    if (lastOrderDays === null || lastOrderDays > 21) reasons.push("no recent order");
    if (salesPrev30 > 0 && sales30 < salesPrev30 * 0.7) reasons.push("sales down 30%+");
    const lastActivityDays = a[0] ? Math.floor((now - a[0].createdAt.getTime()) / 86400000) : null;
    if (lastActivityDays === null || lastActivityDays > 30) reasons.push("no contact in 30 days");
    const overdueActions = open.filter((x) => x.nextDue && x.nextDue.getTime() < now).length;
    if (overdueActions) reasons.push(`${overdueActions} action(s) overdue`);
    out.push({ id: o.id, name: o.name, code: o.code, branchId: o.branchId, creditLimit: o.creditLimit, creditStatus: o.creditStatus, balance, overdue, usedPct, sales30, salesPrev30, lastOrderDays, lastActivityDays, openActions: open.length, overdueActions, flag: reasons.length >= 3 || o.creditStatus !== "active" ? "risk" : reasons.length ? "watch" : "good", reasons });
  }
  return out;
}
