import { prisma } from "@/lib/prisma";

export const CLAIM_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  returned: "Returned for correction",
  approved: "Approved",
  rejected: "Rejected",
  settlement_pending: "Settlement pending",
  settled: "Settled",
  reviewed: "Reviewed",
};

export const CLAIM_DOCUMENTS = ["Signed delivery receipts", "Promotion mechanics sheet", "Invoice copies", "Proof of display / execution"];

export interface QualifyingOrder {
  orderId: string;
  orderNumber: string;
  outletName: string;
  orderDate: Date;
  eligible: number;
  units: number;
}

// Orders that earned a promotion's benefit in a period and have not already been claimed. Eligible value is the
// discount actually given on the lines that were delivered — a partly delivered or voided order counts only for what
// the customer kept.
export async function qualifyingOrders(promotionId: string, branchId: string | null, start: Date, end: Date): Promise<QualifyingOrder[]> {
  const endOfDay = new Date(end);
  endOfDay.setHours(23, 59, 59, 999);
  const orders = await prisma.salesOrder.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      status: { in: ["delivered", "partially_delivered"] },
      orderDate: { gte: start, lte: endOfDay },
      lines: { some: { promotionId, discount: { gt: 0 } } },
    },
    include: { outlet: { select: { name: true } }, lines: { where: { promotionId } } },
    orderBy: { orderDate: "asc" },
  });
  const claimed = await prisma.claimLine.findMany({
    where: { salesOrderId: { in: orders.map((o) => o.id) }, claim: { promotionId, status: { not: "rejected" } } },
    select: { salesOrderId: true },
  });
  const taken = new Set(claimed.map((c) => c.salesOrderId));
  return orders
    .filter((o) => !taken.has(o.id))
    .map((o) => {
      let eligible = 0;
      let units = 0;
      for (const l of o.lines) {
        const kept = l.qtyDelivered ?? l.qty;
        eligible += kept >= l.qty ? l.discount : Math.round((l.discount * kept) / Math.max(1, l.qty));
        units += kept;
      }
      return { orderId: o.id, orderNumber: o.orderNumber, outletName: o.outlet.name, orderDate: o.orderDate, eligible, units };
    })
    .filter((o) => o.eligible > 0);
}
