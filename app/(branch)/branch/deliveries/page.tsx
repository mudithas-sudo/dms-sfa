import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import StatusBadge from "@/components/StatusBadge";
import Banner from "@/components/Banner";
import DeliveryForm from "@/components/DeliveryForm";
import OutletMap from "@/components/OutletMap";
import { Avatar, CallButton, ProgressTrack } from "@/components/Tracking";
import { MapPin, PackageCheck } from "lucide-react";
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

  const PROGRESS: Record<string, number> = { pending_delivery: 0.1, redelivery_scheduled: 0.3, out_for_delivery: 0.55 };
  const DONE: Record<string, number> = { pending_delivery: 0, redelivery_scheduled: 0, out_for_delivery: 1 };
  const PIN: Record<string, string> = { pending_delivery: "#3558f0", redelivery_scheduled: "#8f98b0", out_for_delivery: "#1d3280" };
  const outCount = pending.filter((i) => i.deliveryStatus === "out_for_delivery").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-3xl">
          <h2 className="text-lg font-bold text-slate-900">Deliveries &amp; Undelivered Balances</h2>
          <p className="mt-1 text-sm text-slate-500">
            Invoiced goods are dispatched, then handed over with the customer&apos;s signature. If a customer accepts fewer units than invoiced, the delivery is recorded as partial, the receivable is adjusted to
            what was delivered, and the remainder is tracked here until it is re-delivered, returned to stock or cancelled — it cannot be forgotten.
          </p>
        </div>
        <div className="segmented" role="group" aria-label="Summary">
          <span className="inline-flex min-h-[36px] items-center rounded-full bg-white px-4 text-xs font-semibold text-slate-900 shadow-sm">{pending.length} awaiting</span>
          <span className="inline-flex min-h-[36px] items-center px-4 text-xs font-semibold text-slate-500">{outCount} on the road</span>
          <span className="inline-flex min-h-[36px] items-center px-4 text-xs font-semibold text-slate-500">{balances.length} undelivered</span>
        </div>
      </div>
      <Banner error={error} notice={notice} />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-slate-900">Awaiting delivery ({pending.length})</h3>
          {pending.map((i, n) => (
            <div key={i.id} className="card overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 p-4">
                <Avatar name={i.outlet.name} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-900">{i.outlet.name}</p>
                  <p className="flex items-center gap-1 truncate text-xs text-slate-500"><MapPin size={12} className="shrink-0" />{i.outlet.address}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-slate-900">{formatCurrency(i.amount)}</p>
                  <p className="text-xs text-slate-500">{i.invoiceNumber} · {i.salesOrder.orderNumber}</p>
                </div>
              </div>
              <ProgressTrack
                at={PROGRESS[i.deliveryStatus] ?? 0.1}
                doneThrough={DONE[i.deliveryStatus] ?? 0}
                steps={[{ label: "Invoiced", note: formatDate(i.invoiceDate) }, { label: "Out for delivery" }, { label: "Delivered" }]}
              />
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-bold text-slate-600 ring-1 ring-inset ring-slate-200" title="Pin number on the map">{n + 1}</span>
                <StatusBadge status={i.deliveryStatus} />
                {i.outlet.contactPerson && <span className="text-xs text-slate-500">{i.outlet.contactPerson}</span>}
                <CallButton phone={i.outlet.phone} label={i.outlet.contactPerson ?? i.outlet.name} />
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {i.deliveryStatus === "pending_delivery" && (
                    <form action={markOutForDelivery}><input type="hidden" name="invoiceId" value={i.id} /><button className="btn-secondary px-4 py-1.5 text-xs" type="submit">Mark out for delivery</button></form>
                  )}
                  <Link className="btn-primary px-4 py-1.5 text-xs" href={`/branch/deliveries?inv=${i.id}`}>Record delivery</Link>
                </div>
              </div>
              {openInv === i.id && (
                <div className="border-t border-slate-100 p-4">
                  <DeliveryForm invoiceId={i.id} lines={i.lines.map((l) => ({ id: l.id, name: pname.get(l.productId) ?? l.productId, qty: l.qty }))} />
                </div>
              )}
            </div>
          ))}
          {pending.length === 0 && <p className="card p-6 text-center text-sm text-slate-400">Nothing is waiting for delivery.</p>}
        </div>

        <aside className="card space-y-3 p-4 xl:sticky xl:top-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><PackageCheck size={16} className="text-blue-600" />Delivery run</h3>
            <span className="text-xs text-slate-500">{pending.length} drops</span>
          </div>
          <OutletMap linkTo={null} height={300} pins={pending.map((i, n) => ({ id: i.id, name: i.outlet.name, lat: i.outlet.lat, lng: i.outlet.lng, color: PIN[i.deliveryStatus], label: String(n + 1) }))} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-600" />Awaiting</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-900" />On the road</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-slate-400" />Re-delivery</span>
          </div>
        </aside>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-bold text-slate-900">Undelivered balances ({balances.length})</h3>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-100">
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
        <h3 className="mb-3 text-sm font-bold text-slate-900">Recent delivery receipts</h3>
        <ul className="divide-y divide-slate-100 text-sm text-slate-700">
          {recent.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-3">
              <Avatar name={d.invoice.outlet.name} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-900">{d.invoice.outlet.name}</p>
                <p className="truncate text-xs text-slate-500">{d.drNumber} · {d.invoice.invoiceNumber} · signed by {d.signatoryName ?? d.receivedBy}</p>
              </div>
              <StatusBadge status={d.status} />
            </li>
          ))}
          {recent.length === 0 && <li className="text-slate-400">None yet.</li>}
        </ul>
      </div>
    </div>
  );
}
