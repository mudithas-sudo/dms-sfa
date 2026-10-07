import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import StatusBadge from "@/components/StatusBadge";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { getRepVan, dayStart, vanDayFigures } from "@/lib/van";
import { getAllSettings, num } from "@/lib/settings";
import { submitMobileEod } from "@/app/actions/van-actions";

export default async function MobileEodPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { userId, branchId } = await getSession();
  if (!userId || !branchId) return <p className="text-sm text-slate-500">No rep selected.</p>;
  const { error, notice } = await searchParams;
  const settings = await getAllSettings();
  const rep = await prisma.user.findUnique({ where: { id: userId } });
  const van = rep ? await getRepVan(branchId, rep) : null;
  const start = dayStart();
  const attendance = await prisma.attendance.findFirst({ where: { userId, dayDate: { gte: start } }, orderBy: { startAt: "desc" } });
  if (!van) return <Banner error="No active van is assigned to you." />;

  const [figures, rows, rec, cash, products] = await Promise.all([
    vanDayFigures(van.id),
    prisma.stockBalance.findMany({ where: { locationType: "van", vanId: van.id }, include: { product: true }, orderBy: { product: { name: "asc" } } }),
    prisma.vanReconciliation.findUnique({ where: { vanId_dayDate: { vanId: van.id, dayDate: start } }, include: { lines: true } }),
    prisma.aRLedgerEntry.aggregate({ where: { type: "payment", method: "cash", collectedBy: userId, entryDate: { gte: start }, recStatus: { not: "reversed" } }, _sum: { amount: true } }),
    prisma.product.findMany({ select: { id: true, name: true } }),
  ]);
  const cheques = await prisma.aRLedgerEntry.aggregate({ where: { type: "payment", method: "cheque", collectedBy: userId, entryDate: { gte: start }, recStatus: { not: "reversed" } }, _sum: { amount: true }, _count: true });
  const pname = new Map(products.map((p) => [p.id, p.name]));
  const expectedCash = cash._sum.amount ?? 0;
  const tol = num(settings, "van.eodToleranceUnits");
  const active = figures.filter((f) => f.loaded || f.sold || f.returned || f.closing > 0);

  return (
    <div className="space-y-4">
      <Banner error={error} notice={notice} />
      <div>
        <h2 className="text-base font-semibold text-slate-900">End-of-Day Reconciliation</h2>
        <p className="text-xs text-slate-500">{van.code} · stock and cash — opening + loaded − sold − returned, then your physical count</p>
      </div>

      <div className="card divide-y divide-slate-100 p-2">
        {active.map((f) => (
          <div key={f.productId} className="px-2 py-2.5">
            <p className="text-sm font-medium text-slate-900">{pname.get(f.productId)}</p>
            <p className="text-xs text-slate-500">Opening {f.opening} + Loaded {f.loaded} − Sold {f.sold} − Returned {f.returned}{f.adjusted ? ` ± Adj. ${f.adjusted}` : ""} = <strong className="text-slate-700">{f.closing}</strong> expected</p>
          </div>
        ))}
        {active.length === 0 && <p className="px-2 py-4 text-sm text-slate-400">No van activity recorded today.</p>}
      </div>

      {rec ? (
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900">Submitted — stock reconciliation</p>
            <StatusBadge status={rec.status} />
          </div>
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {rec.lines.filter((l) => l.variance !== 0).map((l) => (
              <li key={l.id}>{pname.get(l.productId)}: expected {l.expected}, counted {l.counted} ({l.variance > 0 ? "+" : ""}{l.variance}) — {l.outcome.replace(/_/g, " ")}</li>
            ))}
            {rec.lines.every((l) => l.variance === 0) && <li className="text-emerald-700">Every product matches — the van is closed automatically.</li>}
          </ul>
          {attendance?.cashDeclared !== null && attendance?.cashDeclared !== undefined && (
            <p className="mt-2 text-xs text-slate-600">Cash handed over {formatCurrency(attendance.cashDeclared)} of {formatCurrency(attendance.cashExpected ?? 0)} expected{attendance.cashVarianceReason ? ` — ${attendance.cashVarianceReason}` : ""}.</p>
          )}
          {attendance?.eodConfirmedAt && <p className="mt-1 text-xs text-emerald-700">Confirmed {formatDateTime(attendance.eodConfirmedAt)}</p>}
          <p className="mt-2 text-xs text-slate-500">Next: unload the unsold stock on the <Link className="text-blue-600 underline" href="/sfa/van-stock">Van Stock</Link> screen, then End Day.</p>
        </div>
      ) : (
        <form action={submitMobileEod} className="card space-y-3 p-4">
          <h3 className="text-sm font-semibold text-slate-900">1. Count the van</h3>
          <p className="text-xs text-slate-500">Enter the physical count for every product. A difference of more than {tol} unit(s) needs a reason before the day can close.</p>
          {rows.map((s) => (
            <div key={s.id} className="grid grid-cols-[1fr_56px_56px] items-center gap-1.5 text-xs">
              <span className="truncate text-slate-700">{s.product.name} <span className="text-slate-400">(sys {s.qtyGood})</span></span>
              <input className="input py-1 text-xs" type="number" min={0} name={`cg_${s.id}`} placeholder="good" required />
              <input className="input py-1 text-xs" type="number" min={0} name={`cd_${s.id}`} defaultValue={s.qtyDamaged} title="Damaged" />
              <input className="input col-span-3 py-1 text-xs" name={`why_${s.id}`} placeholder="Reason for any difference" />
            </div>
          ))}
          {rows.length === 0 && <p className="text-xs text-slate-400">Nothing is on the van.</p>}

          <h3 className="border-t border-slate-100 pt-3 text-sm font-semibold text-slate-900">2. Cash</h3>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
            <p>Cash collected today<br /><strong className="text-sm text-slate-900">{formatCurrency(expectedCash)}</strong></p>
            <p>Cheques collected<br /><strong className="text-sm text-slate-900">{cheques._count} · {formatCurrency(cheques._sum.amount ?? 0)}</strong></p>
          </div>
          <div>
            <label className="label">Cash you are handing to the branch cashier (₱)</label>
            <input className="input" type="number" step="0.01" min={0} name="cashDeclared" defaultValue={expectedCash} />
          </div>
          <input className="input" name="cashReason" placeholder="Reason for any cash difference" />
          <button type="submit" className="btn-primary w-full" disabled={!attendance}>Submit reconciliation</button>
          {!attendance && <p className="text-xs text-amber-700">Start your day (Attendance) before submitting.</p>}
          <p className="text-[11px] text-slate-400">The settlement values for the cashier and warehouse come from this submitted reconciliation; variances above tolerance are routed to the supervisor.</p>
        </form>
      )}
    </div>
  );
}
