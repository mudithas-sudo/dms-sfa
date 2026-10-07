import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import StatusBadge from "@/components/StatusBadge";
import Banner from "@/components/Banner";
import { formatDate, formatDateTime } from "@/lib/format";
import { dayStart, vanDayFigures } from "@/lib/van";
import { getAllSettings, num } from "@/lib/settings";
import { recordVanClosingCount, acknowledgeReconciliation, resolveReconciliation } from "@/app/actions/van-actions";

const OUTCOME_TONE: Record<string, string> = { none: "text-emerald-700", within_tolerance: "text-amber-700", shortage: "font-medium text-rose-600", excess: "font-medium text-rose-600" };

export default async function EodReconciliationPage({ searchParams }: { searchParams: Promise<{ van?: string; error?: string; notice?: string }> }) {
  const { branchId } = await getSession();
  const { van: vanParam, error, notice } = await searchParams;
  const settings = await getAllSettings();
  const vans = await prisma.van.findMany({ where: branchId ? { branchId } : {}, orderBy: { code: "asc" } });
  const van = vans.find((v) => v.id === vanParam) ?? vans[0];
  const products = await prisma.product.findMany({ select: { id: true, name: true } });
  const pname = new Map(products.map((p) => [p.id, p.name]));

  const [rec, rows, exceptions, figures] = await Promise.all([
    van ? prisma.vanReconciliation.findUnique({ where: { vanId_dayDate: { vanId: van.id, dayDate: dayStart() } }, include: { lines: true } }) : null,
    van ? prisma.stockBalance.findMany({ where: { locationType: "van", vanId: van.id }, include: { product: true }, orderBy: { product: { name: "asc" } } }) : [],
    prisma.vanReconciliation.findMany({
      where: { vanId: { in: vans.map((v) => v.id) }, status: { in: ["pending_ack", "variance_open", "escalated", "carried_over"] } },
      orderBy: { dayDate: "desc" },
      take: 20,
    }),
    van ? vanDayFigures(van.id) : [],
  ]);
  const vcode = new Map(vans.map((v) => [v.id, v.code]));
  const tol = num(settings, "van.eodToleranceUnits");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">End-of-Day Van Reconciliation</h2>
        <p className="mt-1 text-xs text-slate-500">
          For each SKU: expected remaining = loaded − sold − returned (± adjustments) is compared with the physical count at day close. Matching vans close automatically; a variance within the tolerance ({tol} unit(s) per SKU) closes after
          supervisor acknowledgement; a larger shortage or any excess keeps the van open until the cause is recorded and an adjustment is approved (or it is escalated or formally carried over). A van cannot be reloaded until yesterday is closed.
        </p>
      </div>
      <Banner error={error} notice={notice} />

      <form method="get" className="flex items-center gap-2">
        <select name="van" defaultValue={van?.id} className="input max-w-xs">
          {vans.map((v) => (
            <option key={v.id} value={v.id}>{v.code} · {v.driverName}</option>
          ))}
        </select>
        <button className="btn-secondary" type="submit">Show</button>
        <Link className="text-xs text-blue-600 hover:underline" href="/branch/van-stock">Live van balances →</Link>
      </form>

      {van && (
        <div className="card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">{van.code} — today ({formatDate(new Date())})</h3>
            {rec ? <StatusBadge status={rec.status} /> : <span className="text-xs text-slate-400">No closing count yet</span>}
          </div>

          {rec ? (
            <>
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200">
                  <tr><th className="th">Product</th><th className="th">Opening</th><th className="th">Loaded</th><th className="th">Sold</th><th className="th">Returned</th><th className="th">Adj.</th><th className="th">Expected</th><th className="th">Counted</th><th className="th">Variance</th><th className="th"></th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rec.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="td">{pname.get(l.productId)}</td>
                      <td className="td">{l.opening}</td><td className="td">{l.loaded}</td><td className="td">{l.sold}</td><td className="td">{l.returned}</td><td className="td">{l.adjusted}</td>
                      <td className="td font-medium">{l.expected}</td><td className="td">{l.counted}</td>
                      <td className={`td ${OUTCOME_TONE[l.outcome]}`}>{l.variance > 0 ? "+" : ""}{l.variance}</td>
                      <td className="td text-xs capitalize text-slate-500">{l.outcome.replace(/_/g, " ")}{l.resolution ? ` · ${l.resolution.replace(/_/g, " ")}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rec.cause && <p className="mt-2 text-xs text-slate-600">Cause: {rec.cause}{rec.approvedBy ? ` · by ${rec.approvedBy}` : ""}</p>}
              {rec.status === "pending_ack" && (
                <form action={acknowledgeReconciliation} className="mt-3"><input type="hidden" name="id" value={rec.id} /><button className="btn-primary" type="submit">Acknowledge variance within tolerance &amp; close</button></form>
              )}
              {(rec.status === "variance_open" || rec.status === "escalated") && (
                <form action={resolveReconciliation} className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                  <input type="hidden" name="id" value={rec.id} />
                  <input className="input" name="cause" placeholder="Cause of the variance (required)" required />
                  <div className="flex flex-wrap gap-2">
                    <button className="btn-primary" type="submit" name="action" value="adjust">Approve stock adjustment &amp; close</button>
                    <button className="btn-secondary" type="submit" name="action" value="escalate">Escalate to branch manager</button>
                    <button className="btn-secondary" type="submit" name="action" value="carry_over">Carry over formally</button>
                  </div>
                  <p className="text-xs text-slate-500">Approved shortages and excesses are posted as stock adjustments with the reason and approver recorded in the audit history.</p>
                </form>
              )}
            </>
          ) : (
            <p className="mb-3 text-sm text-slate-500">
              The representative submits the closing count from the mobile app; the clerk can also enter it here. Today so far: {figures.reduce((s, f) => s + f.sold, 0)} sold, {figures.reduce((s, f) => s + f.loaded, 0)} loaded, {figures.reduce((s, f) => s + f.returned, 0)} returned.
            </p>
          )}

          {(!rec || rec.status !== "closed") && rows.length > 0 && (
            <form action={recordVanClosingCount} className="mt-4 border-t border-slate-100 pt-4">
              <input type="hidden" name="vanId" value={van.id} />
              <h4 className="mb-2 text-sm font-semibold text-slate-900">Enter / replace the closing count</h4>
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200"><tr><th className="th">Product</th><th className="th">Lot</th><th className="th">System (good)</th><th className="th">Counted good</th><th className="th">Remark (beyond tolerance)</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="td">{r.product.name}</td><td className="td text-xs">{r.lotNumber}</td><td className="td">{r.qtyGood}</td>
                      <td className="td"><input className="input w-24" type="number" min={0} name={`cg_${r.id}`} required /></td>
                      <td className="td"><input className="input py-1 text-xs" name={`why_${r.id}`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="btn-secondary mt-3" type="submit">Reconcile</button>
            </form>
          )}
        </div>
      )}

      <div className="card overflow-x-auto">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Exceptions list — unresolved or carried over</div>
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Day</th><th className="th">Van</th><th className="th">Counted by</th><th className="th">Cause</th><th className="th">Status</th><th className="th"></th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {exceptions.map((e) => (
              <tr key={e.id}>
                <td className="td">{formatDate(e.dayDate)}</td>
                <td className="td">{vcode.get(e.vanId)}</td>
                <td className="td text-xs">{e.countedBy ?? "—"}</td>
                <td className="td text-xs">{e.cause ?? "—"}</td>
                <td className="td"><StatusBadge status={e.status} /></td>
                <td className="td text-right"><Link className="text-xs text-blue-600 hover:underline" href={`/branch/eod-reconciliation?van=${e.vanId}`}>Open</Link></td>
              </tr>
            ))}
            {exceptions.length === 0 && (
              <tr><td className="td text-slate-400" colSpan={6}>No open exceptions — every reconciliation is closed. {formatDateTime(new Date())}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
