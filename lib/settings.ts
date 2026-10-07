import { prisma } from "@/lib/prisma";

// Administrator-maintained configuration (thresholds, modes, policies). Every key has a
// default so the platform works before anything is configured; values saved on the
// Settings screen override the defaults without a software release.

export interface SettingDef {
  key: string;
  label: string;
  group: string;
  help?: string;
  type: "number" | "text" | "select";
  options?: string[];
  default: string;
}

export const SETTING_DEFS: SettingDef[] = [
  // Inventory
  { key: "fefo.mode", group: "Inventory", label: "FEFO allocation mode", type: "select", options: ["suggest", "enforce"], default: "suggest", help: "Suggest: FEFO lots are proposed and warehouse staff may change them with a reason. Enforce: only FEFO lots can be picked." },
  { key: "fefo.minShelfLifeDays", group: "Inventory", label: "Minimum remaining shelf life for allocation (days)", type: "number", default: "0", help: "Lots below this are skipped when allocating." },
  { key: "nearExpiry.warningDays", group: "Inventory", label: "Near-expiry: Warning band (days to expiry)", type: "number", default: "60" },
  { key: "nearExpiry.criticalDays", group: "Inventory", label: "Near-expiry: Critical band (days to expiry)", type: "number", default: "30" },
  { key: "nearExpiry.overrides", group: "Inventory", label: "Near-expiry overrides per category (JSON)", type: "text", default: "{\"Beverages\":{\"warning\":45,\"critical\":20}}", help: "Short-life categories can warn earlier, e.g. {\"Dairy\":{\"warning\":30,\"critical\":14}}." },
  { key: "expiry.autoMove", group: "Inventory", label: "Lots past expiry", type: "select", options: ["confirm", "auto"], default: "confirm", help: "Confirm: the warehouse confirms the move to Expired stock. Auto: it happens automatically." },
  { key: "count.tolerancePct", group: "Inventory", label: "Stock count tolerance (% of system quantity)", type: "number", default: "2" },
  { key: "gr.tolerancePct", group: "Inventory", label: "Goods receipt variance tolerance (%)", type: "number", default: "5", help: "Receipts beyond this are held for supervisor review before posting." },
  { key: "adjust.supervisorMaxValue", group: "Inventory", label: "Stock adjustment: warehouse supervisor limit (₱)", type: "number", default: "5000" },
  { key: "adjust.managerMaxValue", group: "Inventory", label: "Stock adjustment: branch manager limit (₱)", type: "number", default: "25000", help: "Above this, a head office inventory controller must approve." },
  { key: "transfer.managerMaxValue", group: "Inventory", label: "Stock transfer: branch manager limit (₱)", type: "number", default: "50000" },
  { key: "dashboard.refreshMinutes", group: "Governance", label: "Dashboard auto-refresh interval (minutes, 0 = off)", type: "number", default: "5" },
  // Sales
  { key: "orders.shortagePolicy", group: "Sales & credit", label: "Stock shortage handling", type: "select", options: ["hold", "partial_backorder"], default: "hold", help: "Hold the whole order, or allocate what is available and keep the balance as backorder." },
  { key: "orders.reservationHours", group: "Sales & credit", label: "Release unconfirmed reservations after (hours)", type: "number", default: "48" },
  { key: "orders.duplicateWindowHours", group: "Sales & credit", label: "Duplicate-order window (hours)", type: "number", default: "24" },
  { key: "validation.credit", group: "Sales & credit", label: "Credit limit check severity", type: "select", options: ["block", "warn", "off"], default: "block" },
  { key: "validation.overdue", group: "Sales & credit", label: "Overdue receivables check severity", type: "select", options: ["block", "warn", "off"], default: "warn" },
  { key: "validation.stock", group: "Sales & credit", label: "Stock availability check severity", type: "select", options: ["block", "warn", "off"], default: "block" },
  { key: "validation.duplicate", group: "Sales & credit", label: "Duplicate order check severity", type: "select", options: ["block", "warn", "off"], default: "warn" },
  { key: "validation.discount", group: "Sales & credit", label: "Discount beyond rules severity", type: "select", options: ["block", "warn", "off"], default: "block" },
  { key: "credit.nearLimitPct", group: "Sales & credit", label: "Near-limit warning at (% of credit limit)", type: "number", default: "85" },
  { key: "credit.overdueDays", group: "Sales & credit", label: "Overdue threshold (days past due)", type: "number", default: "30" },
  { key: "credit.overdueAmount", group: "Sales & credit", label: "Overdue threshold (₱)", type: "number", default: "20000" },
  { key: "discount.supervisorMaxPct", group: "Sales & credit", label: "Discount override: supervisor limit (%)", type: "number", default: "10", help: "Above this a sales manager (head office) must approve." },
  { key: "cancel.supervisorMaxValue", group: "Sales & credit", label: "Order cancellation / void: supervisor authority (₱)", type: "number", default: "50000", help: "Above this value a head office approver must approve." },
  { key: "credit.supervisorMaxExcess", group: "Sales & credit", label: "Credit-limit exception: supervisor authority — excess over limit (₱)", type: "number", default: "100000", help: "A larger excess escalates to the finance / credit approver." },
  { key: "creditNote.supervisorLimit", group: "Sales & credit", label: "Credit note: supervisor approval limit (₱)", type: "number", default: "5000" },
  { key: "credit.autoAction", group: "Sales & credit", label: "Customer crossing the overdue threshold", type: "select", options: ["on_watch", "on_hold", "off"], default: "on_watch", help: "Move the customer on watch or on hold automatically (a supervisor releases it). Off: alert only." },
  { key: "finance.docSupervisorLimit", group: "Sales & credit", label: "Debit note / adjustment: supervisor approval limit (₱)", type: "number", default: "10000", help: "Larger amounts go to head office finance. Write-offs always go to head office finance." },
  { key: "claim.tolerancePct", group: "Promotions", label: "Claim may exceed eligible amount by up to (%)", type: "number", default: "0", help: "Anything above needs an exception approval." },
  { key: "claim.submitWindowDays", group: "Promotions", label: "Claims accepted within (days after promotion ends)", type: "number", default: "30" },
  { key: "writeoff.approver", group: "Sales & credit", label: "Write-off approval authority", type: "select", options: ["head_office_finance"], default: "head_office_finance" },
  { key: "ageing.buckets", group: "Sales & credit", label: "Ageing buckets (days, comma separated)", type: "text", default: "30,60,90" },
  // Delivery / field
  { key: "delivery.cutoffHour", group: "Delivery & field", label: "Order cut-off hour (0–23)", type: "number", default: "14" },
  { key: "delivery.leadDays", group: "Delivery & field", label: "Standard delivery lead time (days)", type: "number", default: "1" },
  { key: "delivery.nonDeliveryDays", group: "Delivery & field", label: "Non-delivery weekdays", type: "text", default: "sunday" },
  { key: "delivery.holidays", group: "Delivery & field", label: "Holidays (YYYY-MM-DD, comma separated)", type: "text", default: "2026-12-25,2026-12-30,2027-01-01" },
  { key: "visit.toleranceM", group: "Delivery & field", label: "Visit check-in distance tolerance (m)", type: "number", default: "150" },
  { key: "visit.toleranceMode", group: "Delivery & field", label: "Out-of-tolerance check-in", type: "select", options: ["warn", "block"], default: "warn" },
  { key: "visit.minDurationMin", group: "Delivery & field", label: "Short-visit flag below (minutes)", type: "number", default: "3" },
  { key: "attendance.standardStart", group: "Delivery & field", label: "Standard day start (HH:MM)", type: "text", default: "08:30" },
  { key: "van.eodToleranceUnits", group: "Delivery & field", label: "Van end-of-day tolerance (units per SKU)", type: "number", default: "2" },
  { key: "van.damagePhotoQty", group: "Delivery & field", label: "Photo mandatory when marking damaged at or above (units)", type: "number", default: "10" },
  { key: "van.cashTolerance", group: "Delivery & field", label: "Van cash variance tolerance (₱)", type: "number", default: "50" },
  { key: "return.periodDays", group: "Delivery & field", label: "Market return period (days after invoice)", type: "number", default: "14" },
  { key: "receipt.maxReprints", group: "Delivery & field", label: "Receipt reprints allowed", type: "number", default: "2" },
  { key: "photo.maxPerForm", group: "Delivery & field", label: "Maximum photos per form", type: "number", default: "3" },
  // Governance
  { key: "sync.staleHours", group: "Governance", label: "Device is 'stale' after (hours without sync)", type: "number", default: "24" },
  { key: "mfa.privilegedRoles", group: "Governance", label: "Roles that must use multi-factor authentication", type: "text", default: "admin,supervisor" },
  { key: "sso.provider", group: "Governance", label: "SSO identity provider (simulated)", type: "text", default: "Company F and B Azure AD" },
  { key: "sso.protocol", group: "Governance", label: "SSO protocol", type: "select", options: ["OpenID Connect", "SAML 2.0"], default: "OpenID Connect" },
  { key: "gamification.enabled", group: "Governance", label: "Recognition & gamification", type: "select", options: ["on", "off"], default: "on" },
  { key: "gamification.showNames", group: "Governance", label: "Leaderboard shows names", type: "select", options: ["names", "positions_only"], default: "names" },
];

