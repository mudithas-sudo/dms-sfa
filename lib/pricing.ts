import { prisma } from "@/lib/prisma";
import type { Outlet, PricingRule, Product, Promotion } from "@prisma/client";

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
  promoNames?: string[];
  ruleName?: string;
  freeQty?: number;
}

export interface PricingResult {
  outlet: Outlet;
  lines: PricedLine[];
  subtotal: number;
  discountTotal: number;
  total: number;
  hints: Record<string, string>; // productId -> "Add 2 more to receive 1 free"
  orderPromos: { id: string; name: string; amount: number }[];
}

// ---------------------------------------------------------------------------
// Shared pricing & promotion engine — used by SFA orders, DMS backend orders and
// the cart's live preview, so what a rep sees while building an order is exactly
// what gets invoiced. Rule precedence (highest first):
//   1 customer + SKU rule · 2 customer rule · 3 channel + SKU rule · 4 channel rule
//   5 SKU / category rule · 6 base price rule · 7 product list price
// ---------------------------------------------------------------------------

export const PRECEDENCE = [
  "Customer-specific rule for this SKU",
  "Customer rule (all SKUs)",
  "Channel / sub-channel rule for this SKU",
  "Channel / sub-channel rule (all SKUs)",
  "SKU or category rule (all customers)",
  "Base price rule for the SKU",
  "Product list price",
];

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// An outlet reclassified with a future effective date keeps its old channel until then.
export function effectiveChannelId(o: Outlet, now: Date) {
  if (o.channelEffectiveFrom && o.channelEffectiveFrom > now && o.previousChannelId) return o.previousChannelId;
  return o.channelId;
}

function ruleMatchesProduct(r: PricingRule, p: Product) {
  if (r.productId) return r.productId === p.id;
  return !r.scopeCategory || r.scopeCategory === p.category;
}

function ruleIsLive(r: PricingRule, now: Date, branchId: string) {
  return (
    r.status === "active" &&
    r.approvalStatus === "active" &&
    r.startDate <= now &&
    (!r.endDate || r.endDate >= now) &&
    (!r.branchId || r.branchId === branchId)
  );
}

interface RulePick {
  rule: PricingRule | null;
  precedence: number; // index into PRECEDENCE, 0-based; 5 = base rule
  baseRule: PricingRule | null;
}

function pickRule(rules: PricingRule[], product: Product, outlet: Outlet, channelId: string): RulePick {
  const pricing = rules.filter((r) => r.kind === "pricing" && ruleMatchesProduct(r, product));
  const baseRule = pricing.find((r) => r.level === "base" && r.productId === product.id) ?? null;
  const tiers: [number, (r: PricingRule) => boolean][] = [
    [0, (r) => r.level === "customer" && r.outletId === outlet.id && r.productId === product.id],
    [1, (r) => r.level === "customer" && r.outletId === outlet.id && !r.productId],
    [2, (r) => r.level === "channel" && r.channelId === channelId && r.productId === product.id],
    [3, (r) => r.level === "channel" && r.channelId === channelId && !r.productId],
    [4, (r) => r.level === "sku"],
  ];
  for (const [i, test] of tiers) {
    const r = pricing.find(test);
    if (r) return { rule: r, precedence: i, baseRule };
  }
  return { rule: null, precedence: baseRule ? 5 : 6, baseRule };
}

function promoIsLive(p: Promotion, now: Date, branchId: string, channelId: string) {
  if (p.status !== "active" || p.startDate > now || p.endDate < now) return false;
  if (p.channelId && p.channelId !== channelId) return false;
  if (p.branchIds && !p.branchIds.split(",").filter(Boolean).includes(branchId)) return false;
  if (p.daysOfWeek) {
    const day = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][now.getDay()];
    if (!p.daysOfWeek.split(",").includes(day)) return false;
  }
  if (p.maxRedemptions && p.redemptions >= p.maxRedemptions) return false;
  if (p.budget && p.budgetUsed >= p.budget) return false;
  return true;
}

interface LineBenefit {
  promo: Promotion;
  discount: number;
  freeQty: number;
}

// Line-level benefit of one promotion; null when it does not qualify on this line.
function lineBenefit(p: Promotion, product: Product, qty: number, unitPrice: number): LineBenefit | null {
  if (p.productId && p.productId !== product.id) return null;
  const cfg = parseJson<Record<string, unknown>>(p.config, {});
  const gross = unitPrice * qty;
  if (p.type === "bundle" || p.type === "value_based") return null; // order-level types

  if (p.type === "free_good") {
    const min = p.minQty ?? 1;
    if (qty < min) return null;
    const sets = cfg.repeat ? Math.floor(qty / min) : 1;
    const free = Math.min((p.freeQty ?? 0) * sets, qty);
    return { promo: p, discount: unitPrice * free, freeQty: free };
  }
  if (p.type === "qty_slab") {
    const slabs = (cfg.slabs as { minQty: number; discountPct?: number; freeQty?: number }[] | undefined) ?? [];
    const tier = [...slabs].sort((a, b) => b.minQty - a.minQty).find((s) => qty >= s.minQty);
    if (!tier) return null;
    const free = Math.min(tier.freeQty ?? 0, qty);
    let disc = Math.round(gross * ((tier.discountPct ?? 0) / 100)) + unitPrice * free;
    if (p.maxDiscountCap) disc = Math.min(disc, p.maxDiscountCap);
    return { promo: p, discount: disc, freeQty: free };
  }
  // volume_discount | price_off | rebate | discount_percent
  if (p.minQty && qty < p.minQty) return null;
  let disc = Math.round(gross * (p.discountValue / 100));
  if (p.maxDiscountCap) disc = Math.min(disc, p.maxDiscountCap);
  return { promo: p, discount: disc, freeQty: 0 };
}

