import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import StatusBadge from "@/components/StatusBadge";
import Banner from "@/components/Banner";
import PrintButton from "@/components/PrintButton";
import { formatDate, formatDateTime } from "@/lib/format";
import { generatePicklist, recordPicks, overridePickLot, reprintPicklist, cancelPicklist } from "@/app/actions/sales-actions";
import { fefoMode, availableOf } from "@/lib/stock";

export default async function PicklistsPage({ searchParams }: { searchParams: Promise<{ pl?: string; print?: string; route?: string; error?: string; notice?: string }> }) {
  const { branchId } = await getSession();
  const { pl, print, route, error, notice } = await searchParams;
  const mode = await fefoMode();

  const [orders, picklists, routes] = await Promise.all([
    branchId
      ? prisma.salesOrder.findMany({
          where: { branchId, status: "confirmed", picklistLines: { none: { picklist: { status: { in: ["generated", "in_progress", "picked"] } } } }, ...(route ? { outlet: { routeId: route } } : {}) },
          include: { outlet: { include: { route: true } }, lines: true },
          orderBy: { requestedDeliveryDate: "asc" },
        })
      : Promise.resolve([]),
    branchId ? prisma.picklist.findMany({ where: { branchId }, orderBy: { createdAt: "desc" }, take: 20, include: { lines: true } }) : Promise.resolve([]),
    prisma.route.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
  ]);
  const shown = pl ? await prisma.picklist.findUnique({ where: { id: pl }, include: { lines: { orderBy: { location: "asc" } } } }) : null;
  const detail = shown
    ? await (async () => {
        const [orderRows, products] = await Promise.all([
          prisma.salesOrder.findMany({ where: { id: { in: [...new Set(shown.lines.map((l) => l.salesOrderId))] } }, include: { outlet: true } }),
          prisma.product.findMany({ where: { id: { in: shown.lines.map((l) => l.productId) } } }),
        ]);
        const lots = branchId
          ? await prisma.stockBalance.findMany({ where: { warehouse: { branchId }, productId: { in: shown.lines.map((l) => l.productId) }, qtyGood: { gt: 0 } } })
          : [];
        return { orderRows, products, lots };
      })()
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Picklists</h2>
        <p className="mt-1 text-xs text-slate-500">
          A picklist tells warehouse staff what to pick: generated only from confirmed, allocated orders (one order, or a group sharing a route or date), lines sorted by warehouse location,
          and — for lot-tracked SKUs — the lot and expiry to pick under FEFO. Record what was actually picked; a short pick adjusts the order before it is invoiced. FEFO mode is{" "}
          <strong>{mode}</strong>{mode === "enforce" ? " (only the suggested lot can be picked)" : " (staff may change a lot with a recorded reason)"}.
        </p>
      </div>
      <Banner error={error} notice={notice} />

      {shown && detail && (
        <div className="card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 no-print">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              {shown.picklistNumber} <StatusBadge status={shown.status} />
              {shown.groupLabel && <span className="text-xs font-normal text-slate-500">{shown.groupLabel}</span>}
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-400">Printed {shown.reprintCount} time(s)</span>
              <form action={reprintPicklist}><input type="hidden" name="id" value={shown.id} /><button className="btn-secondary px-3 py-1 text-xs" type="submit">Reprint (logged)</button></form>
              {print && <PrintButton />}
              {shown.status !== "picked" && shown.status !== "cancelled" && (
                <form action={cancelPicklist}><input type="hidden" name="id" value={shown.id} /><button className="btn-secondary px-3 py-1 text-xs" type="submit">Cancel picklist</button></form>
              )}
            </div>
          </div>
          {shown.reprintCount > 0 && <p className="mb-2 hidden text-xs font-semibold uppercase text-slate-500 print:block">Reprint — copy #{shown.reprintCount}</p>}
          <form action={recordPicks}>
            <input type="hidden" name="id" value={shown.id} />
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th">Location</th>
                  <th className="th">Product</th>
                  <th className="th">Order · customer</th>
                  <th className="th">Lot · expiry</th>
                  <th className="th">To pick</th>
                  <th className="th">Picked</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.lines.map((l) => {
                  const o = detail.orderRows.find((x) => x.id === l.salesOrderId);
                  const p = detail.products.find((x) => x.id === l.productId);
                  const alt = detail.lots.filter((x) => x.productId === l.productId && x.lotNumber !== l.lotNumber && availableOf(x) >= l.qtyToPick);
                  return (
                    <tr key={l.id}>
                      <td className="td text-xs text-slate-500">{l.location}</td>
                      <td className="td font-medium text-slate-900">{p?.name}</td>
                      <td className="td text-xs">{o?.orderNumber}<div className="text-slate-400">{o?.outlet.name}</div></td>
                      <td className="td text-xs">
                        {l.lotNumber} {l.expiryDate && <span className="text-slate-400">· {formatDate(l.expiryDate)}</span>}
                        {l.overrideReason && <div className="text-amber-700">Changed: {l.overrideReason}</div>}
                      </td>
                      <td className="td font-medium">{l.qtyToPick}</td>
                      <td className="td">
                        {shown.status === "picked" || shown.status === "cancelled" ? (
                          <span className={l.qtyPicked !== null && l.qtyPicked < l.qtyToPick ? "font-medium text-amber-700" : ""}>{l.qtyPicked ?? "—"}</span>
                        ) : (
                          <input className="input w-24 no-print" type="number" min={0} max={l.qtyToPick} name={`picked_${l.id}`} defaultValue={l.qtyPicked ?? ""} placeholder={String(l.qtyToPick)} />
                        )}
                        {alt.length > 0 && mode === "suggest" && shown.status !== "picked" && shown.status !== "cancelled" && (
                          <details className="mt-1 no-print">
                            <summary className="cursor-pointer text-[11px] text-blue-600">Pick a different lot…</summary>
                            <div className="mt-1 grid gap-1">
                              <select className="input py-1 text-xs" name={`newlot_${l.id}`} form={`ov_${l.id}`}>
                                {alt.map((a) => (
                                  <option key={a.id} value={a.lotNumber}>{a.lotNumber} ({availableOf(a)} avail.)</option>
                                ))}
                              </select>
                              <input className="input py-1 text-xs" name={`why_${l.id}`} form={`ov_${l.id}`} placeholder="Reason (required)" />
                              <button className="btn-secondary px-2 py-1 text-xs" form={`ov_${l.id}`} type="submit">Change lot</button>
                            </div>
                          </details>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {shown.status !== "picked" && shown.status !== "cancelled" && (
              <div className="mt-3 flex items-center gap-3 no-print">
                <button className="btn-primary" type="submit">Record picks</button>
                <span className="text-xs text-slate-500">Leave a line blank to save progress. A short pick keeps the shortfall as backorder and adjusts the order before invoicing.</span>
              </div>
            )}
          </form>
          {/* override forms live outside the picks form so they submit independently */}
          {shown.lines.map((l) => (
            <OverrideForm key={l.id} lineId={l.id} />
          ))}
          {shown.pickedBy && <p className="mt-3 text-xs text-slate-500">Picked by {shown.pickedBy} · {shown.pickedAt && formatDateTime(shown.pickedAt)}</p>}
        </div>
      )}

      <div className="card p-5 no-print">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Generate a picklist from allocated orders</h3>
          <form method="get" className="flex items-center gap-2">
            <select name="route" defaultValue={route ?? ""} className="input py-1 text-xs">
              <option value="">All routes</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <button className="btn-secondary px-3 py-1 text-xs" type="submit">Filter by route</button>
          </form>
        </div>
        <form action={generatePicklist}>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th"></th>
                <th className="th">Order</th>
                <th className="th">Customer</th>
                <th className="th">Route</th>
                <th className="th">Delivery</th>
                <th className="th">Lines</th>
                <th className="th">Allocation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="td"><input type="checkbox" name="orderIds" value={o.id} disabled={o.allocationStatus === "not_allocated"} /></td>
                  <td className="td font-medium text-slate-900"><Link className="hover:underline" href={`/supervisor/orders/${o.id}`}>{o.orderNumber}</Link></td>
                  <td className="td">{o.outlet.name}</td>
                  <td className="td text-xs">{o.outlet.route?.name ?? "—"}</td>
                  <td className="td text-xs">{o.requestedDeliveryDate ? formatDate(o.requestedDeliveryDate) : "—"}</td>
                  <td className="td">{o.lines.length}</td>
                  <td className="td"><StatusBadge status={o.allocationStatus} /></td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td className="td text-slate-400" colSpan={7}>No confirmed, allocated orders are waiting for a picklist.</td>
                </tr>
              )}
            </tbody>
          </table>
          {orders.length > 0 && <button className="btn-primary mt-3" type="submit">Generate picklist for the selected orders</button>}
        </form>
      </div>

      <div className="card overflow-x-auto no-print">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Picklist</th>
              <th className="th">Created</th>
              <th className="th">Covers</th>
              <th className="th">Lines</th>
              <th className="th">Status</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {picklists.map((p) => (
              <tr key={p.id}>
                <td className="td font-medium text-slate-900">{p.picklistNumber}</td>
                <td className="td text-xs">{formatDateTime(p.createdAt)}<div className="text-slate-400">{p.generatedBy}</div></td>
                <td className="td text-xs">{p.groupLabel ?? "1 order"}</td>
                <td className="td">{p.lines.length}</td>
                <td className="td"><StatusBadge status={p.status} /></td>
                <td className="td text-right"><Link className="text-xs text-blue-600 hover:underline" href={`/branch/picklists?pl=${p.id}`}>Open</Link></td>
              </tr>
            ))}
            {picklists.length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={6}>No picklists yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Each lot override is its own small form (the fields above reference it by id).
function OverrideForm({ lineId }: { lineId: string }) {
  return (
    <form id={`ov_${lineId}`} action={async (fd: FormData) => {
      "use server";
      const newLot = String(fd.get(`newlot_${lineId}`) ?? "");
      const reason = String(fd.get(`why_${lineId}`) ?? "");
      const out = new FormData();
      out.set("lineId", lineId);
      out.set("newLot", newLot);
      out.set("reason", reason);
      await overridePickLot(out);
    }} />
  );
}
