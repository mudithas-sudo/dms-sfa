import { prisma } from "@/lib/prisma";

export interface OrderItem {
  productId: string;
  qty: number;
}

export interface PricedLine {
  productId: string;
  qty: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  promotionId?: string;
}

// The single pricing/promotion engine shared by SFA orders, DMS backend
// orders and the cart's live preview, so what a rep sees while building an
// order is exactly what gets invoiced.
export async function priceOrder(outletId: string, items: OrderItem[]) {
  const outlet = await prisma.outlet.findUniqueOrThrow({ where: { id: outletId } });
  const products = await prisma.product.findMany({ where: { id: { in: items.map((i) => i.productId) } } });
  const now = new Date();

  const [activePromos, pricingRules] = await Promise.all([
    prisma.promotion.findMany({ where: { status: "active", startDate: { lte: now }, endDate: { gte: now } } }),
    // Channel- and customer-level rules, effective-dated — a rule whose
    // startDate is in the future never applies to today's order.
    prisma.pricingRule.findMany({
      where: {
        status: "active",
        startDate: { lte: now },
        AND: [
          { OR: [{ endDate: null }, { endDate: { gte: now } }] },
          { OR: [{ outletId }, { channelId: outlet.channelId }] },
        ],
      },
    }),
  ]);

  let subtotal = 0;
  let discountTotal = 0;
  const lines: PricedLine[] = [];

  for (const item of items) {
    const product = products.find((p) => p.id === item.productId);
    if (!product || item.qty <= 0) continue;

    // A promo's productId/channelId are each optional — null means "any" —
    // so it can target a product, a whole channel, or both. minQty is the
    // structured eligibility condition (e.g. "Qty >= 10").
    const promo = activePromos.find((p) => {
      const productMatches = !p.productId || p.productId === product.id;
      const channelMatches = !p.channelId || p.channelId === outlet.channelId;
      const qtyMatches = !p.minQty || item.qty >= p.minQty;
      return productMatches && channelMatches && qtyMatches;
    });

    // Customer-level pricing rule takes priority over channel-level.
    const customerRule = pricingRules.find((r) => r.level === "customer" && r.outletId === outletId && (!r.productId || r.productId === product.id));
    const channelRule = pricingRules.find((r) => r.level === "channel" && r.channelId === outlet.channelId && (!r.productId || r.productId === product.id));
    const pricingRule = customerRule ?? channelRule;

    let unitPrice = product.unitPrice;
    if (pricingRule?.priceType === "fixed_price") unitPrice = pricingRule.value;

    const promoDiscount = promo
      ? promo.type === "free_good"
        ? unitPrice * Math.min(promo.freeQty ?? 0, item.qty)
        : Math.round(unitPrice * item.qty * (promo.discountValue / 100))
      : 0;
    const ruleDiscount = pricingRule?.priceType === "discount_percent" ? Math.round(unitPrice * item.qty * (pricingRule.value / 100)) : 0;
    const discount = promoDiscount + ruleDiscount;

    subtotal += unitPrice * item.qty;
    discountTotal += discount;
    lines.push({
      productId: product.id,
      qty: item.qty,
      unitPrice,
      discount,
      lineTotal: unitPrice * item.qty - discount,
      promotionId: promo?.id,
    });
  }

  return { outlet, lines, subtotal, discountTotal, total: subtotal - discountTotal };
}
