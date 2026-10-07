import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { formatCurrency } from "@/lib/format";
import { METRICS, scorecardFor } from "@/lib/scorecard";

const fmt = (unit: string, v: number) => (unit === "money" ? formatCurrency(v) : unit === "pct" ? `${v}%` : v.toLocaleString("en-PH"));
const tone = (a: number | null) => (a === null ? "text-slate-400" : a >= 100 ? "text-emerald-600" : a >= 70 ? "text-amber-600" : "text-rose-600");

export default async function ScorecardsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { branchId } = await getSession();
  const { month = new Date().toISOString().slice(0, 7) } = await searchParams;
  const reps = await prisma.user.findMany({ where: { role: "sales_rep", active: true, ...(branchId ? { branchId } : {}) }, orderBy: { name: "asc" } });
  const cards = await Promise.all(reps.map(async (r) => ({ rep: r, card: await scorecardFor(r.id, month) })));
  cards.sort((a, b) => b.card.points - a.card.points);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Rep Scorecards</h2>
          <p className="text-xs text-slate-500">Achievement against monthly targets. <Link className="text-blue-600 underline" href="/supervisor/targets">Set targets</Link></p>
        </div>
        <form method="get" className="flex items-end gap-2">
          <div><label className="label" htmlFor="month">Month</label><input className="input" id="month" type="month" name="month" defaultValue={month} /></div>
          <button className="btn-secondary" type="submit">Show</button>
        </form>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr><th className="th">Rep</th>{METRICS.map((m) => <th key={m.id} className="th">{m.label}</th>)}<th className="th">Points</th><th className="th"></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cards.map(({ rep, card }) => (
              <tr key={rep.id}>
                <td className="td font-medium text-slate-900">{rep.name}</td>
                {card.rows.map((r, i) => (
                  <td key={r.metric} className="td text-xs">
                    <span className="font-medium text-slate-900">{fmt(METRICS[i].unit, r.value)}</span>
                    <span className={`block text-[11px] ${tone(r.achievement)}`}>{r.achievement === null ? "no target" : `${r.achievement}% of ${fmt(METRICS[i].unit, r.target ?? 0)}`}</span>
                  </td>
                ))}
                <td className="td font-semibold">{card.points}</td>
                <td className="td text-right"><Link href={`/supervisor/scorecards/${rep.id}?month=${month}`} className="text-blue-600 hover:underline">Detail &amp; trend</Link></td>
              </tr>
            ))}
            {cards.length === 0 && <tr><td className="td text-slate-400" colSpan={METRICS.length + 3}>No representatives.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
