import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { formatDateTime } from "@/lib/format";
import {
  getRepVan,
  requestVanReplenishment,
  markVanStockDamaged,
  reverseVanStockDamage,
  applyVanStockCount,
  suggestedVanQty,
  confirmVanLoad,
} from "@/app/actions/sfa-actions";
import VanReplenishmentForm from "@/components/VanReplenishmentForm";

export default async function VanStockPage({
  searchParams,
}: {
  searchParams: Promise<{ replenishment?: string; count?: string }>;
}) {
  const { userId, branchId } = await getSession();
  if (!userId || !branchId) return <p className="text-sm text-slate-500">No rep selected.</p>;

  const { replenishment, count } = await searchParams;
  const rep = await prisma.user.findUnique({ where: { id: userId } });
  const van = rep ? await getRepVan(branchId, rep) : null;

  const [stock, products, unconfirmedLoads] = await Promise.all([
    van
      ? prisma.stockBalance.findMany({
          where: { locationType: "van", vanId: van.id },
          include: { product: true },
          orderBy: { product: { name: "asc" } },
        })
      : Promise.resolve([]),
    prisma.product.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
    van
      ? prisma.vanLoad.findMany({
          where: { vanId: van.id, status: "approved", confirmedAt: null },
          include: { lines: { include: { product: true } } },
          orderBy: { decidedAt: "desc" },
        })
      : Promise.resolve([]),
  ]);

  const suggestedByProduct: Record<string, number> = {};
  if (van) {
    await Promise.all(
      products.map(async (p) => {
        suggestedByProduct[p.id] = await suggestedVanQty(van.id, p.id);
      }),
    );
  }

  return (
    <div className="space-y-4">
      {replenishment === "submitted" && (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">Replenishment request sent to your branch.</div>
      )}
      {count === "submitted" && (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">Van stock count applied.</div>
      )}

      <div className="card p-4">
        <h2 className="text-base font-semibold text-slate-900">Van Stock</h2>
        <p className="text-xs text-slate-500">{van ? `${van.code} · ${van.plateNo}` : "No van assigned"}</p>
      </div>

      {unconfirmedLoads.length > 0 && (
        <div className="space-y-2">
          {unconfirmedLoads.map((l) => (
            <div key={l.id} className="card border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-800">Approved load ready — confirm receipt</p>
              <p className="text-xs text-amber-700">{formatDateTime(l.loadedAt)}</p>
              <ul className="mt-1 text-xs text-amber-700">
                {l.lines.map((line) => (
                  <li key={line.id}>{line.product.name} — Qty {line.qty}</li>
                ))}
              </ul>
              <form action={confirmVanLoad} className="mt-2">
                <input type="hidden" name="vanLoadId" value={l.id} />
                <button type="submit" className="btn-primary text-xs">Confirm Received</button>
              </form>
            </div>
          ))}
        </div>
      )}

      <div className="card p-2">
        <h3 className="px-2 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Current Stock</h3>
        <div className="divide-y divide-slate-100">
          {stock.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-2 py-2.5">
              <div>
                <p className="text-sm font-medium text-slate-900">{s.product.name}</p>
                <p className="text-xs text-slate-500">
                  {s.product.sku} · Lot {s.lotNumber} · Good {s.qtyGood}
                  {s.qtyDamaged > 0 && <span className="text-rose-600"> · Damaged {s.qtyDamaged}</span>}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                {s.qtyGood > 0 && (
                  <form action={markVanStockDamaged} className="flex items-center gap-1">
                    <input type="hidden" name="stockBalanceId" value={s.id} />
                    <input className="input w-14 py-1 text-xs" type="number" name="qty" min={1} max={s.qtyGood} placeholder="qty" />
                    <button type="submit" className="text-xs text-rose-600">Damaged</button>
                  </form>
                )}
                {s.qtyDamaged > 0 && (
                  <form action={reverseVanStockDamage} className="flex items-center gap-1">
                    <input type="hidden" name="stockBalanceId" value={s.id} />
                    <input className="input w-14 py-1 text-xs" type="number" name="qty" min={1} max={s.qtyDamaged} placeholder="qty" />
                    <button type="submit" className="text-xs text-emerald-600">Back to Good</button>
                  </form>
                )}
              </div>
            </div>
          ))}
          {stock.length === 0 && <p className="px-2 py-3 text-xs text-slate-400">No stock loaded on this van.</p>}
        </div>
      </div>

      {stock.length > 0 && (
        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Stock Count Entry</h3>
          <form action={applyVanStockCount} className="space-y-2">
            {stock.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2">
                <span className="flex-1 text-xs text-slate-700">{s.product.name}</span>
                <input className="input w-20 py-1 text-xs" type="number" name={`counted_${s.id}`} defaultValue={s.qtyGood} min={0} />
              </div>
            ))}
            <button type="submit" className="btn-secondary mt-2 w-full">Apply Count</button>
          </form>
        </div>
      )}

      <div className="card p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Request Replenishment</h3>
        <VanReplenishmentForm action={requestVanReplenishment} products={products} suggestedByProduct={suggestedByProduct} />
      </div>
    </div>
  );
}
