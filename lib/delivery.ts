// Delivery calendar rules: an order placed before the daily cut-off can be delivered after the standard lead
// time; non-delivery weekdays and holidays are skipped. An urgent request may bypass the calendar but is flagged.

export interface DeliverySettings {
  cutoffHour: number;
  leadDays: number;
  nonDeliveryDays: string[];
  holidays: string[];
}

export function deliverySettings(s: Record<string, string>): DeliverySettings {
  return {
    cutoffHour: Number(s["delivery.cutoffHour"] ?? 14),
    leadDays: Number(s["delivery.leadDays"] ?? 1),
    nonDeliveryDays: (s["delivery.nonDeliveryDays"] ?? "sunday").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean),
    holidays: (s["delivery.holidays"] ?? "").split(",").map((x) => x.trim()).filter(Boolean),
  };
}

const DAY = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function unavailableReason(d: Date, cfg: DeliverySettings): string | null {
  if (cfg.nonDeliveryDays.includes(DAY[d.getDay()])) return `No deliveries on ${DAY[d.getDay()]}s`;
  if (cfg.holidays.includes(iso(d))) return "Holiday — no deliveries";
  return null;
}

export function earliestDelivery(cfg: DeliverySettings, now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  let remaining = cfg.leadDays + (now.getHours() >= cfg.cutoffHour ? 1 : 0);
  for (let guard = 0; remaining > 0 && guard < 90; guard++) {
    d.setDate(d.getDate() + 1);
    if (!unavailableReason(d, cfg)) remaining--;
  }
  for (let guard = 0; unavailableReason(d, cfg) && guard < 90; guard++) d.setDate(d.getDate() + 1);
  return d;
}

export function deliveryCalendar(cfg: DeliverySettings, days = 14, now = new Date()) {
  const first = earliestDelivery(cfg, now);
  const out: { date: string; label: string; ok: boolean; reason: string | null }[] = [];
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    const day = new Date(d);
    day.setDate(day.getDate() + i);
    const reason = unavailableReason(day, cfg) ?? (day < first ? (i === 0 ? "Today is past the cut-off or inside the lead time" : "Inside the standard lead time") : null);
    out.push({ date: iso(day), label: day.toLocaleDateString("en-PH", { weekday: "short", day: "numeric", month: "short" }), ok: !reason, reason });
  }
  return { earliest: iso(first), cutoffHour: cfg.cutoffHour, days: out };
}