const DEFAULTS = new Map(SETTING_DEFS.map((d) => [d.key, d.default]));

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await prisma.appSetting.findMany();
  const out: Record<string, string> = {};
  for (const [k, v] of DEFAULTS) out[k] = v;
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function getSetting(key: string): Promise<string> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value ?? DEFAULTS.get(key) ?? "";
}

export async function getNumberSetting(key: string): Promise<number> {
  const n = Number(await getSetting(key));
  return Number.isFinite(n) ? n : Number(DEFAULTS.get(key) ?? 0);
}

export function num(settings: Record<string, string>, key: string): number {
  const n = Number(settings[key]);
  return Number.isFinite(n) ? n : Number(DEFAULTS.get(key) ?? 0);
}

export interface ExpiryBands { warning: number; critical: number }

export function expiryBandsFor(settings: Record<string, string>, category: string): ExpiryBands {
  let bands: ExpiryBands = { warning: num(settings, "nearExpiry.warningDays"), critical: num(settings, "nearExpiry.criticalDays") };
  try {
    const o = JSON.parse(settings["nearExpiry.overrides"] || "{}") as Record<string, Partial<ExpiryBands>>;
    if (o[category]) bands = { warning: o[category].warning ?? bands.warning, critical: o[category].critical ?? bands.critical };
  } catch {
    /* malformed override JSON falls back to the global bands */
  }
  return bands;
}

// healthy | warning | critical | expired
export function expiryBand(expiry: Date | null, bands: ExpiryBands, now = new Date()): "healthy" | "warning" | "critical" | "expired" {
  if (!expiry) return "healthy";
  const days = Math.floor((expiry.getTime() - now.getTime()) / 86400000);
  if (days < 0) return "expired";
  if (days <= bands.critical) return "critical";
  if (days <= bands.warning) return "warning";
  return "healthy";
}
