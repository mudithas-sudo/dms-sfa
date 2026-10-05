import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import StatusBadge from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";
import { requestVanLoad, decideVanLoad } from "@/app/actions/branch-actions";

export default async function VanLoadingPage({
  searchParams,
}: {
  searchParams: Promise<{ van?: string }>;
}) {
  const { branchId } = await getSession();
  const { van: vanIdParam } = await searchParams;
  const warehouse = branchId ? await prisma.warehouse.findFirst({ where: { branchId } }) : null;
  const vans = branchId ? await prisma.van.findMany({ where: { branchId }, orderBy: { code: "asc" } }) : [];
  const selectedVan = vanIdParam ?? vans[0]?.id;

  const [stockRowsRaw, pendingLoads] = await Promise.all([
    warehouse
      ? prisma.stockBalance.findMany({
          where: { warehouseId: warehouse.id, qtyGood: { gt: 0 } },
          include: { product: true },
          orderBy: { product: { name: "asc" } },
        })
      : Promise.resolve([]),
    warehouse
      ? prisma.vanLoad.findMany({
          where: { warehouseId: warehouse.id, status: "pending" },
          include: { van: true, lines: { include: { product: true } } },
          orderBy: { loadedAt: "desc" },
        })
      : Promise.resolve([]),
  ]);

  // FEFO: lots with an expiry date sort soonest-first; non-expiring products
  // (household goods etc.) don't need FEFO, so they sort after — otherwise
  // they'd swamp the top of the list ahead of genuinely at-risk stock.
  const stockRows = [...stockRowsRaw].sort((a, b) => {
    if (a.expiryDate && b.expiryDate) return a.expiryDate.getTime() - b.expiryDate.getTime();
    if (a.expiryDate) return -1;
    if (b.expiryDate) return 1;
    return a.product.name.localeCompare(b.product.name);
  });
  const expiringCount = stockRows.filter((r) => r.expiryDate).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Van Loading — {warehouse?.name ?? ""}</h2>
        <p className="text-sm text-slate-500">
          List is sorted First-Expired-First-Out (FEFO) — pick from the top of the list first. A requested
          load reserves the stock immediately but only moves it to the van once a manager approves it below.
        </p>
      </div>

      {pendingLoads.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Pending Approval</h3>
          {pendingLoads.map((l) => (
            <div key={l.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{l.van.code} — {l.van.driverName}</p>
                  <p className="text-xs text-slate-500">Requested by {l.loadedBy} · {formatDateTime(l.loadedAt)}</p>
                  <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                    {l.lines.map((line) => (
                      <li key={line.id}>{line.product.name} — Qty {line.qty} (Lot {line.lotNumber})</li>
                    ))}
                  </ul>
                </div>
                <StatusBadge status={l.status} />
              </div>
              <form action={decideVanLoad} className="mt-3 flex gap-2">
                <input type="hidden" name="vanLoadId" value={l.id} />
                <button type="submit" name="decision" value="approved" className="text-xs text-emerald-600 hover:underline">Approve</button>
                <button type="submit" name="decision" value="rejected" className="text-xs text-rose-600 hover:underline">Reject</button>
              </form>
            </div>
          ))}
        </div>
      )}

      <form className="card flex flex-wrap items-end gap-3 p-4" method="get">
        <div>
          <label className="label" htmlFor="van">Select Van</label>
          <select className="input" id="van" name="van" defaultValue={selectedVan}>
            {vans.map((v) => (
              <option key={v.id} value={v.id}>{v.code} — {v.driverName}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-secondary">Switch Van</button>
      </form>

      <div className="card p-6">
        <form action={requestVanLoad} className="space-y-4">
          <input type="hidden" name="vanId" value={selectedVan ?? ""} />
          <input type="hidden" name="warehouseId" value={warehouse?.id ?? ""} />
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200">
              <tr>
                <th className="th">Product</th>
                <th className="th">Lot</th>
                <th className="th">Expiry</th>
                <th className="th">Available (Reserved)</th>
                <th className="th">Qty to Load</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stockRows.map((r, i) => {
                const isFefoPick = r.expiryDate && i < Math.min(3, expiringCount);
                const available = r.qtyGood - r.qtyReserved;
                return (
                  <tr key={r.id}>
                    <td className="td font-medium text-slate-900">
                      {r.product.name}
                      {isFefoPick && <span className="badge badge-amber ml-2">Pick First</span>}
                    </td>
                    <td className="td">{r.lotNumber}</td>
                    <td className="td">{r.expiryDate ? r.expiryDate.toLocaleDateString("en-PH") : "—"}</td>
                    <td className="td">
                      {available}
                      {r.qtyReserved > 0 && <span className="text-xs text-amber-600"> ({r.qtyReserved} reserved)</span>}
                    </td>
                    <td className="td">
                      <input className="input w-24" type="number" name={`qty_${r.id}`} min={0} max={available} defaultValue={0} />
                    </td>
                  </tr>
                );
              })}
              {stockRows.length === 0 && (
                <tr><td className="td text-slate-400" colSpan={5}>No warehouse stock available.</td></tr>
              )}
            </tbody>
          </table>
          <button type="submit" className="btn-primary" disabled={!selectedVan}>Request Van Load</button>
        </form>
      </div>
    </div>
  );
}
