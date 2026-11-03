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
import { StepTiles, Timeline, type StageTile, type TimelineEvent } from "@/components/OrderSteps";
import { ShoppingCart, BadgeCheck, Package, ReceiptText, Truck, FileText } from "lucide-react";

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
  const [allocs, history, branch] = await Promise.all([
    prisma.orderAllocation.findMany({ where: { salesOrderLineId: { in: order.lines.map((l) => l.id) } } }),
    prisma.auditLog.findMany({ where: { entityId: id }, orderBy: { createdAt: "desc" }, take: 8, include: { user: true } }),
    prisma.branch.findUnique({ where: { id: order.branchId } }),
  ]);
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

  const STAGE: Record<string, number> = { draft: 0, on_hold: 0, confirmed: 1, picked: 2, invoiced: 3, delivered: 4, partially_delivered: 4 };
  const stage = STAGE[status] ?? -1;
  const SENTENCE: Record<string, string> = {
    draft: "Draft — not yet submitted", on_hold: "On hold — waiting for a decision", confirmed: "Confirmed — stock reserved", picked: "Picked — ready to invoice",
    invoiced: "Invoiced — awaiting delivery", delivered: "Delivered to the customer", partially_delivered: "Partly delivered — a balance is open", voided: "Cancelled / voided",
  };
  const stages: StageTile[] = [
    { label: "Order placed", note: formatDate(order.orderDate), icon: ShoppingCart },
    { label: "Confirmed", note: order.allocationStatus === "not_allocated" ? "Stock not yet reserved" : order.allocationStatus.replace(/_/g, " "), icon: BadgeCheck },
    { label: "Picked", note: picklists.length ? picklists.map((x) => x.picklistNumber).join(", ") : "Picklist pending", icon: Package },
    { label: "Invoiced", note: invoice ? invoice.invoiceNumber : "Not yet invoiced", icon: ReceiptText },
    { label: "Delivered", note: invoice ? invoice.deliveryStatus.replace(/_/g, " ") : "Awaiting", icon: Truck },
  ];
  const events: (TimelineEvent & { at: Date })[] = [
    { title: "Order placed", note: `By ${order.salesperson.name}`, at: order.orderDate, when: "" },
    ...(invoice ? [{ title: `Invoice ${invoice.invoiceNumber} issued`, note: formatCurrency(invoice.amount), at: invoice.invoiceDate, when: "" }] : []),
    ...(invoice ? invoice.deliveryReceipts.map((dr) => ({ title: `${dr.drNumber} — ${dr.status}`, note: `Received by ${dr.receivedBy}`, at: dr.deliveredAt, when: "" })) : []),
    ...history.map((h) => ({ title: h.summary, note: h.user.name, at: h.createdAt, when: "" })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .map((e) => ({ title: e.title, note: e.note, when: formatDateTime(e.at), at: e.at }));
  const terms = await termLabelOf(order.paymentTerms ?? order.outlet.paymentTerms);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Link href="/supervisor/orders" className="hover:underline">Orders</Link>
        <span>/</span>
        <span className="text-slate-900">{order.orderNumber}</span>
      </div>
      <Banner error={error} notice={notice} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-3xl font-semibold text-slate-900">Order ID : {order.orderNumber}</h2>
          <p className="mt-1.5 text-sm text-slate-500">
            {order.outlet.name} · {order.source === "backend" ? "Backend entry" : "From the SFA app"} ({order.orderType === "van_sale" ? "van sale" : "pre-sales"}) by {order.salesperson.name} · {formatDateTime(order.orderDate)}
          </p>
        </div>
        {invoice && (
          <Link className="btn-secondary" href={`/supervisor/invoices/${invoice.id}`}>
            <FileText size={16} />Open invoice
          </Link>
        )}
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="card min-w-0 space-y-6 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-base font-medium text-slate-900">
                <span className={`h-2.5 w-2.5 rounded-full ${status === "voided" ? "bg-slate-400" : "bg-blue-600"}`} />
                {SENTENCE[status] ?? status}
              </p>
              <div className="flex items-center gap-2">
                <StatusBadge status={status} />
                {order.allocationStatus !== "not_allocated" && <StatusBadge status={order.allocationStatus} />}
                {invoice && <span className="text-sm text-slate-500">Invoice : {invoice.invoiceNumber}</span>}
              </div>
            </div>
            <StepTiles steps={stages} current={stage} />
            <div className="grid gap-6 border-t border-slate-100 pt-5 md:grid-cols-2">
              <div>
                <h3 className="mb-2 text-base font-medium text-slate-900">Sold from</h3>
                <p className="text-sm text-slate-700">Company F and B{branch ? ` — ${branch.name}` : ""}</p>
                <p className="text-sm text-slate-500">Representative: {order.salesperson.name}</p>
                <p className="text-sm text-slate-500">{terms}</p>
              </div>
              <div>
                <h3 className="mb-2 text-base font-medium text-slate-900">Deliver to</h3>
                <p className="text-sm text-slate-700">{order.outlet.name}</p>
                <p className="text-sm text-slate-500">{order.deliveryAddress ?? order.outlet.address}</p>
                <p className="text-sm text-slate-500">
                  {[order.outlet.contactPerson, order.outlet.phone].filter(Boolean).join(" · ") || "No contact on file"}
                  {order.requestedDeliveryDate && ` · requested ${formatDate(order.requestedDeliveryDate)}`}
                </p>
                {order.remarks && <p className="mt-1 text-sm text-slate-500">Remarks: {order.remarks}</p>}
              </div>
            </div>
            <div className="border-t border-slate-100 pt-5">
              <h3 className="mb-3 text-base font-medium text-slate-900">Order summary</h3>
              <dl className="grid gap-x-10 gap-y-2 text-sm md:grid-cols-2">
                <div className="flex justify-between"><dt className="text-slate-500">Items</dt><dd className="text-slate-800">{order.lines.length} line{order.lines.length === 1 ? "" : "s"}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd className="text-slate-800">{formatCurrency(order.subtotal)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Promotions &amp; discounts</dt><dd className="text-slate-800">−{formatCurrency(order.discountTotal)}</dd></div>
                <div className="flex justify-between"><dt className="font-semibold text-slate-900">Total</dt><dd className="font-semibold text-slate-900">{formatCurrency(order.total)}</dd></div>
              </dl>
            </div>
          </div>
        <aside className="card p-5 xl:sticky xl:top-0">
          <h3 className="text-base font-medium text-slate-900">Order travel</h3>
          <p className="mb-4 text-sm text-slate-500">Every step this order has taken, newest first.</p>
          <Timeline events={events} />
        </aside>
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
                    <td className="td whitespace-nowrap">{formatCurrency(l.unitPrice)}</td>
                    <td className="td whitespace-nowrap">{formatCurrency(l.discount)}</td>
                    <td className="td whitespace-nowrap">{formatCurrency(l.lineTotal)}</td>
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
                      <td className="td whitespace-nowrap">{formatCurrency(l.unitPrice)}</td>
                      <td className="td whitespace-nowrap">{formatCurrency(l.discount)}</td>
                      <td className="td whitespace-nowrap">{formatCurrency(l.lineTotal)}</td>
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

    </div>
  );
}
