import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import Banner from "@/components/Banner";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { ORDER_EDIT_RULES, type Check } from "@/lib/orders";
import { termLabelOf } from "@/lib/reference";
import {
  updateOrderLines, submitDraftOrder, deleteDraftOrder, updateOrderDetails, cancelOrder, issueInvoice,
} from "@/app/actions/sales-actions";
import { requestOrderVoid } from "@/app/actions/supervisor-actions";

const TONE = { pass: "text-emerald-700 bg-emerald-50", warn: "text-amber-800 bg-amber-50", block: "text-rose-800 bg-rose-50" } as const;
const ICON = { pass: "✓", warn: "!", block: "✕" } as const;

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { id } = await params;
  const { error, notice } = await searchParams;
  const order = await prisma.salesOrder.findUnique({
    where: { id },
    include: {
      outlet: true,
      salesperson: true,
      lines: { include: { product: true }, orderBy: { id: "asc" } },
      approvals: { orderBy: { createdAt: "desc" } },
      invoices: { include: { lines: true, deliveryReceipts: { include: { lines: true } }, undelivered: true } },
      picklistLines: { include: { picklist: true } },
    },
  });
  if (!order) notFound();
  const allocs = await prisma.orderAllocation.findMany({ where: { salesOrderLineId: { in: order.lines.map((l) => l.id) } } });
  const history = await prisma.auditLog.findMany({ where: { entityId: id }, orderBy: { createdAt: "desc" }, take: 8, include: { user: true } });
  const checks: Check[] = order.validationResult ? JSON.parse(order.validationResult) : [];
  const pending = order.approvals.filter((a) => a.status === "pending");
  const invoice = order.invoices[0];
  const picklists = [...new Map(order.picklistLines.map((p) => [p.picklistId, p.picklist])).values()];
  const status = order.status;
  const canEditLines = status === "draft" || status === "on_hold";
  const canCancelDirect = status === "draft" || status === "on_hold";
  const canCancelApproval = status === "confirmed" || status === "picked";
  const canVoid = ["invoiced", "delivered", "partially_delivered"].includes(status) && !order.approvals.some((a) => a.type === "order_void" && a.status === "pending");
  const voidPending = order.approvals.some((a) => a.type === "order_void" && a.status === "pending");
  const cancelPending = order.approvals.some((a) => a.type === "order_cancel" && a.status === "pending");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Link href="/supervisor/orders" className="hover:underline">Orders</Link>
        <span>/</span>
        <span className="text-slate-900">{order.orderNumber}</span>
      </div>
      <Banner error={error} notice={notice} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{order.orderNumber} — {order.outlet.name}</h2>
          <p className="text-xs text-slate-500">
            {order.source === "backend" ? "Backend entry" : "From the SFA app"} ({order.orderType === "van_sale" ? "van sale" : "pre-sales"}) by {order.salesperson.name} · {formatDateTime(order.orderDate)} ·{" "}
            {await termLabelOf(order.paymentTerms ?? order.outlet.paymentTerms)}
            {order.requestedDeliveryDate && ` · delivery requested ${formatDate(order.requestedDeliveryDate)}`}
          </p>
          {order.remarks && <p className="text-xs text-slate-500">Remarks: {order.remarks}</p>}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={order.allocationStatus === "not_allocated" ? status : status} />
          {order.allocationStatus !== "not_allocated" && <StatusBadge status={order.allocationStatus} />}
        </div>
      </div>

      {pending.length > 0 && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Held for approval:
          <ul className="ml-4 list-disc">
            {pending.map((a) => (
              <li key={a.id}><span className="capitalize">{a.type.replace(/_/g, " ")}</span> — {a.reason}</li>
            ))}
          </ul>
          Decide from <Link href="/supervisor/approvals" className="underline">Approvals</Link>.
        </div>
      )}
      {order.creditHoldReason && status === "on_hold" && pending.length === 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{order.creditHoldReason}</p>}

      {checks.length > 0 && (
        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Validation results (stored with the order)</h3>
          <ul className="grid gap-1.5 md:grid-cols-2">
            {checks.map((c) => (
              <li key={c.id} className={`rounded-md px-2.5 py-1.5 text-xs ${TONE[c.outcome]}`}>
                <span className="mr-1 font-bold">{ICON[c.outcome]}</span>
                <span className="font-medium">{c.label}:</span> {c.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Order lines</h3>
        {canEditLines ? (
          <form action={updateOrderLines} className="card overflow-x-auto">
            <input type="hidden" name="id" value={order.id} />
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th">Product</th>
                  <th className="th">Qty (editable)</th>
                  <th className="th">Unit price</th>
                  <th className="th">Discount</th>
                  <th className="th">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {order.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="td font-medium text-slate-900">{l.product.name}</td>
                    <td className="td"><input className="input w-24" type="number" min={0} name={`qty_${l.productId}`} defaultValue={l.qty} /></td>
                    <td className="td">{formatCurrency(l.unitPrice)}</td>
                    <td className="td">{formatCurrency(l.discount)}</td>
                    <td className="td">{formatCurrency(l.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 p-3">
              <button className="btn-secondary" type="submit">Save lines (re-price &amp; re-validate)</button>
              <span className="text-xs text-slate-500">Total {formatCurrency(order.total)}</span>
            </div>
          </form>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th">{status === "confirmed" ? "Picklist (FEFO-reserved lots)" : "Product"}</th>
                  <th className="th">Qty</th>
                  <th className="th">Lots reserved / dispatched</th>
                  <th className="th">Backorder</th>
                  <th className="th">Picked</th>
                  <th className="th">Delivered</th>
                  <th className="th">Unit price</th>
                  <th className="th">Discount</th>
                  <th className="th">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {order.lines.map((l) => {
                  const a = allocs.filter((x) => x.salesOrderLineId === l.id && x.status !== "released");
                  return (
                    <tr key={l.id}>
                      <td className="td font-medium text-slate-900">{l.product.name}</td>
                      <td className="td">{l.qty}</td>
                      <td className="td text-xs">{a.length ? a.map((x) => `${x.lotNumber} × ${x.qty}${x.status === "dispatched" ? " ✓" : ""}`).join(", ") : l.reservedLotNumber ?? "—"}</td>
                      <td className={`td ${l.qtyBackorder > 0 ? "font-medium text-amber-700" : ""}`}>{l.qtyBackorder || "—"}</td>
                      <td className="td">{l.qtyPicked ?? "—"}</td>
                      <td className={`td ${l.qtyDelivered !== null && l.qtyDelivered < l.qty ? "font-medium text-amber-600" : ""}`}>{l.qtyDelivered ?? "—"}</td>
                      <td className="td">{formatCurrency(l.unitPrice)}</td>
                      <td className="td">{formatCurrency(l.discount)}</td>
                      <td className="td">{formatCurrency(l.lineTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200">
                  <td className="td font-semibold" colSpan={8}>Order total</td>
                  <td className="td font-semibold">{formatCurrency(order.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3 p-5">
          <h3 className="text-sm font-semibold text-slate-900">Next steps</h3>
          {status === "draft" && (
            <div className="flex flex-wrap gap-2">
              <form action={submitDraftOrder}><input type="hidden" name="id" value={order.id} /><button className="btn-primary" type="submit">Submit (validate &amp; allocate)</button></form>
              <form action={deleteDraftOrder}><input type="hidden" name="id" value={order.id} /><button className="btn-secondary" type="submit">Delete draft</button></form>
            </div>
          )}
          {status === "confirmed" && (
            <p className="text-sm text-slate-700">
              Allocated and confirmed. Generate a picklist in <Link className="text-blue-600 underline" href="/branch/picklists">Picklists</Link>
              {picklists.length > 0 && <> — already on {picklists.map((p) => p.picklistNumber).join(", ")}</>}.
            </p>
          )}
          {status === "picked" && (
            <form action={issueInvoice}>
              <input type="hidden" name="orderId" value={order.id} />
              <button className="btn-primary" type="submit">Issue invoice &amp; dispatch stock</button>
              <p className="mt-1 text-xs text-slate-500">The invoice is built from what was picked; a short pick is invoiced as picked and the rest stays backorder.</p>
            </form>
          )}
          {["invoiced"].includes(status) && invoice && <p className="text-sm text-slate-700">Invoice issued — record the delivery in <Link className="text-blue-600 underline" href="/branch/deliveries">Deliveries</Link>.</p>}
          {canEditLines || status === "confirmed" ? (
            <form action={updateOrderDetails} className="grid gap-2 border-t border-slate-100 pt-3">
              <input type="hidden" name="id" value={order.id} />
              <p className="text-xs text-slate-500">{status === "confirmed" ? "Only remarks and the delivery date can change now." : "Remarks and delivery date"}</p>
              <input className="input" name="remarks" defaultValue={order.remarks ?? ""} placeholder="Remarks" />
              <input className="input max-w-[200px]" name="requestedDeliveryDate" type="date" defaultValue={order.requestedDeliveryDate?.toISOString().slice(0, 10)} />
              <button className="btn-secondary w-fit" type="submit">Save</button>
            </form>
          ) : null}
          {(canCancelDirect || canCancelApproval) && !cancelPending && (
            <form action={cancelOrder} className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              <input type="hidden" name="id" value={order.id} />
              <input className="input max-w-xs" name="reason" placeholder="Reason code / comment" required />
              <button className="btn-danger" type="submit">{canCancelApproval ? "Request cancellation" : "Cancel order"}</button>
              {canCancelApproval && <span className="w-full text-xs text-slate-500">Reserved stock is released and the open picklist cancelled once a supervisor approves.</span>}
            </form>
          )}
          {cancelPending && <p className="text-xs text-amber-700">Cancellation is pending approval.</p>}
          {canVoid && (
            <form action={requestOrderVoid} className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              <input type="hidden" name="salesOrderId" value={order.id} />
              <input className="input max-w-xs" name="reason" placeholder="Void reason" required />
              <button className="btn-danger" type="submit">Request void</button>
              <span className="w-full text-xs text-slate-500">Reverses stock and the receivable; the number is retained and never reused.</span>
            </form>
          )}
          {voidPending && <p className="text-xs text-amber-700">Void is pending approval.</p>}
          {status === "voided" && <p className="text-sm text-rose-700">Cancelled / voided — {order.voidReason}</p>}
        </div>

        <div className="card p-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">What can be edited at each status</h3>
          <ul className="space-y-1.5 text-xs">
            {ORDER_EDIT_RULES.map((r) => (
              <li key={r.status} className={`rounded-md px-2 py-1 ${r.status === status ? "bg-blue-50 text-blue-900 ring-1 ring-blue-200" : "text-slate-600"}`}>
                <span className="font-medium">{r.label}:</span> {r.editable}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {invoice && (
        <div className="card p-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Invoice {invoice.invoiceNumber}</h3>
            <div className="flex items-center gap-2">
              <StatusBadge status={invoice.status} />
              <StatusBadge status={invoice.deliveryStatus} />
              <Link className="text-xs text-blue-600 hover:underline" href={`/supervisor/invoices/${invoice.id}`}>Open invoice</Link>
            </div>
          </div>
          <p className="text-sm text-slate-700">
            {formatCurrency(invoice.amount)} (incl. VAT {formatCurrency(invoice.taxAmount)}) · due {formatDate(invoice.dueDate)}
          </p>
          {invoice.deliveryReceipts.map((dr) => (
            <p key={dr.id} className="mt-1 text-xs text-slate-500">
              {dr.drNumber}: <span className="capitalize">{dr.status}</span> · received by {dr.receivedBy} · {dr.lines.map((l) => `${l.qtyDelivered}/${l.qtyOrdered}`).join(", ")}
            </p>
          ))}
          {invoice.undelivered.length > 0 && (
            <p className="mt-2 text-xs text-amber-700">Undelivered balance: {invoice.undelivered.map((u) => `${u.qty} unit(s) — ${u.status.replace(/_/g, " ")}`).join("; ")}</p>
          )}
        </div>
      )}

      <div className="card p-5">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">History</h3>
        <ul className="space-y-1 text-xs text-slate-600">
          {history.map((h) => (
            <li key={h.id}><span className="text-slate-400">{formatDateTime(h.createdAt)}</span> · {h.user.name} · {h.summary}</li>
          ))}
          {history.length === 0 && <li className="text-slate-400">No recorded events.</li>}
        </ul>
      </div>
    </div>
  );
}