function combines(p: Promotion) {
  return p.stacking === "with_promotions" || p.stacking === "both";
}

export async function priceOrder(outletId: string, items: OrderItem[]): Promise<PricingResult> {
  const outlet = await prisma.outlet.findUniqueOrThrow({ where: { id: outletId } });
  const products = await prisma.product.findMany({ where: { id: { in: items.map((i) => i.productId) } } });
  const now = new Date();
  const channelId = effectiveChannelId(outlet, now);

  const [allPromos, allRules] = await Promise.all([
    prisma.promotion.findMany({ where: { status: "active", startDate: { lte: now }, endDate: { gte: now } } }),
    prisma.pricingRule.findMany({
      where: {
        status: "active",
        approvalStatus: "active",
        startDate: { lte: now },
        OR: [{ endDate: null }, { endDate: { gte: now } }],
      },
    }),
  ]);
  const promos = allPromos.filter((p) => promoIsLive(p, now, outlet.branchId, channelId)).sort((a, b) => b.priority - a.priority);
  const rules = allRules.filter((r) => ruleIsLive(r, now, outlet.branchId));
  const fixedDiscounts = rules.filter((r) => r.kind === "fixed_discount" && r.outletId === outlet.id);

  let subtotal = 0;
  const lines: PricedLine[] = [];
  const hints: Record<string, string> = {};

  for (const item of items) {
    const product = products.find((p) => p.id === item.productId);
    if (!product || item.qty <= 0) continue;

    const pick = pickRule(rules, product, outlet, channelId);
    let unitPrice = pick.baseRule ? pick.baseRule.value : product.unitPrice;
    if (pick.rule?.priceType === "fixed_price") unitPrice = pick.rule.value;
    const ruleDiscount = pick.rule?.priceType === "discount_percent" ? Math.round(unitPrice * item.qty * (pick.rule.value / 100)) : 0;

    // Promotions: highest priority first; later ones apply only when both opt in to stacking.
    const benefits = promos.map((p) => lineBenefit(p, product, item.qty, unitPrice)).filter((b): b is LineBenefit => !!b);
    const applied: LineBenefit[] = [];
    for (const b of benefits) {
      if (applied.length === 0) applied.push(b);
      else if (combines(applied[0].promo) && combines(b.promo)) applied.push(b);
    }
    let promoDiscount = applied.reduce((s, b) => s + b.discount, 0);
    const freeQty = applied.reduce((s, b) => s + b.freeQty, 0);

    // Standing customer discount: combines with a promotion only when the promotion's stacking rule allows it;
    // otherwise the larger of the two benefits applies.
    const fixed = fixedDiscounts.find((r) => ruleMatchesProduct(r, product));
    let fixedDiscount = fixed ? Math.round((unitPrice * item.qty - ruleDiscount) * (fixed.value / 100)) : 0;
    if (fixedDiscount && promoDiscount) {
      const allowed = applied.every((b) => b.promo.stacking === "with_fixed_discount" || b.promo.stacking === "both");
      if (!allowed) {
        if (fixedDiscount >= promoDiscount) promoDiscount = 0;
        else fixedDiscount = 0;
      }
    }

    const discount = Math.min(unitPrice * item.qty, ruleDiscount + promoDiscount + fixedDiscount);
    subtotal += unitPrice * item.qty;
    lines.push({
      productId: product.id,
      qty: item.qty,
      unitPrice,
      discount,
      lineTotal: unitPrice * item.qty - discount,
      promotionId: promoDiscount > 0 ? applied[0]?.promo.id : undefined,
      promoNames: [...applied.filter(() => promoDiscount > 0).map((b) => b.promo.name), ...(fixedDiscount ? [`Standing ${fixed!.value}% discount`] : [])],
      ruleName: pick.rule?.name ?? pick.baseRule?.name,
      freeQty: promoDiscount > 0 ? freeQty : 0,
    });

    // Hint: the nearest threshold not yet reached.
    const near = promos
      .filter((p) => (!p.productId || p.productId === product.id) && p.minQty && item.qty < p.minQty && p.type !== "bundle" && p.type !== "value_based")
      .sort((a, b) => (a.minQty ?? 0) - (b.minQty ?? 0))[0];
    if (near?.minQty) {
      hints[product.id] = `Add ${near.minQty - item.qty} more to get ${near.type === "free_good" ? `${near.freeQty ?? 1} free` : `${near.discountValue}% off`} (${near.name})`;
    }
  }

  // Order-level promotions: bundles and value-based offers.
  const orderPromos: PricingResult["orderPromos"] = [];
  const gross = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  for (const p of promos) {
    if (p.type !== "bundle" && p.type !== "value_based") continue;
    const cfg = parseJson<Record<string, unknown>>(p.config, {});
    let amount = 0;
    if (p.type === "bundle") {
      const bundle = (cfg.items as { productId: string; qty: number }[] | undefined) ?? [];
      if (bundle.length === 0) continue;
      const sets = Math.min(...bundle.map((b) => Math.floor((lines.find((l) => l.productId === b.productId)?.qty ?? 0) / b.qty)));
      const bundles = Math.min(sets, Number(cfg.maxBundles ?? 99));
      if (bundles <= 0) continue;
      const regular = bundle.reduce((s, b) => s + (lines.find((l) => l.productId === b.productId)?.unitPrice ?? 0) * b.qty, 0);
      const bundleCost = cfg.bundlePrice ? Number(cfg.bundlePrice) : regular * (1 - Number(cfg.bundleDiscountPct ?? p.discountValue) / 100);
      amount = Math.max(0, Math.round((regular - bundleCost) * bundles));
    } else {
      const minValue = p.minOrderValue ?? 0;
      if (gross < minValue) continue;
      amount = cfg.valueOff ? Number(cfg.valueOff) : Math.round(gross * (Number(cfg.valueOffPct ?? p.discountValue) / 100));
    }
    if (p.maxDiscountCap) amount = Math.min(amount, p.maxDiscountCap);
    if (p.budget && p.budgetUsed + amount > p.budget) continue;
    if (amount <= 0) continue;
    if (orderPromos.length > 0 && !(combines(p) && orderPromos.every((o) => combines(promos.find((x) => x.id === o.id)!)))) continue;
    orderPromos.push({ id: p.id, name: p.name, amount });
  }
  const orderPromoTotal = orderPromos.reduce((s, o) => s + o.amount, 0);
  if (orderPromoTotal > 0 && gross > 0) {
    // spread across lines in proportion to their gross value so each invoice line stays explainable
    let remaining = orderPromoTotal;
    lines.forEach((l, i) => {
      const share = i === lines.length - 1 ? remaining : Math.round((orderPromoTotal * l.unitPrice * l.qty) / gross);
      remaining -= share;
      l.discount = Math.min(l.unitPrice * l.qty, l.discount + share);
      l.lineTotal = l.unitPrice * l.qty - l.discount;
      l.promotionId = l.promotionId ?? orderPromos[0].id;
      l.promoNames = [...(l.promoNames ?? []), ...orderPromos.map((o) => o.name)];
    });
  }

  const discountTotal = lines.reduce((s, l) => s + l.discount, 0);
  return { outlet, lines, subtotal, discountTotal, total: subtotal - discountTotal, hints, orderPromos };
}

