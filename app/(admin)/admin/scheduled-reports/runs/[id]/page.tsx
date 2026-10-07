import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/format";
import { fmtCell } from "@/lib/report-runner";
import type { Cell, Column } from "@/lib/reports";

// The delivered copy of a scheduled report — the "report inbox" entry.
export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await prisma.scheduledReportRun.findUnique({ where: { id }, include: { report: true } });
  if (!run || !run.output) notFound();
  const out = JSON.parse(run.output) as { columns: Column[]; rows: Record<string, Cell>[]; totals?: Record<string, Cell>; filters: Record<string, string> };
  const right = (c: Column) => c.type === "money" || c.type === "int" || c.type === "pct";
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/admin/scheduled-reports" className="hover:underline">Scheduled reports</Link>
        <span>/</span>
        <span className="text-slate-900">{run.report.name}</span>
      </div>
      <div className="card p-4 text-xs text-slate-600">
        <p><strong className="text-slate-900">{run.report.name}</strong> — delivered {formatDateTime(run.startedAt)} to {run.report.recipientEmails} as {run.report.format}</p>
        <p>Filters: {Object.entries(out.filters).map(([k, v]) => `${k}=${v}`).join(" · ") || "defaults"} · {run.rowCount} row(s)</p>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50"><tr>{out.columns.map((c) => <th key={c.key} className={`th ${right(c) ? "text-right" : ""}`}>{c.label}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {out.rows.map((r, i) => (
              <tr key={i}>{out.columns.map((c) => <td key={c.key} className={`td ${right(c) ? "text-right" : ""}`}>{fmtCell(r[c.key], c)}</td>)}</tr>
            ))}
          </tbody>
          {out.totals && (
            <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-semibold"><tr>{out.columns.map((c) => <td key={c.key} className={`td ${right(c) ? "text-right" : ""}`}>{out.totals![c.key] === undefined ? "" : fmtCell(out.totals![c.key], c)}</td>)}</tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
