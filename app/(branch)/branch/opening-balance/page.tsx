import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import StatusBadge from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";
import { setOpeningBalance } from "@/app/actions/branch-actions";

export default async function OpeningBalancePage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string }>;
}) {
  const { branchId } = await getSession();
  const { submitted } = await searchParams;
  const warehouse = branchId ? await prisma.warehouse.findFirst({ where: { branchId } }) : null;
  const [products, requests] = await Promise.all([
    prisma.product.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
    warehouse
      ? prisma.stockAdjustment.findMany({
          where: { warehouseId: warehouse.id, reasonCode: "opening_balance" },
          orderBy: { createdAt: "desc" },
          include: { product: true },
          take: 10,
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">Beginning Balance Setup — {warehouse?.name ?? ""}</h2>
      <p className="text-sm text-slate-500">
        Enter an opening stock quantity for a new warehouse or a SKU that has never been received
        through a purchase order. Like any other stock baseline correction, this goes through the
        same manager approval before it posts — see{" "}
        <Link href="/branch/stock-adjustments" className="text-blue-600 hover:underline">Stock Adjustments</Link>{" "}
        to approve or reject it.
      </p>
      {submitted === "1" && (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
          Opening balance request submitted for approval.
        </div>
      )}

      {requests.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Product</th>
                <th className="th">Qty</th>
                <th className="th">Requested</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {requests.map((r) => (
                <tr key={r.id}>
                  <td className="td font-medium text-slate-900">{r.product.name}</td>
                  <td className="td">{r.qtyDelta}</td>
                  <td className="td text-xs">{formatDateTime(r.createdAt)}</td>
                  <td className="td"><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card max-w-lg p-6">
        <form action={setOpeningBalance} className="space-y-4">
          <input type="hidden" name="warehouseId" value={warehouse?.id ?? ""} />
          <div>
            <label className="label" htmlFor="productId">Product</label>
            <select className="input" id="productId" name="productId" required>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="qty">Opening Qty</label>
              <input className="input" id="qty" name="qty" type="number" min={1} required />
            </div>
            <div>
              <label className="label" htmlFor="lotNumber">Lot Number (optional)</label>
              <input className="input" id="lotNumber" name="lotNumber" placeholder="Auto-generated if blank" />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="expiryDate">Expiry Date (if applicable)</label>
            <input className="input" id="expiryDate" name="expiryDate" type="date" />
          </div>
          <button type="submit" className="btn-primary">Submit for Approval</button>
        </form>
      </div>
    </div>
  );
}
