import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import StatusBadge from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/format";

export default async function OrderHistoryPage() {
  const { userId } = await getSession();
  if (!userId) return <p className="text-sm text-slate-500">No rep selected.</p>;

  const orders = await prisma.salesOrder.findMany({
    where: { salespersonId: userId },
    orderBy: { orderDate: "desc" },
    take: 30,
    include: { outlet: true, invoices: true },
  });

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">Order & Invoice History</h2>
      <div className="card divide-y divide-slate-100 p-2">
        {orders.map((o) => (
          <div key={o.id} className="px-2 py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-900">{o.orderNumber}</p>
                <p className="text-xs text-slate-500">{o.outlet.name} · {formatDate(o.orderDate)}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-slate-900">{formatCurrency(o.total)}</p>
                <StatusBadge status={o.status} />
              </div>
            </div>
            {o.invoices[0] && (
              <p className="mt-1 text-xs text-slate-400">
                Invoice{" "}
                <Link href={`/supervisor/invoices/${o.invoices[0].id}`} className="text-blue-600 hover:underline">
                  {o.invoices[0].invoiceNumber}
                </Link>
                {" "}— {o.invoices[0].status}
              </p>
            )}
          </div>
        ))}
        {orders.length === 0 && <p className="px-2 py-4 text-sm text-slate-400">No orders yet.</p>}
      </div>
    </div>
  );
}
