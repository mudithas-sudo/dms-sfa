import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import { formatDate, formatCurrency } from "@/lib/format";
import { getAllSettings, expiryBand, expiryBandsFor } from "@/lib/settings";
import { autoMoveExpired, ensureNearExpiryAlert } from "@/lib/stock";
import { moveExpiredStock } from "@/app/actions/inventory-actions";

const BANDS = [
  { id: "healthy", label: "Healthy", tone: "badge-green", note: "Normal allocation" },
  { id: "warning", label: "Warning", tone: "badge-amber", note: "Listed on the dashboard and daily alert" },
  { id: "critical", label: "Critical", tone: "badge-red", note: "Flagged for priority sale or action" },
  { id: "expired", label: "Expired", tone: "badge-red", note: "Excluded from sale; moved to Expired stock" },
] as const;

export default async function NearExpiryPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { branchId } = await getSession();
  const { error, notice } = await searchParams;
  const settings = await getAllSettings();
  if (branchId && settings["expiry.autoMove"] === "auto") await autoMoveExpired(branchId);

  const warehouse = branchId ? await prisma.warehouse.findFirst({ where: { branchId, type: "saleable" } }) : null;
  const rows = warehouse
    ? await prisma.stockBalance.findMany({
        where: { warehouseId: warehouse.id, expiryDate: { not: null }, OR: [{ qtyGood: { gt: 0 } }, { qtyExpired: { gt: 0 } }] },
        include: { product: true },
        orderBy: { expiryDate: "asc" },
      })
    : [];

  const items = rows.map((r) => {
    const bands = expiryBandsFor(settings, r.product.category);
    const band = expiryBand(r.expiryDate, bands);
    const days = Math.floor((r.expiryDate!.getTime() - new Date().getTime()) / 86400000);
    const qty = band === "expired" ? r.qtyGood + r.qtyExpired : r.qtyGood;
    return { r, band, days, qty, value: qty * r.product.unitPrice, bands };
  });
  const atRisk = items.filter((i) => i.band !== "healthy");
  if (branchId) {
    await ensureNearExpiryAlert(branchId, items.filter((i) => i.band === "warning").length, items.filter((i) => i.band === "critical").length);
  }
  const summary = BANDS.map((b) => ({ ...b, lots: items.filter((i) => i.band === b.id).length, qty: items.filter((i) => i.band === b.id).reduce((s, i) => s + i.qty, 0), value: items.filter((i) => i.band === b.id).reduce((s, i) => s + i.value, 0) }));
  const byCategory = new Map<string, { warning: number; critical: number; expired: number; value: number }>();
  for (const i of atRisk) {
    const c = byCategory.get(i.r.product.category) ?? { warning: 0, critical: 0, expired: 0, value: 0 };
    c[i.band as "warning" | "critical" | "expired"] += i.qty;
    c.value += i.value;
    byCategory.set(i.r.product.category, c);
  }
  const expiredMovable = items.filter((i) => i.band === "expired" && i.r.qtyGood - i.r.qtyReserved > 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Near-Expiry Visibility &amp; Alerts</h2>
        <p className="mt-1 text-xs text-slate-500">
          Bands are set per branch, category or SKU in Platform Configuration (default warning {settings["nearExpiry.warningDays"]} days, critical {settings["nearExpiry.criticalDays"]} days; short-life
          categories such as beverages warn earlier). A daily summary reaches the branch manager and warehouse supervisor on screen. Lots past expiry are{" "}
          {settings["expiry.autoMove"] === "auto" ? "moved to Expired stock automatically" : "flagged here for the warehouse to confirm the move to Expired stock"}.
        </p>
      </div>
      <Banner error={error} notice={notice} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {summary.map((b) => (
          <div key={b.id} className="card px-4 py-3">
            <p className="flex items-center justify-between text-xs text-slate-500"><span className={`badge ${b.tone}`}>{b.label}</span>{b.lots} lot(s)</p>
            <p className="mt-2 text-lg font-semibold text-slate-900">{b.qty.toLocaleString()} units</p>
            <p className="text-xs text-slate-500">{formatCurrency(b.value)} at risk</p>
            <p className="mt-1 text-[11px] text-slate-400">{b.note}</p>
          </div>
        ))}
      </div>

      {expiredMovable.length > 0 && (
        <form action={moveExpiredStock} className="card flex flex-wrap items-center justify-between gap-2 border-rose-200 p-4">
          <p className="text-sm text-rose-700">{expiredMovable.length} lot(s) are past expiry but still counted as sellable.</p>
          <button className="btn-danger" type="submit">Move all to Expired stock</button>
        </form>
      )}

      <div className="card overflow-x-auto">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Value at risk by category</div>
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Category</th>
              <th className="th">Warning (units)</th>
              <th className="th">Critical (units)</th>
              <th className="th">Expired (units)</th>
              <th className="th">Value at risk</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[...byCategory.entries()].map(([cat, c]) => (
              <tr key={cat}>
                <td className="td font-medium text-slate-900">{cat}</td>
                <td className="td">{c.warning}</td>
                <td className="td">{c.critical}</td>
                <td className="td">{c.expired}</td>
                <td className="td">{formatCurrency(c.value)}</td>
              </tr>
            ))}
            {byCategory.size === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={5}>Nothing is inside a warning band.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Product</th>
              <th className="th">Lot</th>
              <th className="th">Expiry</th>
              <th className="th">Days left</th>
              <th className="th">Band</th>
              <th className="th">Units</th>
              <th className="th">Value</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {atRisk.map((i) => (
              <tr key={i.r.id}>
                <td className="td font-medium text-slate-900"><Link className="hover:underline" href={`/branch/warehouse-stock/${i.r.productId}?lot=${encodeURIComponent(i.r.lotNumber)}`}>{i.r.product.name}</Link></td>
                <td className="td text-xs">{i.r.lotNumber}</td>
                <td className="td">{formatDate(i.r.expiryDate!)}</td>
                <td className={`td ${i.days < 0 ? "font-medium text-rose-600" : ""}`}>{i.days}</td>
                <td className="td"><span className={`badge ${BANDS.find((b) => b.id === i.band)!.tone}`}>{BANDS.find((b) => b.id === i.band)!.label}</span></td>
                <td className="td">{i.qty}</td>
                <td className="td">{formatCurrency(i.value)}</td>
                <td className="td text-right">
                  {i.band === "expired" && i.r.qtyGood - i.r.qtyReserved > 0 && (
                    <form action={moveExpiredStock}>
                      <input type="hidden" name="stockBalanceId" value={i.r.id} />
                      <button className="text-xs text-rose-600 hover:underline" type="submit">Confirm move to Expired</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {atRisk.length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={8}>No lots are near or past expiry.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
