import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/format";
import { METRICS, badgesFor, scorecardFor, trendFor } from "@/lib/scorecard";

const fmt = (unit: string, v: number) => (unit === "money" ? formatCurrency(v) : unit === "pct" ? `${v}%` : v.toLocaleString("en-PH"));

export default async function ScorecardDetailPage({ params, searchParams }: { params: Promise<{ repId: string }>; searchParams: Promise<{ month?: string }> }) {
  const { repId } = await params;
  const { month = new Date().toISOString().slice(0, 7) } = await searchParams;
  const rep = await prisma.user.findUnique({ where: { id: repId }, include: { branch: true, route: true } });
  if (!rep) notFound();
  const [card, trend, tasks, team] = await Promise.all([
    scorecardFor(repId, month),
    trendFor(repId, month, 6),
    prisma.task.findMany({ where: { assignedToId: repId }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.user.findMany({ where: { role: "sales_rep", branchId: rep.branchId }, select: { id: true } }),
  ]);
  const sales = await Promise.all(team.map(async (t) => ({ id: t.id, v: (await scorecardFor(t.id, month)).rows[0].value })));
  const rank = [...sales].sort((a, b) => b.v - a.v).findIndex((x) => x.id === repId) + 1;
  const badges = badgesFor(card, rank, team.length);
  const max = Math.max(1, ...trend.map((t) => t.sales));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href={`/supervisor/scorecards?month=${month}`} className="hover:underline">Scorecards</Link><span>/</span><span className="text-slate-900">{rep.name}</span>
      </div>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{rep.name}</h2>
        <p className="text-sm text-slate-500">{rep.branch?.name} · {rep.route?.name ?? "No route"} · {month} · {card.points} points · rank {rank} of {team.length}</p>
        <div className="mt-2 flex flex-wrap gap-2">{badges.map((b) => <span key={b.id} title={b.why} className="rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-800">{b.icon} {b.label}</span>)}</div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Measure</th><th className="th">Actual</th><th className="th">Target</th><th className="th">Achievement</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {card.rows.map((r, i) => (
              <tr key={r.metric}>
                <td className="td font-medium text-slate-900">{METRICS[i].label}</td>
                <td className="td">{fmt(METRICS[i].unit, r.value)}</td>
                <td className="td">{r.target != null ? fmt(METRICS[i].unit, r.target) : <span className="text-slate-400">not set</span>}</td>
                <td className="td">
                  {r.achievement != null ? (
                    <div className="flex items-center gap-2"><div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${r.achievement >= 100 ? "bg-emerald-500" : r.achievement >= 70 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${Math.min(100, r.achievement)}%` }} /></div><span className="text-xs">{r.achievement}%</span></div>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">6-month trend (retained history)</h3>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-500"><th className="pb-1 font-normal">Month</th><th className="pb-1 font-normal">Sales</th><th className="pb-1 font-normal"></th><th className="pb-1 font-normal">Visit compliance</th><th className="pb-1 font-normal">Productive</th><th className="pb-1 font-normal">Collections</th></tr></thead>
          <tbody>
            {trend.map((t) => (
              <tr key={t.month} className="border-t border-slate-100">
                <td className="py-1.5">{t.month}</td><td>{formatCurrency(t.sales)}</td>
                <td className="w-40"><div className="h-2 rounded-full bg-blue-500" style={{ width: `${(t.sales / max) * 100}%` }} /></td>
                <td>{t.visits}%</td><td>{t.productive}%</td><td>{formatCurrency(t.collection)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Recent tasks</h3>
        <ul className="space-y-2">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm last:border-0"><span>{t.title}</span><span className={t.status === "completed" ? "text-emerald-600" : "text-amber-600"}>{t.status.replace("_", " ")}</span></li>
          ))}
          {tasks.length === 0 && <p className="text-xs text-slate-400">No tasks assigned.</p>}
        </ul>
      </div>
    </div>
  );
}
