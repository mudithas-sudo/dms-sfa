import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import StatusBadge from "@/components/StatusBadge";
import { formatDate, formatDateTime, formatCurrency } from "@/lib/format";
import { startStockCount, submitStockCount, submitRecount, decideStockCount, saveCycleSchedule } from "@/app/actions/inventory-actions";
import { getAllSettings, num } from "@/lib/settings";

const beyond = (variance: number, systemQty: number, tolPct: number) => Math.abs(variance) > Math.max(1, Math.round((systemQty * tolPct) / 100));

export default async function StockCountPage({ searchParams }: { searchParams: Promise<{ count?: string; error?: string; notice?: string }> }) {
  const { branchId } = await getSession();
  const { count: countId, error, notice } = await searchParams;
  const settings = await getAllSettings();
  const warehouses = await prisma.warehouse.findMany({ where: branchId ? { branchId, status: "active", type: "saleable" } : { status: "active" }, orderBy: { name: "asc" } });
  const warehouseIds = warehouses.map((w) => w.id);
  const [counts, categories, products] = await Promise.all([
    prisma.stockCount.findMany({
      where: { warehouseId: { in: warehouseIds } },
      orderBy: { countedAt: "desc" },
      include: { lines: true, warehouse: true },
      take: 12,
    }),
    prisma.product.findMany({ distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } }),
    prisma.product.findMany({ select: { id: true, name: true, unitPrice: true } }),
  ]);
  const prod = new Map(products.map((p) => [p.id, p]));
  const active = countId ? counts.find((c) => c.id === countId) : counts.find((c) => c.status === "open" || c.status === "recount_required");
  const pending = counts.filter((c) => c.status === "pending_approval");
  const activeTol = active ? active.tolerancePct ?? num(settings, "count.tolerancePct") : 0;

  // Cycle schedule: when each category was last cycle-counted against its frequency.
  const lastCycle = new Map<string, Date>();
  for (const c of counts.filter((x) => x.type === "cycle" && x.status === "closed")) {
    const cat = c.scope?.replace("Category: ", "") ?? "";
    if (cat && (!lastCycle.get(cat) || c.countedAt > lastCycle.get(cat)!)) lastCycle.set(cat, c.countedAt);
  }
  const now = new Date();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Physical &amp; Cycle Stock Count</h2>
        <p className="mt-1 text-xs text-slate-500">
          A count takes a snapshot of system quantities, then staff enter what they find. Variances inside the tolerance ({num(settings, "count.tolerancePct")}% by default) are accepted;
          larger ones are recounted and, if they persist, reviewed by a supervisor before posting as stock adjustments (reason: Count variance). Posting is applied relative to the snapshot,
          so sales or receipts during the count do not distort the result.
        </p>
      </div>
      <Banner error={error} notice={notice} />

      {!active && (
        <div className="card max-w-2xl p-6">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Start a count</h3>
          <form action={startStockCount} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Warehouse</label>
                <select className="input" name="warehouseId" required>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Count type</label>
                <select className="input" name="type" defaultValue="full">
                  <option value="full">Full physical count</option>
                  <option value="cycle">Cycle count (subset)</option>
                </select>
              </div>
              <div>
                <label className="label">Scope (category)</label>
                <select className="input" name="category" defaultValue="">
                  <option value="">All SKUs</option>
                  {categories.map((c) => (
                    <option key={c.category} value={c.category}>{c.category}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Tolerance % (blank = default)</label>
                <input className="input" name="tolerancePct" type="number" step="0.5" min={0} placeholder={String(num(settings, "count.tolerancePct"))} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="blind" /> Blind count — hide system quantities from the counters
            </label>
            <button className="btn-primary" type="submit">Create count sheet</button>
          </form>
        </div>
      )}

      {active && (active.status === "open" || active.status === "recount_required") && (
        <div className="card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">
              {active.status === "open" ? "Count sheet" : "Recount flagged lines"} — {active.warehouse.name} <span className="ml-1 text-xs font-normal text-slate-500">({active.type}, {active.scope}{active.blind ? ", blind" : ""}, tolerance {activeTol}%)</span>
            </h3>
            <StatusBadge status={active.status} />
          </div>
          <form action={active.status === "open" ? submitStockCount : submitRecount}>
            <input type="hidden" name="countId" value={active.id} />
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th">Product</th>
                  <th className="th">Lot</th>
                  <th className="th">System qty</th>
                  <th className="th">{active.status === "open" ? "Counted" : "Counted (first)"}</th>
                  {active.status === "recount_required" && <th className="th">Recount</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {active.lines
                  .filter((l) => active.status === "open" || beyond(l.variance, l.systemQty, activeTol))
                  .map((l) => (
                    <tr key={l.id}>
                      <td className="td font-medium text-slate-900">{prod.get(l.productId)?.name}</td>
                      <td className="td text-xs">{l.lotNumber}</td>
                      <td className="td">{active.blind && active.status === "open" ? <span className="text-slate-300">hidden</span> : l.systemQty}</td>
                      {active.status === "open" ? (
                        <td className="td"><input className="input w-28" type="number" min={0} name={`counted_${l.id}`} required /></td>
                      ) : (
                        <>
                          <td className="td text-amber-700">{l.countedQty} <span className="text-xs">({l.variance > 0 ? "+" : ""}{l.variance})</span></td>
                          <td className="td"><input className="input w-28" type="number" min={0} name={`recount_${l.id}`} required /> <input className="input mt-1 w-40 py-1 text-xs" name={`why_${l.id}`} placeholder="Cause (optional)" /></td>
                        </>
                      )}
                    </tr>
                  ))}
              </tbody>
            </table>
            <button className="btn-primary mt-4" type="submit">{active.status === "open" ? "Submit count" : "Submit recount"}</button>
          </form>
        </div>
      )}

      {pending.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Awaiting supervisor review</h3>
          <div className="space-y-3">
            {pending.map((c) => (
              <div key={c.id} className="card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900">{c.warehouse.name} · counted by {c.countedBy} · {formatDateTime(c.countedAt)}</p>
                  <form action={decideStockCount} className="flex gap-2">
                    <input type="hidden" name="stockCountId" value={c.id} />
                    <button className="btn-primary px-3 py-1 text-xs" type="submit" name="decision" value="approved">Approve &amp; post</button>
                    <button className="btn-danger px-3 py-1 text-xs" type="submit" name="decision" value="rejected">Reject</button>
                  </form>
                </div>
                <table className="mt-2 w-full text-sm">
                  <thead className="border-b border-slate-200">
                    <tr>
                      <th className="th">Product</th>
                      <th className="th">Lot</th>
                      <th className="th">System</th>
                      <th className="th">Counted / recount</th>
                      <th className="th">Variance</th>
                      <th className="th">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {c.lines.filter((l) => (l.recountQty ?? l.countedQty) !== l.systemQty).map((l) => {
                      const fin = l.recountQty ?? l.countedQty;
                      return (
                        <tr key={l.id}>
                          <td className="td">{prod.get(l.productId)?.name}</td>
                          <td className="td text-xs">{l.lotNumber}</td>
                          <td className="td">{l.systemQty}</td>
                          <td className="td">{l.countedQty}{l.recountQty !== null ? ` → ${l.recountQty}` : ""}</td>
                          <td className="td font-medium">{fin - l.systemQty}</td>
                          <td className="td">{formatCurrency((fin - l.systemQty) * (prod.get(l.productId)?.unitPrice ?? 0))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Cycle-count schedule</h3>
          <p className="mb-3 text-xs text-slate-500">Fast-moving categories are counted more often. Set how many days apart each category should be cycle-counted.</p>
          <form action={saveCycleSchedule} className="space-y-2">
            {categories.map((c) => {
              const freq = Number(settings[`count.cycle.${c.category}`] ?? 0);
              const last = lastCycle.get(c.category);
              const dueIn = freq && last ? freq - Math.floor((now.getTime() - last.getTime()) / 86400000) : null;
              return (
                <div key={c.category} className="flex items-center justify-between gap-2 text-sm">
                  <span className="w-40 text-slate-700">{c.category}</span>
                  <input className="input w-24 py-1" type="number" min={0} name={`freq_${c.category}`} defaultValue={freq || ""} placeholder="days" />
                  <span className={`w-40 text-xs ${freq && (dueIn === null || dueIn <= 0) ? "font-medium text-rose-600" : "text-slate-400"}`}>
                    {!freq ? "no schedule" : last ? (dueIn! <= 0 ? `due now (last ${formatDate(last)})` : `due in ${dueIn}d`) : "never counted — due"}
                  </span>
                </div>
              );
            })}
            <button className="btn-secondary mt-2" type="submit">Save schedule</button>
          </form>
        </div>
        <div className="card p-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Count history</h3>
          <ul className="space-y-2 text-sm">
            {counts.map((c) => {
              const units = c.lines.reduce((s, l) => s + Math.abs((l.recountQty ?? l.countedQty) - l.systemQty), 0);
              return (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <span className="text-slate-700">
                    {formatDate(c.countedAt)} · {c.warehouse.name} · {c.type} · {c.scope}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{c.status === "open" ? "" : `${units} unit variance`}</span>
                    <StatusBadge status={c.status} />
                    {(c.status === "open" || c.status === "recount_required") && <Link className="text-xs text-blue-600 hover:underline" href={`/branch/stock-count?count=${c.id}`}>Continue</Link>}
                  </span>
                </li>
              );
            })}
            {counts.length === 0 && <li className="text-slate-400">No counts yet.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
