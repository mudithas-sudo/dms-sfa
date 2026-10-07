import { prisma } from "@/lib/prisma";

export const METRICS: { id: string; label: string; unit: "money" | "int" | "pct"; higherIsBetter: boolean }[] = [
  { id: "sales_value", label: "Sales value", unit: "money", higherIsBetter: true },
  { id: "sales_volume", label: "Sales volume (units)", unit: "int", higherIsBetter: true },
  { id: "visit_compliance", label: "Visit compliance", unit: "pct", higherIsBetter: true },
  { id: "productive_call_rate", label: "Productive call rate", unit: "pct", higherIsBetter: true },
  { id: "collection", label: "Collections", unit: "money", higherIsBetter: true },
  { id: "new_customers", label: "New customers", unit: "int", higherIsBetter: true },
  { id: "task_completion", label: "Task completion", unit: "pct", higherIsBetter: true },
];

const SALE = ["confirmed", "picked", "invoiced", "delivered", "partially_delivered"];

export function monthWindow(month: string) {
  const from = new Date(`${month}-01T00:00:00`);
  const to = new Date(from.getFullYear(), from.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from, to };
}

export function addMonths(month: string, delta: number) {
  const d = new Date(`${month}-01T00:00:00`);
  d.setMonth(d.getMonth() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export interface MetricRow {
  metric: string;
  value: number;
  target: number | null;
  achievement: number | null;
}

// One representative's figures for a month, each with its target and achievement %.
export async function scorecardFor(userId: string, month: string): Promise<{ rows: MetricRow[]; points: number; extra: { orders: number; visits: number; daysWorked: number } }> {
  const { from, to } = monthWindow(month);
  const [orders, lines, visits, pays, newCust, tasks, targets, att] = await Promise.all([
    prisma.salesOrder.aggregate({ where: { salespersonId: userId, orderDate: { gte: from, lte: to }, status: { in: SALE } }, _sum: { total: true }, _count: true }),
    prisma.salesOrderLine.aggregate({ where: { salesOrder: { salespersonId: userId, orderDate: { gte: from, lte: to }, status: { in: SALE } } }, _sum: { qty: true } }),
    prisma.fieldVisit.findMany({ where: { salespersonId: userId, checkinAt: { gte: from, lte: to } }, select: { visitType: true, status: true, outcome: true } }),
    prisma.aRLedgerEntry.aggregate({ where: { collectedBy: userId, type: "payment", entryDate: { gte: from, lte: to }, recStatus: { not: "reversed" }, paymentStatus: { notIn: ["pending", "bounced"] } }, _sum: { amount: true } }),
    prisma.outlet.count({ where: { createdById: userId, createdAt: { gte: from, lte: to } } }),
    prisma.task.findMany({ where: { assignedToId: userId, createdAt: { gte: from, lte: to }, status: { not: "cancelled" } }, select: { status: true } }),
    prisma.target.findMany({ where: { userId, period: month } }),
    prisma.attendance.count({ where: { userId, dayDate: { gte: from, lte: to } } }),
  ]);
  const planned = visits.filter((v) => v.visitType === "planned" && v.status !== "in_progress");
  const plannedDone = planned.filter((v) => v.status === "completed").length;
  const completed = visits.filter((v) => v.status === "completed");
  const values: Record<string, number> = {
    sales_value: orders._sum.total ?? 0,
    sales_volume: lines._sum.qty ?? 0,
    visit_compliance: planned.length ? Math.round((plannedDone / planned.length) * 100) : 0,
    productive_call_rate: completed.length ? Math.round((completed.filter((v) => v.outcome === "order_taken").length / completed.length) * 100) : 0,
    collection: pays._sum.amount ?? 0,
    new_customers: newCust,
    task_completion: tasks.length ? Math.round((tasks.filter((t) => t.status === "completed").length / tasks.length) * 100) : 0,
  };
  const rows = METRICS.map((m) => {
    const target = targets.find((t) => t.metric === m.id)?.targetValue ?? null;
    return { metric: m.id, value: values[m.id], target, achievement: target ? Math.round((values[m.id] / target) * 100) : null };
  });
  const points = Math.round(
    (orders._count) * 1 + completed.filter((v) => v.outcome === "order_taken").length * 2 + tasks.filter((t) => t.status === "completed").length * 5 + (pays._sum.amount ?? 0) / 10000 + newCust * 10 + att,
  );
  return { rows, points, extra: { orders: orders._count, visits: visits.length, daysWorked: att } };
}

export async function trendFor(userId: string, month: string, months = 6) {
  const out: { month: string; sales: number; visits: number; collection: number; productive: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const m = addMonths(month, -i);
    const s = await scorecardFor(userId, m);
    out.push({ month: m, sales: s.rows[0].value, visits: s.rows[2].value, collection: s.rows[4].value, productive: s.rows[3].value });
  }
  return out;
}

export interface Badge {
  id: string;
  label: string;
  icon: string;
  why: string;
}

// Recognition derived from real activity — never self-reported.
export function badgesFor(card: Awaited<ReturnType<typeof scorecardFor>>, rank: number, teamSize: number): Badge[] {
  const get = (id: string) => card.rows.find((r) => r.metric === id)!;
  const out: Badge[] = [];
  if (rank === 1 && teamSize > 1 && get("sales_value").value > 0) out.push({ id: "top", label: "Top seller", icon: "🏆", why: "Highest sales in the team this month" });
  if ((get("sales_value").achievement ?? 0) >= 100) out.push({ id: "target", label: "Target achieved", icon: "🎯", why: "Sales at or above target" });
  if (get("visit_compliance").value >= 90) out.push({ id: "route", label: "Route master", icon: "🧭", why: "90%+ of planned visits completed" });
  if (get("productive_call_rate").value >= 60) out.push({ id: "productive", label: "Productive caller", icon: "⚡", why: "60%+ of visits ended in an order" });
  if (get("new_customers").value >= 2) out.push({ id: "builder", label: "Customer builder", icon: "🌱", why: "Registered 2+ new customers" });
  if (get("task_completion").value === 100 && card.rows.length) out.push({ id: "tasks", label: "Task finisher", icon: "✅", why: "Every assigned task completed" });
  if (card.extra.daysWorked >= 20) out.push({ id: "attendance", label: "Always present", icon: "📅", why: "20+ working days recorded" });
  return out;
}
