import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { receiveGoods } from "@/app/actions/branch-actions";
import QtyVarianceInput from "@/components/QtyVarianceInput";

export default async function ReceiveGoodsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { branchId } = await getSession();

  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { lines: { include: { product: true } } },
  });
  if (!po) notFound();
  const warehouse = await prisma.warehouse.findFirst({ where: { branchId: branchId ?? po.branchId } });

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/branch/purchase-orders" className="hover:underline">Purchase Orders</Link>
        <span>/</span>
        <span className="text-slate-900">{po.poNumber}</span>
      </div>

      <div className="card p-6">
        <h2 className="mb-4 text-base font-semibold text-slate-900">Receive Goods — {po.poNumber}</h2>
        <form action={receiveGoods} className="space-y-4" encType="multipart/form-data">
          <input type="hidden" name="purchaseOrderId" value={po.id} />
          <input type="hidden" name="warehouseId" value={warehouse?.id ?? ""} />

          <table className="w-full text-sm">
            <thead className="border-b border-slate-200">
              <tr>
                <th className="th">Product</th>
                <th className="th">Ordered Qty</th>
                <th className="th">Actual Qty</th>
                <th className="th">Lot Number</th>
                <th className="th">Expiry Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {po.lines.map((line) => (
                <tr key={line.id}>
                  <td className="td font-medium text-slate-900">{line.product.name}</td>
                  <td className="td">{line.qtyOrdered}</td>
                  <td className="td">
                    <QtyVarianceInput name={`qty_${line.id}`} ordered={line.qtyOrdered} />
                  </td>
                  <td className="td">
                    <input className="input w-32" type="text" name={`lot_${line.id}`} placeholder="LOT-XXXXX" />
                  </td>
                  <td className="td">
                    {line.product.hasExpiry && (
                      <input className="input w-40" type="date" name={`expiry_${line.id}`} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="pt-2">
            <label htmlFor="attachment" className="label">Attach receiving documentation (delivery note / photo)</label>
            <input className="input" type="file" id="attachment" name="attachment" accept="image/*,.pdf" />
            <p className="mt-1 text-xs text-slate-400">Prototype stub — only the filename is stored, not the file itself.</p>
          </div>

          <div className="flex gap-2 pt-2">
            <button type="submit" className="btn-primary">Confirm Receipt</button>
            <Link href="/branch/purchase-orders" className="btn-secondary">Cancel</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
