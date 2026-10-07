import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { formatDate } from "@/lib/format";
import Banner from "@/components/Banner";
import { reclassifyStock } from "@/app/actions/inventory-actions";
import { getAllSettings, expiryBand, expiryBandsFor } from "@/lib/settings";
import { availableOf } from "@/lib/stock";

const BAND_BADGE: Record<string, string> = { healthy: "badge-green", warning: "badge-amber", critical: "badge-red", expired: "badge-red" };

export default async function WarehouseStockPage({
  searchParams,
}: {
  searchParams: Promise<{ sku?: string; lot?: string; expiryBefore?: string; category?: string; view?: string; error?: string; notice?: string }>;
}) {
  const { branchId } = await getSession();
  const { sku, lot, expiryBefore, category, view, error, notice } = await searchParams;
  const settings = await getAllSettings();

  const warehouse = branchId ? await prisma.warehouse.findFirst({ where: { branchId, type: "saleable" } }) : null;
  const [rows, inTransitOut, inTransitIn, categories] = await Promise.all([
    warehouse
      ? prisma.stockBalance.findMany({
          where: {
            warehouseId: warehouse.id,
            ...(sku ? { product: { OR: [{ sku: { contains: sku, mode: "insensitive" } }, { name: { contains: sku, mode: "insensitive" } }] } } : {}),
            ...(category ? { product: { category } } : {}),
            ...(lot ? { lotNumber: { contains: lot, mode: "insensitive" } } : {}),
            ...(expiryBefore ? { expiryDate: { lte: new Date(expiryBefore) } } : {}),
          },
          include: { product: true, goodsReceiptLine: { include: { goodsReceipt: { include: { purchaseOrder: true } } } } },
          orderBy: [{ product: { name: "asc" } }, { expiryDate: "asc" }],
        })
      : Promise.resolve([]),
    warehouse ? prisma.stockTransfer.findMany({ where: { fromWarehouseId: warehouse.id, status: "in_transit" } }) : Promise.resolve([]),
    warehouse ? prisma.stockTransfer.findMany({ where: { toWarehouseId: warehouse.id, status: "in_transit" } }) : Promise.resolve([]),
    prisma.product.findMany({ distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } }),
  ]);

  const total = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
  const bad = (r: (typeof rows)[number]) => r.qtyDamaged + r.qtyExpired + r.qtyQuarantine;
  const summary = [
    { label: "Good (sellable)", value: total((r) => r.qtyGood) },
    { label: "Allocated to orders", value: total((r) => r.qtyReserved) },
    { label: "Available to promise", value: total((r) => availableOf(r)) },
    { label: "Bad stock", value: total(bad) },
    { label: "In transit out", value: inTransitOut.reduce((s, t) => s + t.qty, 0) },
    { label: "In transit in", value: inTransitIn.reduce((s, t) => s + t.qty, 0) },
  ];

  // SKU summary view: one line per product, lots rolled up.
  const bySku = new Map<string, { name: string; sku: string; category: string; good: number; reserved: number; bad: number; lots: number; earliest: Date | null }>();
  for (const r of rows) {
    const cur = bySku.get(r.productId) ?? { name: r.product.name, sku: r.product.sku, category: r.product.category, good: 0, reserved: 0, bad: 0, lots: 0, earliest: null as Date | null };
    cur.good += r.qtyGood;
    cur.reserved += r.qtyReserved;
    cur.bad += bad(r);
    cur.lots += 1;
    if (r.expiryDate && (!cur.earliest || r.expiryDate < cur.earliest)) cur.earliest = r.expiryDate;
    bySku.set(r.productId, cur);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Warehouse Stock — {warehouse?.name ?? ""}</h2>
          <p className="text-xs text-slate-500">
            Live stock by SKU, lot and expiry. On-hand is what is physically recorded; allocated stock is reserved for confirmed orders and not yet dispatched; available is
            what can still be promised. Bad stock (damaged, expired, quarantine) is never available.
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <Link className={`btn-secondary px-3 py-1 ${view !== "sku" ? "ring-1 ring-blue-500" : ""}`} href="/branch/warehouse-stock">By lot</Link>
          <Link className={`btn-secondary px-3 py-1 ${view === "sku" ? "ring-1 ring-blue-500" : ""}`} href="/branch/warehouse-stock?view=sku">By SKU</Link>
        </div>
      </div>
      <Banner error={error} notice={notice} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {summary.map((s) => (
          <div key={s.label} className="card px-4 py-3">
            <p className="text-[11px] text-slate-500">{s.label}</p>
            <p className="text-lg font-semibold text-slate-900">{s.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      <form className="card flex flex-wrap gap-3 p-4" method="get">
        <input className="input max-w-[200px]" name="sku" placeholder="SKU or name" defaultValue={sku} />
        <input className="input max-w-[160px]" name="lot" placeholder="Lot" defaultValue={lot} />
        <select className="input max-w-[180px]" name="category" defaultValue={category ?? ""}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.category} value={c.category}>{c.category}</option>
          ))}
        </select>
        <input className="input max-w-[170px]" type="date" name="expiryBefore" defaultValue={expiryBefore} title="Expiring before" />
        <button className="btn-secondary" type="submit">Filter</button>
      </form>

      {view === "sku" ? (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">SKU</th>
                <th className="th">Product</th>
                <th className="th">Category</th>
                <th className="th">Lots</th>
                <th className="th">Good</th>
                <th className="th">Allocated</th>
                <th className="th">Available</th>
                <th className="th">Bad</th>
                <th className="th">Earliest expiry</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...bySku.entries()].map(([pid, s]) => (
                <tr key={pid} className="hover:bg-slate-50">
                  <td className="td font-mono text-xs text-slate-500">{s.sku}</td>
                  <td className="td font-medium text-slate-900"><Link className="hover:underline" href={`/branch/warehouse-stock/${pid}`}>{s.name}</Link></td>
                  <td className="td">{s.category}</td>
                  <td className="td">{s.lots}</td>
                  <td className="td">{s.good}</td>
                  <td className="td">{s.reserved}</td>
                  <td className="td font-medium">{Math.max(0, s.good - s.reserved)}</td>
                  <td className="td">{s.bad}</td>
                  <td className="td">{s.earliest ? formatDate(s.earliest) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Product</th>
                <th className="th">Lot</th>
                <th className="th">Expiry</th>
                <th className="th">On hand</th>
                <th className="th">Allocated</th>
                <th className="th">Available</th>
                <th className="th">Bad: dmg / exp / qtn</th>
                <th className="th">Source</th>
                <th className="th">Reclassify</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const bands = expiryBandsFor(settings, r.product.category);
                const band = expiryBand(r.expiryDate, bands);
                const days = r.expiryDate ? Math.floor((r.expiryDate.getTime() - new Date().getTime()) / 86400000) : null;
                const po = r.goodsReceiptLine?.goodsReceipt;
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="td font-medium text-slate-900">
                      <Link className="hover:underline" href={`/branch/warehouse-stock/${r.productId}?lot=${encodeURIComponent(r.lotNumber)}`}>{r.product.name}</Link>
                      <div className="text-xs font-normal text-slate-400">{r.product.sku}</div>
                    </td>
                    <td className="td text-xs">{r.lotNumber}</td>
                    <td className="td text-xs">
                      {r.expiryDate ? formatDate(r.expiryDate) : "—"}
                      {r.expiryDate && <span className={`badge ml-2 ${BAND_BADGE[band]}`}>{band === "expired" ? "Expired" : `${days}d · ${band}`}</span>}
                    </td>
                    <td className="td">{r.qtyGood}</td>
                    <td className="td">{r.qtyReserved}</td>
                    <td className="td font-medium">{availableOf(r)}</td>
                    <td className="td text-xs">{r.qtyDamaged} / {r.qtyExpired} / {r.qtyQuarantine}</td>
                    <td className="td text-xs">
                      {po ? <Link className="text-blue-600 hover:underline" href={`/branch/purchase-orders/${po.purchaseOrderId}`}>{po.grNumber} · {po.purchaseOrder.poNumber}</Link> : "—"}
                    </td>
                    <td className="td">
                      <details>
                        <summary className="cursor-pointer text-xs text-blue-600">Move…</summary>
                        <form action={reclassifyStock} className="mt-2 grid w-56 gap-1.5">
                          <input type="hidden" name="stockBalanceId" value={r.id} />
                          <select name="from" className="input py-1 text-xs" defaultValue="good">
                            <option value="good">From: Good</option>
                            <option value="damaged">From: Damaged</option>
                            <option value="expired">From: Expired</option>
                            <option value="quarantine">From: Quarantine</option>
                          </select>
                          <select name="to" className="input py-1 text-xs" defaultValue="damaged">
                            <option value="good">To: Good (needs approval)</option>
                            <option value="damaged">To: Damaged</option>
                            <option value="expired">To: Expired</option>
                            <option value="quarantine">To: Quarantine</option>
                          </select>
                          <input className="input py-1 text-xs" type="number" min={1} name="qty" placeholder="Qty" required />
                          <input className="input py-1 text-xs" name="reason" placeholder="Reason (required)" required />
                          <button className="btn-secondary px-2 py-1 text-xs" type="submit">Reclassify</button>
                        </form>
                      </details>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td className="td text-slate-400" colSpan={9}>No stock matches these filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500">
        Every change to a quantity is recorded with its source document — click a product to see the movements behind it. Moving stock from bad back to good needs supervisor approval.
      </p>
    </div>
  );
}
