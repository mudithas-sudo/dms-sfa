import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import { METRICS } from "@/lib/scorecard";
import { setTarget } from "@/app/actions/supervisor-field-actions";

export default async function TargetsPage({ searchParams }: { searchParams: Promise<{ month?: string; error?: string; notice?: string }> }) {
  const { branchId } = await getSession();
  const { month = new Date().toISOString().slice(0, 7), error, notice } = await searchParams;
  const reps = await prisma.user.findMany({ where: { role: "sales_rep", active: true, ...(branchId ? { branchId } : {}) }, orderBy: { name: "asc" } });
  const targets = await prisma.target.findMany({ where: { period: month, userId: { in: reps.map((r) => r.id) } } });
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Monthly Targets</h2>
        <p className="text-xs text-slate-500">Targets feed the scorecards, achievement %, the sales-against-target report and recognition.</p>
      </div>
      <Banner error={error} notice={notice} />
      <form method="get" className="flex items-end gap-2"><div><label className="label" htmlFor="month">Month</label><input className="input" id="month" type="month" name="month" defaultValue={month} /></div><button className="btn-secondary" type="submit">Show</button></form>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Representative</th>{METRICS.map((m) => <th key={m.id} className="th">{m.label}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {reps.map((r) => (
              <tr key={r.id}><td className="td font-medium text-slate-900">{r.name}</td>{METRICS.map((m) => <td key={m.id} className="td text-xs">{targets.find((t) => t.userId === r.id && t.metric === m.id)?.targetValue.toLocaleString("en-PH") ?? <span className="text-slate-300">—</span>}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card max-w-xl p-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Set a target</h3>
        <form action={setTarget} className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="userId">Representative</label><select className="input" id="userId" name="userId">{reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
          <div><label className="label" htmlFor="metric">Measure</label><select className="input" id="metric" name="metric">{METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></div>
          <div><label className="label" htmlFor="period">Month</label><input className="input" id="period" type="month" name="period" defaultValue={month} /></div>
          <div><label className="label" htmlFor="targetValue">Target value</label><input className="input" id="targetValue" name="targetValue" type="number" step="0.01" min={0} required /></div>
          <div className="sm:col-span-2"><button className="btn-primary" type="submit">Save target</button></div>
        </form>
      </div>
    </div>
  );
}
