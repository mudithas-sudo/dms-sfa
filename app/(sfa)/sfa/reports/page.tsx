import Link from "next/link";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { reportById, type Cell } from "@/lib/reports";
import { daysAgo } from "@/lib/format";
import { currentScope, execute, fmtCell } from "@/lib/report-runner";

const LIST = [
  { id: "field-activity", label: "Field activity" },
  { id: "route-coverage", label: "Coverage" },
  { id: "sfa-orders", label: "Orders" },
  { id: "sfa-sales", label: "Sales" },
  { id: "sfa-collections", label: "Collections" },
  { id: "van-inventory", label: "Van inventory" },
];

// A representative's own reports: the same report definitions as the portal, restricted to their own work.
export default async function SfaReportsPage({ searchParams }: { searchParams: Promise<{ r?: string; days?: string }> }) {
  const { userId } = await getSession();
  if (!userId) return <p className="text-sm text-slate-500">No rep selected.</p>;
  const { r = "field-activity", days = "7" } = await searchParams;
  const def = reportById(r) ?? reportById("field-activity")!;
  const me = await prisma.user.findUnique({ where: { id: userId } });
  const scope = await currentScope();
  const to = new Date();
  const from = daysAgo(Number(days));
  const { result } = await execute(def.id, { rep: userId, dateFrom: from.toISOString().slice(0, 10), dateTo: to.toISOString().slice(0, 10) }, scope);
  const rows = def.id === "van-inventory" ? result.rows.filter((x) => x.rep === me?.name) : result.rows;
  const cols = result.columns.filter((c) => c.key !== "branch").slice(0, 6);

  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold text-slate-900">My Reports</h2>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {LIST.map((l) => (
          <Link key={l.id} href={`/sfa/reports?r=${l.id}&days=${days}`} className={`shrink-0 rounded-full px-3 py-1 text-xs ${def.id === l.id ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>{l.label}</Link>
        ))}
      </div>
      <div className="flex gap-1.5 text-xs">
        {["1", "7", "30"].map((d) => (
          <Link key={d} href={`/sfa/reports?r=${def.id}&days=${d}`} className={`rounded-full px-2.5 py-0.5 ${days === d ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}>{d === "1" ? "Today" : `${d} days`}</Link>
        ))}
      </div>
      <p className="text-[11px] text-slate-500">{def.title} · run {new Date().toLocaleString("en-PH")} for {me?.name}</p>
      <div className="card overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="border-b border-slate-200 bg-slate-50"><tr>{cols.map((c) => <th key={c.key} className="px-2 py-1.5 text-left font-medium text-slate-600">{c.label}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.slice(0, 40).map((row, i) => (
              <tr key={i}>{cols.map((c) => <td key={c.key} className="px-2 py-1.5">{fmtCell(row[c.key] as Cell, c)}</td>)}</tr>
            ))}
            {rows.length === 0 && <tr><td className="px-2 py-3 text-slate-400" colSpan={cols.length}>No rows for this period.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
