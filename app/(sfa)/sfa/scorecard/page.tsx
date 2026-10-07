import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { formatCurrency } from "@/lib/format";
import { getAllSettings } from "@/lib/settings";
import { METRICS, addMonths, badgesFor, scorecardFor } from "@/lib/scorecard";

const fmt = (unit: string, v: number) => (unit === "money" ? formatCurrency(v) : unit === "pct" ? `${v}%` : v.toLocaleString("en-PH"));

export default async function MobileScorecardPage() {
  const { userId, branchId } = await getSession();
  if (!userId || !branchId) return <p className="text-sm text-slate-500">No rep selected.</p>;
  const settings = await getAllSettings();
  const month = new Date().toISOString().slice(0, 7);
  const team = await prisma.user.findMany({ where: { role: "sales_rep", active: true, branchId }, select: { id: true, name: true } });
  const cards = await Promise.all(team.map(async (t) => ({ ...t, card: await scorecardFor(t.id, month) })));
  cards.sort((a, b) => b.card.points - a.card.points);
  const mine = cards.find((c) => c.id === userId);
  const bySales = [...cards].sort((a, b) => b.card.rows[0].value - a.card.rows[0].value);
  const rank = bySales.findIndex((c) => c.id === userId) + 1;
  const prev = await scorecardFor(userId, addMonths(month, -1));
  const badges = mine ? badgesFor(mine.card, rank, cards.length) : [];
  const on = settings["gamification.enabled"] !== "off";
  const names = settings["gamification.showNames"] !== "positions_only";

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900">My Scorecard</h2>
        <p className="text-xs text-slate-500">{month} · targets are set by your supervisor</p>
      </div>
      <div className="card divide-y divide-slate-100 p-2">
        {mine?.card.rows.map((r, i) => {
          const m = METRICS[i];
          const before = prev.rows[i].value;
          const delta = r.value - before;
          return (
            <div key={r.metric} className="px-2 py-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-slate-900">{m.label}</p>
                <p className="text-xs text-slate-900">{fmt(m.unit, r.value)}</p>
              </div>
              {r.target != null && (
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${(r.achievement ?? 0) >= 100 ? "bg-emerald-500" : (r.achievement ?? 0) >= 70 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${Math.min(100, r.achievement ?? 0)}%` }} /></div>
                  <span className="text-[10px] text-slate-500">{r.achievement}% of {fmt(m.unit, r.target)}</span>
                </div>
              )}
              <p className="mt-0.5 text-[10px] text-slate-400">Last month {fmt(m.unit, before)} ({delta >= 0 ? "+" : ""}{m.unit === "money" ? formatCurrency(delta) : delta})</p>
            </div>
          );
        })}
      </div>

      {on && (
        <>
          <div className="card p-3">
            <p className="text-xs font-semibold text-slate-900">Recognition</p>
            <p className="text-[11px] text-slate-500">{mine?.card.points ?? 0} points this month — earned from orders, productive visits, completed tasks, collections, new customers and attendance.</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {badges.map((b) => <span key={b.id} title={b.why} className="rounded-full bg-amber-50 px-2 py-1 text-[11px] text-amber-800">{b.icon} {b.label}</span>)}
              {badges.length === 0 && <span className="text-[11px] text-slate-400">No badges yet this month — keep going.</span>}
            </div>
          </div>
          <div className="card p-3">
            <p className="mb-1 text-xs font-semibold text-slate-900">Team leaderboard</p>
            <ol className="space-y-1">
              {cards.map((c, i) => (
                <li key={c.id} className={`flex items-center justify-between rounded-md px-2 py-1 text-xs ${c.id === userId ? "bg-blue-50 font-semibold text-blue-800" : "text-slate-700"}`}>
                  <span>{i + 1}. {names || c.id === userId ? c.name : `Representative ${i + 1}`}</span>
                  <span>{c.card.points} pts</span>
                </li>
              ))}
            </ol>
            {!names && <p className="mt-1 text-[10px] text-slate-400">The leaderboard shows positions only; names are hidden by policy.</p>}
          </div>
        </>
      )}
    </div>
  );
}
