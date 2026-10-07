import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { formatDateTime } from "@/lib/format";
import Banner from "@/components/Banner";
import StatusBadge from "@/components/StatusBadge";
import PhotoCapture from "@/components/PhotoCapture";
import StockRequestForm from "@/components/StockRequestForm";
import { getRepVan, pendingAckByProduct, dayStart } from "@/lib/van";
import { availableOf } from "@/lib/stock";
import { suggestedVanQty } from "@/app/actions/sfa-actions";
import { acknowledgeVanLoad, markVanDamaged, requestVanDamageReversal, cancelStockRequest, initiateVanReturn, submitVanCount } from "@/app/actions/van-actions";

const DAMAGE_REASONS = ["Broken", "Leaking", "Expired", "Crushed packaging", "Customer return"];

export default async function VanStockPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { userId, branchId } = await getSession();
  if (!userId || !branchId) return <p className="text-sm text-slate-500">No rep selected.</p>;
  const { error, notice } = await searchParams;
  const rep = await prisma.user.findUnique({ where: { id: userId } });
  const van = rep ? await getRepVan(branchId, rep) : null;
  if (!van) return <div className="space-y-3"><Banner error="No active van is assigned to you — ask your supervisor." /></div>;

  const wh = await prisma.warehouse.findFirst({ where: { branchId, type: "saleable", status: "active" } });
  const [stock, products, loads, requests, whRows, returnsOpen, pend] = await Promise.all([
    prisma.stockBalance.findMany({ where: { locationType: "van", vanId: van.id }, include: { product: true }, orderBy: { product: { name: "asc" } } }),
    prisma.product.findMany({ where: { status: "active" }, orderBy: [{ displayOrder: "asc" }, { name: "asc" }] }),
    prisma.vanLoad.findMany({ where: { vanId: van.id, status: { in: ["loaded", "approved"] }, confirmedAt: null }, include: { lines: { include: { product: true } } }, orderBy: { loadedAt: "desc" } }),
    prisma.replenishmentRequest.findMany({ where: { vanId: van.id }, orderBy: { createdAt: "desc" }, take: 6, include: { lines: true } }),
    wh ? prisma.stockBalance.findMany({ where: { warehouseId: wh.id } }) : Promise.resolve([]),
    prisma.vanReturn.findMany({ where: { vanId: van.id, status: { in: ["initiated", "variance_pending"] } }, orderBy: { createdAt: "desc" } }),
    pendingAckByProduct(van.id),
  ]);
  const suggested: Record<string, number> = {};
  await Promise.all(products.map(async (p) => { suggested[p.id] = await suggestedVanQty(van.id, p.id); }));
  const vanBal = (pid: string) => stock.filter((s) => s.productId === pid).reduce((a, s) => a + s.qtyGood, 0);
  const whAvail = (pid: string) => whRows.filter((r) => r.productId === pid).reduce((a, r) => a + availableOf(r), 0);
  const pname = new Map(products.map((p) => [p.id, p.name]));
  const todayStr = dayStart().toISOString().slice(0, 10);
  const returning = new Map<string, number>();
  for (const r of returnsOpen) if (r.condition === "good") returning.set(r.productId, (returning.get(r.productId) ?? 0) + (r.qtyDeclared ?? r.qty));

  return (
    <div className="space-y-4">
      <Banner error={error} notice={notice} />
      <div className="card p-4">
        <h2 className="text-base font-semibold text-slate-900">Van Stock</h2>
        <p className="text-xs text-slate-500">{van.code} · {van.plateNo} — stock request, loading, damage, returns and counts</p>
      </div>

      {loads.map((l) => (
        <form key={l.id} action={acknowledgeVanLoad} className="card border-amber-200 bg-amber-50 p-4">
          <input type="hidden" name="vanLoadId" value={l.id} />
          <p className="text-sm font-medium text-amber-900">{l.loadNumber} loaded — confirm what you received</p>
          <p className="text-xs text-amber-800">Posted {formatDateTime(l.loadedAt)} · you can sell it only after you confirm</p>
          <div className="mt-2 space-y-1.5">
            {l.lines.map((line) => (
              <div key={line.id} className="grid grid-cols-[1fr_64px] items-center gap-2 text-xs">
                <span className="text-amber-900">{line.product.name} — issued {line.qty} (lot {line.lotNumber})</span>
                <input className="input py-1 text-xs" type="number" min={0} max={line.qty} name={`recv_${line.id}`} defaultValue={line.qty} />
                <input className="input col-span-2 py-1 text-xs" name={`why_${line.id}`} placeholder="Reason, only if you received less (e.g. Short supplied)" />
              </div>
            ))}
          </div>
          <button type="submit" className="btn-primary mt-3 w-full text-xs">Confirm loading</button>
        </form>
      ))}

      <div className="card p-2">
        <h3 className="px-2 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Current stock</h3>
        <div className="divide-y divide-slate-100">
          {stock.map((s) => {
            const awaiting = Math.min(s.qtyGood, pend.get(s.productId) ?? 0);
            return (
              <div key={s.id} className="px-2 py-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{s.product.name}</p>
                    <p className="text-xs text-slate-500">
                      {s.product.sku} · Lot {s.lotNumber} · Good {s.qtyGood}
                      {awaiting > 0 && <span className="text-amber-700"> ({awaiting} awaiting your confirmation)</span>}
                      {s.qtyDamaged > 0 && <span className="text-rose-600"> · Damaged {s.qtyDamaged}</span>}
                      {s.qtyExpired > 0 && <span className="text-rose-600"> · Expired {s.qtyExpired}</span>}
                    </p>
                  </div>
                </div>
                {s.qtyGood > 0 && (
                  <details className="mt-1">
                    <summary className="flex min-h-[44px] cursor-pointer items-center text-sm text-rose-600">Mark damaged…</summary>
                    <form action={markVanDamaged} className="mt-1 space-y-1.5">
                      <input type="hidden" name="stockBalanceId" value={s.id} />
                      <div className="flex gap-1.5">
                        <input className="input w-16 py-1 text-xs" type="number" name="qty" min={1} max={s.qtyGood} placeholder="qty" required />
                        <select className="input py-1 text-xs" name="reason" defaultValue="" required>
                          <option value="" disabled>Reason</option>
                          {DAMAGE_REASONS.map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      </div>
                      <PhotoCapture label="Photo (required for large quantities)" max={1} />
                      <button type="submit" className="btn-secondary w-full py-1 text-xs">Move to damaged</button>
                    </form>
                  </details>
                )}
                {(s.qtyDamaged > 0 || s.qtyExpired > 0) && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-emerald-700">Back to good (needs approval)…</summary>
                    <form action={requestVanDamageReversal} className="mt-1 flex flex-wrap gap-1.5">
                      <input type="hidden" name="stockBalanceId" value={s.id} />
                      <select className="input w-24 py-1 text-xs" name="from" defaultValue={s.qtyDamaged > 0 ? "damaged" : "expired"}>
                        {s.qtyDamaged > 0 && <option value="damaged">Damaged</option>}
                        {s.qtyExpired > 0 && <option value="expired">Expired</option>}
                      </select>
                      <input className="input w-14 py-1 text-xs" type="number" name="qty" min={1} placeholder="qty" required />
                      <input className="input min-w-0 flex-1 py-1 text-xs" name="reason" placeholder="Why it is fine" required />
                      <button type="submit" className="btn-secondary py-1 text-xs">Request</button>
                    </form>
                  </details>
                )}
              </div>
            );
          })}
          {stock.length === 0 && <p className="px-2 py-3 text-xs text-slate-400">No stock loaded on this van.</p>}
        </div>
      </div>

      <div className="card p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Request stock</h3>
        <p className="mb-2 text-xs text-slate-500">One active request per van and day. The warehouse supervisor may approve it in full, with reduced quantities, or reject it — you are notified on the device.</p>
        <StockRequestForm
          defaultDate={todayStr}
          rows={products.map((p) => ({ id: p.id, name: p.name, sku: p.sku, vanBalance: vanBal(p.id), warehouse: whAvail(p.id), suggested: suggested[p.id] ?? 0 }))}
        />
        <div className="mt-3 space-y-2">
          {requests.map((r) => (
            <div key={r.id} className="rounded-lg border border-slate-200 p-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-900">{r.requestNumber ?? "Request"}</span>
                <StatusBadge status={r.status} />
              </div>
              <p className="mt-1 text-slate-600">
                {r.lines.map((l) => `${pname.get(l.productId)}: ${l.qtyRequested}${l.qtyApproved !== null ? ` → ${l.qtyApproved}` : ""}`).join(" · ") || `${pname.get(r.productId)}: ${r.qtyRequested}`}
              </p>
              {r.decisionNote && <p className="text-slate-500">Supervisor: {r.decisionNote}</p>}
              {["draft", "pending", "approved", "partially_approved"].includes(r.status) && (
                <form action={cancelStockRequest} className="mt-1 flex gap-1">
                  <input type="hidden" name="id" value={r.id} />
                  <button className="text-rose-600 hover:underline" type="submit">Cancel request</button>
                </form>
              )}
            </div>
          ))}
        </div>
      </div>

      {stock.length > 0 && (
        <div className="card p-4">
          <h3 className="mb-1 text-sm font-semibold text-slate-900">Return stock to the warehouse (unloading)</h3>
          <p className="mb-2 text-xs text-slate-500">Enter what you are handing back, by condition. It cannot exceed the van balance; the warehouse clerk counts it and confirms.</p>
          {returnsOpen.length > 0 && (
            <p className="mb-2 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
              Waiting for the warehouse: {[...new Set(returnsOpen.map((r) => r.returnNumber))].join(", ")} {[...returning.entries()].map(([pid, q]) => `${pname.get(pid)} ${q}`).join(", ")}
            </p>
          )}
          <form action={initiateVanReturn} className="space-y-1.5">
            {stock.map((s) => (
              <div key={s.id} className="grid grid-cols-[1fr_52px_52px_52px] items-center gap-1.5 text-xs">
                <span className="truncate text-slate-700">{s.product.name}</span>
                <input className="input py-1 text-xs" type="number" min={0} max={s.qtyGood} name={`good_${s.id}`} placeholder={`G ${s.qtyGood}`} />
                <input className="input py-1 text-xs" type="number" min={0} max={s.qtyDamaged} name={`damaged_${s.id}`} placeholder={`D ${s.qtyDamaged}`} disabled={s.qtyDamaged === 0} />
                <input className="input py-1 text-xs" type="number" min={0} max={s.qtyExpired} name={`expired_${s.id}`} placeholder={`E ${s.qtyExpired}`} disabled={s.qtyExpired === 0} />
              </div>
            ))}
            <p className="text-[10px] text-slate-400">G = good · D = damaged · E = expired</p>
            <select className="input py-1 text-xs" name="reason" defaultValue="Unsold">
              <option>Unsold</option><option>Damaged in transit</option><option>Expired</option><option>Customer return carried on the van</option><option>Other</option>
            </select>
            <button type="submit" className="btn-secondary w-full">Create return</button>
          </form>
        </div>
      )}

      {stock.length > 0 && (
        <div className="card p-4">
          <h3 className="mb-1 text-sm font-semibold text-slate-900">Stock count</h3>
          <p className="mb-2 text-xs text-slate-500">Count the van at the start of day, mid-day, end of day or any time. Enter every product (0 if none). A submitted count is final; differences beyond tolerance need a remark and go to your supervisor.</p>
          <form action={submitVanCount} className="space-y-1.5">
            <div className="flex gap-2">
              <select className="input py-1 text-xs" name="countType" defaultValue="spot">
                <option value="start_of_day">Start of day</option><option value="mid_day">Mid-day</option><option value="end_of_day">End of day</option><option value="spot">Spot count</option>
              </select>
              <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" name="blind" /> Blind</label>
            </div>
            {stock.map((s) => (
              <div key={s.id} className="grid grid-cols-[1fr_56px_56px] items-center gap-1.5 text-xs">
                <span className="truncate text-slate-700">{s.product.name} <span className="text-slate-400">({s.qtyGood})</span></span>
                <input className="input py-1 text-xs" type="number" min={0} name={`cg_${s.id}`} placeholder="good" required />
                <input className="input py-1 text-xs" type="number" min={0} name={`cd_${s.id}`} defaultValue={s.qtyDamaged} />
                <input className="input col-span-3 py-1 text-xs" name={`why_${s.id}`} placeholder="Remark (needed if the difference is beyond tolerance)" />
              </div>
            ))}
            <button type="submit" className="btn-secondary w-full">Submit count</button>
          </form>
        </div>
      )}
    </div>
  );
}
