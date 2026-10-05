export function formatCurrency(amount: number): string {
  return `₱${amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-PH", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86400000);
}

export function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86400000);
}

export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86400000);
}

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Philippine BIR-style VAT breakdown of a VAT-inclusive amount (standard
// 12% rate). Invoice amounts in this prototype are stored VAT-inclusive, so
// this is a display-only computation, not a stored field.
export function vatBreakdown(vatInclusiveAmount: number, rate = 0.12) {
  const vatableSales = vatInclusiveAmount / (1 + rate);
  const vatAmount = vatInclusiveAmount - vatableSales;
  return { vatableSales, vatAmount, total: vatInclusiveAmount };
}
