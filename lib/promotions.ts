import type { Promotion } from "@prisma/client";

export const PROMO_TYPES: { id: string; label: string; help: string }[] = [
  { id: "volume_discount", label: "Volume discount (% off)", help: "Percentage off the line when the quantity reaches the minimum." },
  { id: "free_good", label: "Free goods (buy X get Y)", help: "Free units of the same product when the minimum quantity is bought; optionally repeating." },
  { id: "qty_slab", label: "Quantity slab", help: "Tiers: the more bought, the bigger the % off or free units." },
  { id: "bundle", label: "Bundle", help: "A set of products sold together at a bundle price or % off." },
  { id: "value_based", label: "Order-value based", help: "Value or % off the whole order once it reaches a minimum value." },
  { id: "price_off", label: "Price-off (% off)", help: "Straight % off, no minimum unless stated." },
  { id: "rebate", label: "Rebate (% back)", help: "Percentage given back, applied like a discount on the invoice." },
];

export const STACKING: { id: string; label: string }[] = [
  { id: "none", label: "Does not combine with anything else" },
  { id: "with_promotions", label: "Combines with other promotions" },
  { id: "with_fixed_discount", label: "Combines with the customer's standing discount" },
  { id: "both", label: "Combines with promotions and standing discounts" },
];

export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export const PROMO_STATUS_FLOW = "Draft → Approved → Active ⇄ Suspended → Expired";

export function promoTypeLabel(type: string) {
  return PROMO_TYPES.find((t) => t.id === type)?.label ?? type.replace(/_/g, " ");
}

export interface PromoConfig {
  repeat?: boolean;
  slabs?: { minQty: number; discountPct?: number; freeQty?: number }[];
  items?: { productId: string; qty: number }[];
  bundlePrice?: number;
  bundleDiscountPct?: number;
  maxBundles?: number;
  valueOff?: number;
  valueOffPct?: number;
}

export function parseConfig(raw: string | null | undefined): PromoConfig {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as PromoConfig;
  } catch {
    return {};
  }
}

// One-line benefit summary for lists and receipts.
export function promoSummary(p: Promotion, productName: (id: string) => string = (id) => id): string {
  const cfg = parseConfig(p.config);
  switch (p.type) {
    case "free_good":
      return `Buy ${p.minQty ?? 1}, get ${p.freeQty ?? 0} free${cfg.repeat ? " (repeating)" : ""}`;
    case "qty_slab":
      return (cfg.slabs ?? []).map((s) => `${s.minQty}+ → ${s.discountPct ? `${s.discountPct}% off` : ""}${s.freeQty ? `${s.discountPct ? " + " : ""}${s.freeQty} free` : ""}`).join(" · ") || "Slabs not set";
    case "bundle":
      return `${(cfg.items ?? []).map((i) => `${i.qty}× ${productName(i.productId)}`).join(" + ")} → ${cfg.bundlePrice ? `₱${cfg.bundlePrice} per bundle` : `${cfg.bundleDiscountPct ?? p.discountValue}% off`}`;
    case "value_based":
      return `Order ≥ ₱${(p.minOrderValue ?? 0).toLocaleString()} → ${cfg.valueOff ? `₱${cfg.valueOff} off` : `${cfg.valueOffPct ?? p.discountValue}% off`}`;
    default:
      return `${p.discountValue}% off${p.minQty ? ` from ${p.minQty} units` : ""}`;
  }
}
