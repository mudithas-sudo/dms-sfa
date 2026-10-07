import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { formatDateTime } from "@/lib/format";
import { dayStart, vanDayFigures, pendingAckByProduct } from "@/lib/van";

// Live stock balance of every van: what was loaded, sold, returned and what is on the van now (good vs damaged).
export default async function VanStockOverviewPage({ searchParams }: { searchParams: Promise<{ van?: string; date?: string }> }) {
  const { branchId } = await getSession();
  const { van: vanParam, date } = await searchParams;
  const vans = await prisma.van.findMany({ where: branchId ? { branchId } : {}, orderBy: { code: "asc" }, include: { assignedUser: true } });
  const van = vans.find((v) => v.id === vanParam) ?? vans[0];
  const day = date ? dayStart(new Date(date)) : dayStart();
  const isToday = day.getTime() === dayStart().getTime();
  const [figures, rows, products, pend, lastMove] = await Promise.all([
    van ? vanDayFigures(van.id, day) : [],
    van ? prisma.stockBalance.findMany({ where: { locationType: "van", vanId: van.id } }) : [],
    prisma.product.findMany({ select: { id: true, name: true, sku: true } }),
    van ? pendingAckByProduct(van.id) : new Map<string, number>(),
    van ? prisma.stockMovement.findFirst({ where: { vanId: van.id }, orderBy: { createdAt: "desc" } }) : null,
  ]);
  const pname = new Map(products.map((p) => [p.id, p]));
  const damagedOf = (pid: string) => rows.filter((r) => r.productId === pid).reduce((s, r) => s + r.qtyDamaged + r.qtyExpired, 0);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Van Stock Balances</h2>
        <p className="mt-1 text-xs text-slate-500">
          One live balance per van and SKU: opening + loaded − sold − returned ± adjustments = closing. Good and damaged stock are held separately so sellable inventory is never overstated; every balance can be traced
          to the loading, sale and return documents behind it. Choose a date to see the position for that day.
        </p>
      </div>
      <form method="get" className="flex flex-wrap items-center gap-2">
        <select name="van" defaultValue={van?.id} className="input max-w-xs">
          {vans.map((v) => (
            <option key={v.id} value={v.id}>{v.code} · {v.assignedUser?.name ?? v.driverName}</option>
          ))}
        </select>
        <input className="input max-w-[170px]" type="date" name="date" defaultValue={date ?? ""} />
        <button className="btn-secondary" type="submit">Show</button>
        {van && <span className="text-xs text-slate-500">Last synchronised {lastMove ? formatDateTime(lastMove.createdAt) : "—"}</span>}
      </form>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr><th className="th">SKU</th><th className="th">Product</th><th className="th">Opening</th><th className="th">Loaded</th><th className="th">Sold</th><th className="th">Returned</th><th className="th">Adjusted</th><th className="th">Closing (good)</th><th className="th">Awaiting ack.</th><th className="th">Damaged / expired</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {figures.filter((f) => f.closing > 0 || f.loaded || f.sold || f.returned).map((f) => (
              <tr key={f.productId}>
                <td className="td font-mono text-xs text-slate-500">{pname.get(f.productId)?.sku}</td>
                <td className="td font-medium text-slate-900">{pname.get(f.productId)?.name}</td>
                <td className="td">{f.opening}</td><td className="td">{f.loaded}</td><td className="td">{f.sold}</td><td className="td">{f.returned}</td><td className="td">{f.adjusted}</td>
                <td className="td font-medium">{f.closing}</td>
                <td className="td text-xs text-amber-700">{isToday && pend.get(f.productId) ? pend.get(f.productId) : ""}</td>
                <td className="td text-xs text-rose-600">{damagedOf(f.productId) || ""}</td>
              </tr>
            ))}
            {figures.length === 0 && (
              <tr><td className="td text-slate-400" colSpan={10}>No stock or movements for this van on that day.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
