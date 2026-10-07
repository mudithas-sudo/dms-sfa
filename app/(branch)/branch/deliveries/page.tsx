import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import StatusBadge from "@/components/StatusBadge";
import Banner from "@/components/Banner";
import DeliveryForm from "@/components/DeliveryForm";
import { formatCurrency, formatDate } from "@/lib/format";
import { markOutForDelivery, resolveUndelivered } from "@/app/actions/sales-actions";

export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; inv?: string }> }) {
  const { branchId } = await getSession();
  const { error, notice, inv: openInv } = await searchParams;
  const [pending, recent, balances, products] = await Promise.all([
    branchId
      ? prisma.invoice.findMany({
          where: { branchId, deliveryStatus: { in: ["pending_delivery", "out_for_delivery", "redelivery_scheduled"] }, status: { not: "voided" }, salesOrder: { source: "backend" } },
          include: { outlet: true, lines: true, salesOrder: true },
          orderBy: { invoiceDate: "asc" },
        })
      : Promise.resolve([]),
    branchId
      ? prisma.deliveryReceipt.findMany({ where: { invoice: { branchId } }, include: { invoice: { include: { outlet: true } }, lines: true }, orderBy: { deliveredAt: "desc" }, take: 8 })
      : Promise.resolve([]),
    branchId ? prisma.undeliveredBalance.findMany({ where: { invoice: { branchId }, status: { in: ["open", "redelivery_scheduled"] } }, include: { invoice: { include: { outlet: true } } }, orderBy: { createdAt: "asc" } }) : Promise.resolve([]),
    prisma.product.findMany({ select: { id: true, name: true } }),
  ]);
  const pname = new Map(products.map((p) => [p.id, p.name]));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Deliveries &amp; Undelivered Balances</h2>
        <p className="mt-1 text-xs text-slate-500">
          Invoiced goods are dispatched, then handed over with the customer&apos;s signature. If a customer accepts fewer units than invoiced, the delivery is recorded as partial, the receivable is adjusted to
          what was delivered, and the remainder is tracked here until it is re-delivered, returned to stock or cancelled — it cannot be forgotten.
        </p>
      </div>
      <Banner error={error} notice={notice} />

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Awaiting delivery ({pending.length})</h3>
        {pending.map((i) => (
          <div key={i.id} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-900">
                {i.invoiceNumber} · {i.outlet.name} <span className="text-xs font-normal text-slate-500">· {formatCurrency(i.amount)} · {i.salesOrder.orderNumber}</span>
              </p>
              <div className="flex items-center gap-2">
                <StatusBadge status={i.deliveryStatus} />
                {i.deliveryStatus === "pending_delivery" && (
                  <form action={markOutForDelivery}><input type="hidden" name="invoiceId" value={i.id} /><button className="btn-secondary px-3 py-1 text-xs" type="submit">Mark out for delivery</button></form>
                )}
                <Link className="text-xs text-blue-600 hover:underline" href={`/branch/deliveries?inv=${i.id}`}>Record delivery</Link>
              </div>
            </div>
            {openInv === i.id && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <DeliveryForm invoiceId={i.id} lines={i.lines.map((l) => ({ id: l.id, name: pname.get(l.productId) ?? l.productId, qty: l.qty }))} />
              </div>
            )}
          </div>
        ))}
        {pending.length === 0 && <p className="text-sm text-slate-400">Nothing is waiting for delivery.</p>}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Undelivered balances ({balances.length})</h3>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Invoice · customer</th>
                <th className="th">Product</th>
                <th className="th">Qty</th>
                <th className="th">Reason</th>
                <th className="th">Status</th>
                <th className="th">Resolve</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {balances.map((b) => (
                <tr key={b.id} className="align-top">
                  <td className="td text-xs"><span className="font-medium text-slate-900">{b.invoice.invoiceNumber}</span><div className="text-slate-400">{b.invoice.outlet.name}</div></td>
                  <td className="td">{pname.get(b.productId)}</td>
                  <td className="td">{b.qty}</td>
                  <td className="td text-xs">{b.reason}</td>
                  <td className="td"><StatusBadge status={b.status} />{b.redeliveryDate && <div className="mt-1 text-[11px] text-slate-500">{formatDate(b.redeliveryDate)}</div>}</td>
                  <td className="td">
                    <form action={resolveUndelivered} className="grid w-56 gap-1">
                      <input type="hidden" name="id" value={b.id} />
                      {b.status === "open" ? (
                        <>
                          <input className="input py-1 text-xs" type="date" name="redeliveryDate" />
                          <button className="btn-secondary px-2 py-1 text-xs" type="submit" name="action" value="redeliver">Schedule re-delivery</button>
                        </>
                      ) : (
                        <button className="btn-primary px-2 py-1 text-xs" type="submit" name="action" value="complete">Re-delivery done</button>
                      )}
                      <div className="flex gap-1">
                        <select className="input py-1 text-xs" name="condition" defaultValue="good">
                          <option value="good">Return as good</option>
                          <option value="damaged">Return as damaged</option>
                        </select>
                      </div>
                      <div className="flex gap-1">
                        <button className="btn-secondary flex-1 px-2 py-1 text-xs" type="submit" name="action" value="return">Return to stock</button>
                        <button className="btn-secondary flex-1 px-2 py-1 text-xs" type="submit" name="action" value="cancel">Cancel balance</button>
                      </div>
                    </form>
                  </td>
                </tr>
              ))}
              {balances.length === 0 && (
                <tr>
                  <td className="td text-slate-400" colSpan={6}>No open undelivered balances.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Recent delivery receipts</h3>
        <ul className="space-y-1 text-sm text-slate-700">
          {recent.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2">
              <span>{d.drNumber} · {d.invoice.invoiceNumber} · {d.invoice.outlet.name} · signed by {d.signatoryName ?? d.receivedBy}</span>
              <StatusBadge status={d.status} />
            </li>
          ))}
          {recent.length === 0 && <li className="text-slate-400">None yet.</li>}
        </ul>
      </div>
    </div>
  );
}
