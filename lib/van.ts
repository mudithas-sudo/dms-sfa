import { prisma } from "@/lib/prisma";

export async function getRepVan(branchId: string, rep: { id: string; name: string }) {
  const vans = await prisma.van.findMany({ where: { branchId, status: "active" } });
  return vans.find((v) => v.assignedUserId === rep.id) ?? vans.find((v) => v.driverName === rep.name) ?? null;
}

export function dayStart(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Stock loaded onto the van but not yet acknowledged by the rep cannot be sold: it stays out of the sellable balance.
export async function pendingAckByProduct(vanId: string) {
  const loads = await prisma.vanLoad.findMany({ where: { vanId, status: "loaded", confirmedAt: null }, include: { lines: true } });
  const m = new Map<string, number>();
  for (const l of loads) for (const line of l.lines) m.set(line.productId, (m.get(line.productId) ?? 0) + line.qty);
  return m;
}

export async function sellableByProduct(vanId: string) {
  const [rows, pend] = await Promise.all([prisma.stockBalance.findMany({ where: { locationType: "van", vanId } }), pendingAckByProduct(vanId)]);
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.productId, (m.get(r.productId) ?? 0) + r.qtyGood);
  for (const [pid, q] of pend) m.set(pid, Math.max(0, (m.get(pid) ?? 0) - q));
  return m;
}

export interface VanDayLine {
  productId: string;
  opening: number;
  loaded: number;
  sold: number;
  returned: number;
  adjusted: number;
  closing: number;
}

// Opening / loaded / sold / returned / adjusted / closing for one van and day, built from the movement ledger.
// Closing is the live good balance; opening is derived so the identity always holds.
export async function vanDayFigures(vanId: string, day = dayStart()): Promise<VanDayLine[]> {
  const next = new Date(day.getTime() + 86400000);
  const [rows, moves, later] = await Promise.all([
    prisma.stockBalance.findMany({ where: { locationType: "van", vanId } }),
    prisma.stockMovement.findMany({ where: { vanId, bucket: "good", createdAt: { gte: day, lt: next } } }),
    prisma.stockMovement.findMany({ where: { vanId, bucket: "good", createdAt: { gte: next } } }),
  ]);
  const ids = new Set<string>([...rows.map((r) => r.productId), ...moves.map((m) => m.productId)]);
  const out: VanDayLine[] = [];
  for (const productId of ids) {
    // closing for a past day = today's balance less everything that moved after that day
    const closing = rows.filter((r) => r.productId === productId).reduce((s, r) => s + r.qtyGood, 0) - later.filter((m) => m.productId === productId).reduce((s, m) => s + m.qty, 0);
    const mv = moves.filter((m) => m.productId === productId);
    const sum = (types: string[]) => mv.filter((m) => types.includes(m.type)).reduce((s, m) => s + m.qty, 0);
    const loaded = sum(["van_load"]);
    const sold = -sum(["van_sale"]);
    const returned = -sum(["van_return"]);
    const adjusted = mv.filter((m) => !["van_load", "van_sale", "van_return"].includes(m.type)).reduce((s, m) => s + m.qty, 0);
    out.push({ productId, loaded, sold, returned, adjusted, closing, opening: closing - (loaded - sold - returned + adjusted) });
  }
  return out;
}
