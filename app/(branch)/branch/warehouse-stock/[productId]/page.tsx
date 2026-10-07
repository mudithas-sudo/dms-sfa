import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { formatDateTime } from "@/lib/format";
import { BUCKET_LABEL } from "@/lib/stock";

// Drill-down from a stock figure to the movements (and documents) that produced it.
export default async function StockMovementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ lot?: string }>;
}) {
  const { productId } = await params;
  const { lot } = await searchParams;
  const { branchId } = await getSession();
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) notFound();
  const warehouses = await prisma.warehouse.findMany({ where: branchId ? { branchId } : {}, select: { id: true, name: true } });
  const whName = new Map(warehouses.map((w) => [w.id, w.name]));
  const movements = await prisma.stockMovement.findMany({
    where: { productId, warehouseId: { in: warehouses.map((w) => w.id) }, ...(lot ? { lotNumber: lot } : {}) },
    orderBy: { createdAt: "desc" },
    take: 150,
  });

  const link = (m: (typeof movements)[number]) => {
    if (m.refType === "GoodsReceipt") return <Link className="text-blue-600 hover:underline" href="/branch/purchase-orders">{m.refNumber}</Link>;
    if (m.refType === "StockTransfer") return <Link className="text-blue-600 hover:underline" href="/branch/stock-transfers">{m.refNumber}</Link>;
    if (m.refType === "StockAdjustment") return <Link className="text-blue-600 hover:underline" href="/branch/stock-adjustments">{m.refNumber}</Link>;
    if (m.refType === "SupplierReturn") return <Link className="text-blue-600 hover:underline" href="/branch/supplier-returns">{m.refNumber}</Link>;
    return m.refNumber ?? "—";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Link href="/branch/warehouse-stock" className="hover:underline">Warehouse Stock</Link>
        <span>/</span>
        <span className="text-slate-900">{product.name}{lot ? ` · ${lot}` : ""}</span>
      </div>
      <h2 className="text-base font-semibold text-slate-900">Stock movements — {product.name}</h2>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">When</th>
              <th className="th">Warehouse</th>
              <th className="th">Lot</th>
              <th className="th">Type</th>
              <th className="th">Bucket</th>
              <th className="th">Change</th>
              <th className="th">Balance after</th>
              <th className="th">Document</th>
              <th className="th">By</th>
              <th className="th">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {movements.map((m) => (
              <tr key={m.id}>
                <td className="td whitespace-nowrap text-xs">{formatDateTime(m.createdAt)}</td>
                <td className="td text-xs">{m.warehouseId ? whName.get(m.warehouseId) : "Van"}</td>
                <td className="td text-xs">{m.lotNumber}</td>
                <td className="td capitalize">{m.type.replace(/_/g, " ")}</td>
                <td className="td text-xs">{BUCKET_LABEL[m.bucket] ?? m.bucket}</td>
                <td className={`td font-medium ${m.qty < 0 ? "text-rose-600" : "text-emerald-700"}`}>{m.qty > 0 ? "+" : ""}{m.qty}</td>
                <td className="td">{m.balanceAfter ?? "—"}</td>
                <td className="td text-xs">{link(m)}</td>
                <td className="td text-xs">{m.userName ?? "—"}</td>
                <td className="td text-xs text-slate-500">{m.note ?? ""}</td>
              </tr>
            ))}
            {movements.length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={10}>No movements are recorded yet for this product — the ledger starts from the platform&apos;s v2.0 upgrade. New receipts, transfers, adjustments and counts appear here.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
