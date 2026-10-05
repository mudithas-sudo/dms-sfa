import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export default async function EodReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ van?: string }>;
}) {
  const { branchId } = await getSession();
  const { van: vanIdParam } = await searchParams;
  const vans = branchId ? await prisma.van.findMany({ where: { branchId }, orderBy: { code: "asc" } }) : [];
  const selectedVanId = vanIdParam ?? vans[0]?.id;
  const selectedVan = vans.find((v) => v.id === selectedVanId);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  let rows: { productName: string; loaded: number; sold: number; returned: number; expected: number; actual: number }[] = [];

  if (selectedVan) {
    const [loads, returns, currentStock, rep] = await Promise.all([
      prisma.vanLoadLine.findMany({
        where: { vanLoad: { vanId: selectedVan.id, loadedAt: { gte: startOfToday } } },
        include: { product: true },
      }),
      prisma.vanReturn.findMany({ where: { vanId: selectedVan.id, createdAt: { gte: startOfToday } }, include: { product: true } }),
      prisma.stockBalance.findMany({ where: { locationType: "van", vanId: selectedVan.id }, include: { product: true } }),
      prisma.user.findFirst({ where: { name: selectedVan.driverName, role: "sales_rep" } }),
    ]);
    const sold = rep
      ? await prisma.salesOrderLine.findMany({
          where: { salesOrder: { salespersonId: rep.id, orderDate: { gte: startOfToday }, status: { not: "voided" } } },
          include: { product: true },
        })
      : [];

    const byProduct = new Map<string, { loaded: number; sold: number; returned: number; actual: number }>();
    for (const l of loads) {
      const cur = byProduct.get(l.productId) ?? { loaded: 0, sold: 0, returned: 0, actual: 0 };
      cur.loaded += l.qty;
      byProduct.set(l.productId, cur);
    }
    for (const s of sold) {
      const cur = byProduct.get(s.productId) ?? { loaded: 0, sold: 0, returned: 0, actual: 0 };
      cur.sold += s.qty;
      byProduct.set(s.productId, cur);
    }
    for (const r of returns) {
      const cur = byProduct.get(r.productId) ?? { loaded: 0, sold: 0, returned: 0, actual: 0 };
      cur.returned += r.qty;
      byProduct.set(r.productId, cur);
    }
    for (const s of currentStock) {
      const cur = byProduct.get(s.productId) ?? { loaded: 0, sold: 0, returned: 0, actual: 0 };
      cur.actual += s.qtyGood;
      byProduct.set(s.productId, cur);
    }

    const productNames = new Map<string, string>();
    for (const l of loads) productNames.set(l.productId, l.product.name);
    for (const s of sold) productNames.set(s.productId, s.product.name);
    for (const r of returns) productNames.set(r.productId, r.product.name);
    for (const s of currentStock) productNames.set(s.productId, s.product.name);

    rows = Array.from(byProduct.entries())
      .filter(([, v]) => v.loaded > 0 || v.sold > 0 || v.returned > 0)
      .map(([productId, v]) => ({
        productName: productNames.get(productId) ?? "Unknown",
        loaded: v.loaded,
        sold: v.sold,
        returned: v.returned,
        expected: v.loaded - v.sold - v.returned,
        actual: v.actual,
      }));
  }

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">End-of-Day Reconciliation</h2>
      <p className="text-sm text-slate-500">
        Loaded − Sold − Returned should equal the van&apos;s physical remaining stock. Mismatches are flagged.
      </p>

      <form className="card flex flex-wrap items-end gap-3 p-4" method="get">
        <div>
          <label className="label" htmlFor="van">Van</label>
          <select className="input" id="van" name="van" defaultValue={selectedVanId}>
            {vans.map((v) => (
              <option key={v.id} value={v.id}>{v.code} — {v.driverName}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-secondary">View</button>
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Product</th>
              <th className="th">Loaded</th>
              <th className="th">Sold</th>
              <th className="th">Returned</th>
              <th className="th">Expected Remaining</th>
              <th className="th">Actual Remaining</th>
              <th className="th">Flag</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => {
              const mismatch = r.expected !== r.actual;
              return (
                <tr key={i} className={mismatch ? "bg-rose-50/50" : ""}>
                  <td className="td font-medium text-slate-900">{r.productName}</td>
                  <td className="td">{r.loaded}</td>
                  <td className="td">{r.sold}</td>
                  <td className="td">{r.returned}</td>
                  <td className="td">{r.expected}</td>
                  <td className="td">{r.actual}</td>
                  <td className="td">
                    {mismatch ? (
                      <span className="badge badge-red">Mismatch ({r.actual - r.expected > 0 ? "+" : ""}{r.actual - r.expected})</span>
                    ) : (
                      <span className="badge badge-green">Match</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={7}>No van activity recorded today for this van.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