// Count a confirmed order against each promotion's redemption limit and budget.
export async function recordPromoUsage(lines: PricedLine[], orderPromos: PricingResult["orderPromos"] = []) {
  const usage = new Map<string, { redemptions: number; amount: number }>();
  for (const l of lines) {
    if (!l.promotionId || l.discount <= 0) continue;
    const u = usage.get(l.promotionId) ?? { redemptions: 0, amount: 0 };
    u.redemptions += 1;
    u.amount += l.discount;
    usage.set(l.promotionId, u);
  }
  for (const o of orderPromos) usage.set(o.id, { redemptions: 1, amount: o.amount });
  for (const [id, u] of usage) {
    await prisma.promotion.update({ where: { id }, data: { redemptions: { increment: u.redemptions }, budgetUsed: { increment: u.amount } } });
  }
}

// "Price check": the unit price for one SKU and customer, and the rule that decided it.
export async function explainPrice(outletId: string, productId: string) {
  const outlet = await prisma.outlet.findUniqueOrThrow({ where: { id: outletId } });
  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  const now = new Date();
  const channelId = effectiveChannelId(outlet, now);
  const rules = (await prisma.pricingRule.findMany({ where: { status: "active", approvalStatus: "active" } })).filter((r) => ruleIsLive(r, now, outlet.branchId));
  const pick = pickRule(rules, product, outlet, channelId);
  let unitPrice = pick.baseRule ? pick.baseRule.value : product.unitPrice;
  let note = "No pricing rule applies — the product list price is used.";
  if (pick.rule) {
    if (pick.rule.priceType === "fixed_price") {
      unitPrice = pick.rule.value;
      note = `"${pick.rule.name}" sets a fixed price.`;
    } else {
      note = `"${pick.rule.name}" gives ${pick.rule.value}% off the base price.`;
    }
  } else if (pick.baseRule) {
    note = `Base price rule "${pick.baseRule.name}".`;
  }
  const netPrice = pick.rule?.priceType === "discount_percent" ? unitPrice * (1 - pick.rule.value / 100) : unitPrice;
  return { outlet, product, listPrice: product.unitPrice, basePrice: pick.baseRule?.value ?? product.unitPrice, unitPrice, netPrice, precedence: PRECEDENCE[pick.precedence], note };
}
