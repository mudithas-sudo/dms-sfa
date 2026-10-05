import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getRepVan, confirmEodReconciliation } from "@/app/actions/sfa-actions";
import { formatDateTime, startOfToday as getStartOfToday } from "@/lib/format";

export default async function MobileEodPage() {
  const { userId, branchId } = await getSession();
  if (!userId || !branchId) return <p className="text-sm text-slate-500">No rep selected.</p>;

  const rep = await prisma.user.findUnique({ where: { id: userId } });
  const van = rep ? await getRepVan(branchId, rep) : null;

  const startOfToday = getStartOfToday();
  const todayAttendance = await prisma.attendance.findFirst({ where: { userId, dayDate: startOfToday } });

  let rows: { productName: string; loaded: number; sold: number; returned: number; expected: number; actual: number }[] = [];
  let hasMismatch = false;

  if (van) {
    const [loads, returns, currentStock, sold] = await Promise.all([
      prisma.vanLoadLine.findMany({ where: { vanLoad: { vanId: van.id, status: "approved", loadedAt: { gte: startOfToday } } }, include: { product: true } }),
      prisma.vanReturn.findMany({ where: { vanId: van.id, createdAt: { gte: startOfToday } }, include: { product: true } }),
      prisma.stockBalance.findMany({ where: { locationType: "van", vanId: van.id }, include: { product: true } }),
      prisma.salesOrderLine.findMany({
        where: { salesOrder: { salespersonId: userId, orderDate: { gte: startOfToday }, status: { not: "voided" } } },
        include: { product: true },
      }),
    ]);

    const byProduct = new Map<string, { name: string; loaded: number; sold: number; returned: number; actual: number }>();
    const bump = (id: string, name: string, key: "loaded" | "sold" | "returned" | "actual", qty: number) => {
      const cur = byProduct.get(id) ?? { name, loaded: 0, sold: 0, returned: 0, actual: 0 };
      cur[key] += qty;
      byProduct.set(id, cur);
    };
    for (const l of loads) bump(l.productId, l.product.name, "loaded", l.qty);
    for (const s of sold) bump(s.productId, s.product.name, "sold", s.qty);
    for (const r of returns) bump(r.productId, r.product.name, "returned", r.qty);
    for (const s of currentStock) bump(s.productId, s.product.name, "actual", s.qtyGood);

    rows = Array.from(byProduct.values())
      .filter((v) => v.loaded > 0 || v.sold > 0 || v.returned > 0)
      .map((v) => ({ productName: v.name, loaded: v.loaded, sold: v.sold, returned: v.returned, expected: v.loaded - v.sold - v.returned, actual: v.actual }));
    hasMismatch = rows.some((r) => r.expected !== r.actual);
  }

  const confirmed = todayAttendance?.eodConfirmedAt;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">End-of-Day Reconciliation</h2>
        <p className="text-xs text-slate-500">{van ? `${van.code}` : "No van assigned"} · Loaded − Sold − Returned vs. actual</p>
      </div>

      <div className="card divide-y divide-slate-100 p-2">
        {rows.map((r, i) => {
          const mismatch = r.expected !== r.actual;
          return (
            <div key={i} className="px-2 py-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-900">{r.productName}</p>
                <span className={`badge ${mismatch ? "badge-red" : "badge-green"}`}>{mismatch ? "Mismatch" : "Match"}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Loaded {r.loaded} − Sold {r.sold} − Returned {r.returned} = {r.expected} expected · {r.actual} actual
              </p>
            </div>
          );
        })}
        {rows.length === 0 && <p className="px-2 py-4 text-sm text-slate-400">No van activity recorded today.</p>}
      </div>

      <div className="card p-4">
        {confirmed ? (
          <p className="text-sm text-emerald-700">Reconciliation confirmed {formatDateTime(confirmed)}.</p>
        ) : todayAttendance ? (
          <form action={confirmEodReconciliation}>
            <input type="hidden" name="attendanceId" value={todayAttendance.id} />
            <input type="hidden" name="hasMismatch" value={hasMismatch ? "1" : ""} />
            <p className="mb-3 text-xs text-slate-500">
              Confirm that the above loaded/sold/returned figures match what&apos;s physically on the van before closing out your day.
            </p>
            <button type="submit" className="btn-primary w-full">
              {hasMismatch ? "Confirm — Flag Mismatch for Review" : "Confirm Reconciliation"}
            </button>
          </form>
        ) : (
          <p className="text-xs text-slate-400">Start your day (Attendance) before confirming reconciliation.</p>
        )}
      </div>
    </div>
  );
}
