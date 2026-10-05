import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { formatDate } from "@/lib/format";
import { markStockDamaged, reverseStockDamage } from "@/app/actions/branch-actions";

function expiryBadge(expiryDate: Date | null) {
  if (!expiryDate) return null;
  const daysLeft = Math.floor((expiryDate.getTime() - Date.now()) / 86400000);
  if (daysLeft < 0) return <span className="badge badge-red">Expired</span>;
  if (daysLeft <= 30) return <span className="badge badge-amber">Near Expiry ({daysLeft}d)</span>;
  return null;
}

export default async function WarehouseStockPage({
  searchParams,
}: {
  searchParams: Promise<{ sku?: string; lot?: string; expiryBefore?: string }>;
}) {
  const { branchId } = await getSession();
  const { sku, lot, expiryBefore } = await searchParams;

  const warehouse = branchId ? await prisma.warehouse.findFirst({ where: { branchId } }) : null;
  const rows = warehouse
    ? await prisma.stockBalance.findMany({
        where: {
          warehouseId: warehouse.id,
          ...(sku ? { product: { OR: [{ sku: { contains: sku, mode: "insensitive" } }, { name: { contains: sku, mode: "insensitive" } }] } } : {}),
          ...(lot ? { lotNumber: { contains: lot, mode: "insensitive" } } : {}),
          ...(expiryBefore ? { expiryDate: { lte: new Date(expiryBefore) } } : {}),
        },
        include: { product: true, goodsReceiptLine: { include: { goodsReceipt: { include: { purchaseOrder: true } } } } },
        orderBy: { product: { name: "asc" } },
      })
    : [];

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">Warehouse Stock — {warehouse?.name ?? ""}</h2>

      <form className="card flex flex-wrap items-end gap-3 p-4" method="get">
        <div>
          <label className="label" htmlFor="sku">SKU / Product</label>
          <input className="input max-w-xs" type="text" id="sku" name="sku" placeholder="Search SKU or product name" defaultValue={sku ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="lot">Lot</label>
          <input className="input max-w-xs" type="text" id="lot" name="lot" placeholder="Lot number" defaultValue={lot ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="expiryBefore">Expiring Before</label>
          <input className="input" type="date" id="expiryBefore" name="expiryBefore" defaultValue={expiryBefore ?? ""} />
        </div>
        <button type="submit" className="btn-secondary">Filter</button>
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">SKU</th>
              <th className="th">Product</th>
              <th className="th">Lot</th>
              <th className="th">Expiry</th>
              <th className="th">Qty Good</th>
              <th className="th">Reserved</th>
              <th className="th">Qty Damaged</th>
              <th className="th">Flags</th>
              <th className="th">Source PO</th>
              <th className="th">Good / Bad</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="td font-mono text-xs text-slate-500">{r.product.sku}</td>
                <td className="td font-medium text-slate-900">{r.product.name}</td>
                <td className="td">{r.lotNumber}</td>
                <td className="td">{r.expiryDate ? formatDate(r.expiryDate) : "—"}</td>
                <td className="td">{r.qtyGood}</td>
                <td className="td">{r.qtyReserved > 0 ? r.qtyReserved : "—"}</td>
                <td className="td">{r.qtyDamaged > 0 ? <span className="badge badge-red">{r.qtyDamaged}</span> : "—"}</td>
                <td className="td">{expiryBadge(r.expiryDate)}</td>
                <td className="td text-xs">
                  {r.goodsReceiptLine ? (
                    <Link href={`/branch/purchase-orders/${r.goodsReceiptLine.goodsReceipt.purchaseOrderId}`} className="text-blue-600 hover:underline">
                      {r.goodsReceiptLine.goodsReceipt.purchaseOrder.poNumber}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="td">
                  <div className="flex flex-col gap-1">
                    {r.qtyGood > 0 && (
                      <form action={markStockDamaged} className="flex items-center gap-1">
                        <input type="hidden" name="stockBalanceId" value={r.id} />
                        <input className="input w-16 py-1 text-xs" type="number" name="qty" min={1} max={r.qtyGood} placeholder="qty" />
                        <button type="submit" className="text-xs text-rose-600 hover:underline">To Bad</button>
                      </form>
                    )}
                    {r.qtyDamaged > 0 && (
                      <form action={reverseStockDamage} className="flex items-center gap-1">
                        <input type="hidden" name="stockBalanceId" value={r.id} />
                        <input className="input w-16 py-1 text-xs" type="number" name="qty" min={1} max={r.qtyDamaged} placeholder="qty" />
                        <button type="submit" className="text-xs text-emerald-600 hover:underline">To Good</button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td className="td text-slate-400" colSpan={10}>No stock records found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
