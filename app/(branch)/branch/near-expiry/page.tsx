import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { formatDate, formatCurrency, daysFromNow } from "@/lib/format";

export default async function NearExpiryPage() {
  const { branchId } = await getSession();
  const warehouse = branchId ? await prisma.warehouse.findFirst({ where: { branchId } }) : null;

  const rows = warehouse
    ? await prisma.stockBalance.findMany({
        where: {
          warehouseId: warehouse.id,
          expiryDate: { not: null, lte: daysFromNow(45) },
          qtyGood: { gt: 0 },
        },
        include: { product: true },
        orderBy: { expiryDate: "asc" },
      })
    : [];

  const now = daysFromNow(0).getTime();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Near-Expiry Alert List — {warehouse?.name ?? ""}</h2>
        <p className="text-sm text-slate-500">Lots expiring within 45 days, sorted soonest first — pick these before newer stock (FEFO).</p>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Product</th>
              <th className="th">Lot</th>
              <th className="th">Qty</th>
              <th className="th">Expiry</th>
              <th className="th">Days Left</th>
              <th className="th">Value at Risk</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const daysLeft = Math.floor((r.expiryDate!.getTime() - now) / 86400000);
              return (
                <tr key={r.id} className={daysLeft < 0 ? "bg-rose-50/50" : daysLeft <= 15 ? "bg-amber-50/50" : ""}>
                  <td className="td font-medium text-slate-900">{r.product.name}</td>
                  <td className="td">{r.lotNumber}</td>
                  <td className="td">{r.qtyGood}</td>
                  <td className="td">{formatDate(r.expiryDate!)}</td>
                  <td className={`td font-medium ${daysLeft < 0 ? "text-rose-600" : daysLeft <= 15 ? "text-amber-600" : "text-slate-700"}`}>
                    {daysLeft < 0 ? `Expired ${-daysLeft}d ago` : `${daysLeft}d`}
                  </td>
                  <td className="td">{formatCurrency(r.qtyGood * r.product.unitPrice)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={6}>No near-expiry stock in this warehouse.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
