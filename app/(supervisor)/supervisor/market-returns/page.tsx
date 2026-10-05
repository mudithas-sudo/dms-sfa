import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/format";
import { processMarketReturn } from "@/app/actions/supervisor-actions";

export default async function MarketReturnsPage() {
  const returns = await prisma.marketReturn.findMany({
    orderBy: { createdAt: "desc" },
    include: { outlet: true, product: true, creditNote: true },
  });

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">Market Returns</h2>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Outlet</th>
              <th className="th">Product</th>
              <th className="th">Qty</th>
              <th className="th">Reason</th>
              <th className="th">Captured</th>
              <th className="th">Status</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {returns.map((r) => (
              <tr key={r.id}>
                <td className="td font-medium text-slate-900">{r.outlet.name}</td>
                <td className="td">{r.product.name}</td>
                <td className="td">{r.qty}</td>
                <td className="td text-xs text-slate-500">{r.reason}</td>
                <td className="td text-xs">{formatDate(r.createdAt)} by {r.capturedBy}</td>
                <td className="td"><StatusBadge status={r.status} /></td>
                <td className="td text-right">
                  {r.status === "pending" ? (
                    <form action={processMarketReturn}>
                      <input type="hidden" name="marketReturnId" value={r.id} />
                      <button type="submit" className="text-xs text-blue-600 hover:underline">
                        Issue Credit Note ({formatCurrency(r.product.unitPrice * r.qty)})
                      </button>
                    </form>
                  ) : (
                    r.creditNote && <span className="text-xs text-slate-400">{r.creditNote.noteNumber}</span>
                  )}
                </td>
              </tr>
            ))}
            {returns.length === 0 && <tr><td className="td text-slate-400" colSpan={7}>No market returns captured yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
