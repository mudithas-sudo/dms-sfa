import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import StatusBadge from "@/components/StatusBadge";
import Banner from "@/components/Banner";
import PrintButton from "@/components/PrintButton";
import { formatDate, formatDateTime } from "@/lib/format";
import { loadVan, cancelVanLoad } from "@/app/actions/van-actions";

export default async function VanLoadingPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; doc?: string }> }) {
  const { branchId } = await getSession();
  const { error, notice, doc } = await searchParams;
  const loads = await prisma.vanLoad.findMany({
    where: { van: branchId ? { branchId } : {}, status: { in: ["pending_load", "loaded", "approved", "cancelled"] } },
    orderBy: { loadedAt: "desc" },
    take: 25,
    include: { lines: true, van: true },
  });
  const products = await prisma.product.findMany({ select: { id: true, name: true } });
  const pname = new Map(products.map((p) => [p.id, p.name]));
  const lots = await prisma.stockBalance.findMany({ where: { warehouse: branchId ? { branchId } : {} }, select: { productId: true, lotNumber: true, expiryDate: true } });
  const expiry = (pid: string, lot: string) => lots.find((l) => l.productId === pid && l.lotNumber === lot)?.expiryDate ?? null;
  const waiting = loads.filter((l) => l.status === "pending_load");
  const printing = doc ? loads.find((l) => l.id === doc) : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Warehouse-to-Van Loading</h2>
        <p className="mt-1 text-xs text-slate-500">
          Stock moves to a van only against an approved stock request. The clerk records what was actually loaded (FEFO lot and expiry are carried onto the van); on posting the warehouse falls and the van rises in one step. The loaded
          stock becomes sellable only after the representative acknowledges it on the device. A van cannot be reloaded until the previous day&apos;s reconciliation is closed or carried over.
        </p>
      </div>
      <Banner error={error} notice={notice} />

      {printing && (
        <div className="card p-6">
          <div className="no-print mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-900">Loading document</h3><PrintButton /></div>
          <p className="text-base font-semibold text-slate-900">{printing.loadNumber} — {printing.van.code} ({printing.van.driverName})</p>
          <p className="text-sm text-slate-600">Prepared by {printing.loadedBy} · {formatDateTime(printing.loadedAt)} · Acknowledged by rep: {printing.confirmedAt ? formatDateTime(printing.confirmedAt) : "not yet"}</p>
          <table className="mt-2 w-full text-sm">
            <thead className="border-b border-slate-200"><tr><th className="th">Product</th><th className="th">Lot</th><th className="th">Expiry</th><th className="th">Approved</th><th className="th">Loaded</th><th className="th">Rep confirmed</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {printing.lines.map((l) => (
                <tr key={l.id}><td className="td">{pname.get(l.productId)}</td><td className="td">{l.lotNumber}</td><td className="td">{expiry(l.productId, l.lotNumber) ? formatDate(expiry(l.productId, l.lotNumber)!) : "—"}</td><td className="td">{l.qtyApproved ?? l.qty}</td><td className="td">{l.qty}</td><td className="td">{l.qtyAcknowledged ?? "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-3 no-print">
        <h3 className="text-sm font-semibold text-slate-900">Waiting to be loaded ({waiting.length})</h3>
        {waiting.map((l) => (
          <form key={l.id} action={loadVan} className="card p-4">
            <input type="hidden" name="vanLoadId" value={l.id} />
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-900">{l.loadNumber} <span className="font-normal text-slate-500">· {l.van.code} · {l.van.driverName} · approved by {l.approvedBy}</span></p>
              <StatusBadge status={l.status} />
            </div>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200"><tr><th className="th">Product</th><th className="th">FEFO lot</th><th className="th">Expiry</th><th className="th">Approved</th><th className="th">Loaded</th><th className="th">Variance reason</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {l.lines.map((ln) => (
                  <tr key={ln.id}>
                    <td className="td">{pname.get(ln.productId)}</td>
                    <td className="td text-xs">{ln.lotNumber}</td>
                    <td className="td text-xs">{expiry(ln.productId, ln.lotNumber) ? formatDate(expiry(ln.productId, ln.lotNumber)!) : "—"}</td>
                    <td className="td">{ln.qtyApproved ?? ln.qty}</td>
                    <td className="td"><input className="input w-24" type="number" min={0} max={ln.qtyApproved ?? ln.qty} name={`loaded_${ln.id}`} defaultValue={ln.qtyApproved ?? ln.qty} /></td>
                    <td className="td"><input className="input py-1 text-xs" name={`why_${ln.id}`} placeholder="Only if different" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex gap-2">
              <button className="btn-primary" type="submit">Post loading</button>
              <button className="btn-secondary" type="submit" formAction={cancelVanLoad}>Cancel loading</button>
            </div>
          </form>
        ))}
        {waiting.length === 0 && <p className="text-sm text-slate-400">Nothing is waiting — approve a stock request first.</p>}
      </div>

      <div className="card overflow-x-auto no-print">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr><th className="th">Loading</th><th className="th">Van</th><th className="th">Units</th><th className="th">Prepared</th><th className="th">Rep acknowledged</th><th className="th">Status</th><th className="th"></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loads.filter((l) => l.status !== "pending_load").map((l) => (
              <tr key={l.id}>
                <td className="td font-medium text-slate-900">{l.loadNumber ?? "—"}</td>
                <td className="td text-xs">{l.van.code} · {l.van.driverName}</td>
                <td className="td">{l.lines.reduce((s, x) => s + x.qty, 0)}</td>
                <td className="td text-xs">{formatDateTime(l.loadedAt)}<div className="text-slate-400">{l.loadedBy}</div></td>
                <td className="td text-xs">{l.confirmedAt ? formatDateTime(l.confirmedAt) : <span className="text-amber-600">waiting for the rep</span>}{l.lines.some((x) => x.qtyAcknowledged !== null && x.qtyAcknowledged < x.qty) && <div className="text-rose-600">short supplied</div>}</td>
                <td className="td"><StatusBadge status={l.status === "approved" ? "loaded" : l.status} /></td>
                <td className="td text-right"><a className="text-xs text-blue-600 hover:underline" href={`/branch/van-loading?doc=${l.id}`}>Document</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
