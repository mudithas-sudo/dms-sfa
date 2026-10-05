import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import StatusBadge from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";
import { requestStockTransfer, decideStockTransfer } from "@/app/actions/branch-actions";

export default async function StockTransfersPage() {
  const { branchId } = await getSession();
  const warehouse = branchId ? await prisma.warehouse.findFirst({ where: { branchId } }) : null;

  const [transfers, warehouses, products] = await Promise.all([
    warehouse
      ? prisma.stockTransfer.findMany({
          where: { OR: [{ fromWarehouseId: warehouse.id }, { toWarehouseId: warehouse.id }] },
          orderBy: { createdAt: "desc" },
          include: { fromWarehouse: true, toWarehouse: true, product: true },
        })
      : Promise.resolve([]),
    prisma.warehouse.findMany({ include: { branch: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
  ]);

  const otherWarehouses = warehouses.filter((w) => w.id !== warehouse?.id);

  return (
    <div className="space-y-6">
      <h2 className="text-base font-semibold text-slate-900">Stock Transfers — {warehouse?.name ?? ""}</h2>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Product</th>
              <th className="th">From</th>
              <th className="th">To</th>
              <th className="th">Qty</th>
              <th className="th">Requested</th>
              <th className="th">Status</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {transfers.map((t) => (
              <tr key={t.id}>
                <td className="td font-medium text-slate-900">{t.product.name}</td>
                <td className="td">{t.fromWarehouse.name}</td>
                <td className="td">{t.toWarehouse.name}</td>
                <td className="td">{t.qty}</td>
                <td className="td text-xs">{formatDateTime(t.createdAt)}</td>
                <td className="td"><StatusBadge status={t.status} /></td>
                <td className="td text-right">
                  {t.status === "pending" && t.toWarehouseId === warehouse?.id && (
                    <form action={decideStockTransfer} className="flex justify-end gap-2">
                      <input type="hidden" name="id" value={t.id} />
                      <button type="submit" name="decision" value="approved" className="text-xs text-emerald-600 hover:underline">Approve</button>
                      <button type="submit" name="decision" value="rejected" className="text-xs text-rose-600 hover:underline">Reject</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {transfers.length === 0 && <tr><td className="td text-slate-400" colSpan={7}>No stock transfers yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card max-w-lg p-6">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">Request New Transfer</h3>
        <form action={requestStockTransfer} className="space-y-4">
          <input type="hidden" name="fromWarehouseId" value={warehouse?.id ?? ""} />
          <div>
            <label className="label" htmlFor="toWarehouseId">To Warehouse</label>
            <select className="input" id="toWarehouseId" name="toWarehouseId" required>
              {otherWarehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name} ({w.branch.name})</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="productId">Product</label>
              <select className="input" id="productId" name="productId" required>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="qty">Quantity</label>
              <input className="input" id="qty" name="qty" type="number" min={1} required />
            </div>
          </div>
          <button type="submit" className="btn-primary">Request Transfer</button>
        </form>
      </div>
    </div>
  );
}
