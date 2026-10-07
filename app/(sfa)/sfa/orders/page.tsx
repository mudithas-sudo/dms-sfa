import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import StatusBadge from "@/components/StatusBadge";
import Banner from "@/components/Banner";
import { formatCurrency, formatDate } from "@/lib/format";
import { deleteDraftAction } from "@/app/actions/sfa-draft-actions";

export default async function OrderHistoryPage({ searchParams }: { searchParams: Promise<{ highlight?: string; error?: string; notice?: string }> }) {
  const { userId } = await getSession();
  if (!userId) return <p className="text-sm text-slate-500">No rep selected.</p>;
  const { highlight, error, notice } = await searchParams;

  const orders = await prisma.salesOrder.findMany({
    where: { salespersonId: userId },
    orderBy: { orderDate: "desc" },
    take: 40,
    include: { outlet: true, invoices: true, approvals: true },
  });
  const drafts = orders.filter((o) => o.status === "draft");
  const rest = orders.filter((o) => o.status !== "draft");

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">Orders &amp; Invoices</h2>
      <Banner error={error} notice={notice} />

      {drafts.length > 0 && (
        <div className="card border-amber-200 p-2">
          <p className="px-2 pt-1 text-xs font-semibold text-amber-800">Drafts — saved, nothing reserved</p>
          <div className="divide-y divide-slate-100">
            {drafts.map((o) => (
              <div key={o.id} className="flex items-center justify-between px-2 py-2">
                <div>
                  <p className="text-sm font-medium text-slate-900">{o.orderNumber} · {o.orderType.replace("_", " ")}</p>
                  <p className="text-xs text-slate-500">{o.outlet.name} · {formatCurrency(o.total)}</p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <Link href={`/sfa/order/new?draft=${o.id}`} className="text-blue-600 underline">Amend</Link>
                  <form action={deleteDraftAction}><input type="hidden" name="id" value={o.id} /><button className="text-rose-600 underline" type="submit">Delete</button></form>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card divide-y divide-slate-100 p-2">
        {rest.map((o) => {
          const pend = o.approvals.filter((a) => a.status === "pending");
          return (
            <div key={o.id} className={`px-2 py-3 ${highlight === o.orderNumber ? "rounded-lg bg-emerald-50" : ""}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-900">{o.orderNumber} <span className="text-[10px] font-normal text-slate-400">{o.orderType === "van_sale" ? "van sale" : "pre-sales"}</span></p>
                  <p className="text-xs text-slate-500">{o.outlet.name} · {formatDate(o.orderDate)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-slate-900">{formatCurrency(o.total)}</p>
                  <StatusBadge status={o.status} />
                </div>
              </div>
              {pend.length > 0 && <p className="mt-1 text-[11px] text-amber-700">Waiting for approval: {pend.map((a) => a.type.replace(/_/g, " ")).join(", ")}</p>}
              {o.invoices.map((inv) => (
                <p key={inv.id} className="mt-1 text-xs text-slate-400">
                  Invoice <Link href={`/sfa/invoice/${inv.id}`} className="text-blue-600 hover:underline">{inv.invoiceNumber}</Link> — {inv.status.replace("_", " ")} · {inv.deliveryStatus.replace(/_/g, " ")}
                </p>
              ))}
            </div>
          );
        })}
        {rest.length === 0 && <p className="px-2 py-4 text-sm text-slate-400">No orders yet.</p>}
      </div>
    </div>
  );
}
