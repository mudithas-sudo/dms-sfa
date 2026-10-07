import Link from "next/link";
import { prisma } from "@/lib/prisma";
import Banner from "@/components/Banner";
import StatusBadge from "@/components/StatusBadge";
import ScheduleForm from "@/components/admin/ScheduleForm";
import { formatDateTime } from "@/lib/format";
import { REPORTS, filterOptions, reportById } from "@/lib/reports";
import { currentScope } from "@/lib/report-runner";
import { deleteSchedule, runDueSchedules, runScheduleNow, toggleSchedule } from "@/app/actions/report-actions";

export default async function ScheduledReportsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  const scope = await currentScope();
  const [schedules, opts, runs] = await Promise.all([
    prisma.scheduledReport.findMany({ orderBy: { createdAt: "desc" } }),
    filterOptions(scope),
    prisma.scheduledReportRun.findMany({ orderBy: { startedAt: "desc" }, take: 25, include: { report: true } }),
  ]);
  const options = { branch: opts.branch, channel: opts.channel, subchannel: opts.subchannel, route: opts.route, rep: opts.rep, category: opts.category, product: opts.product, warehouse: opts.warehouse, customer: opts.customer, promotion: opts.promotion };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Scheduled Reports</h2>
          <p className="text-xs text-slate-500">
            A schedule stores the report, its filters (with relative dates such as previous day), the format, the frequency and the recipients. It runs with its owner&apos;s access rights, every run is recorded, and a failed run notifies the owner and can be repeated.
          </p>
        </div>
        <form action={runDueSchedules}><button className="btn-secondary" type="submit">Run due schedules now</button></form>
      </div>
      <Banner error={error} notice={notice} />

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr><th className="th">Name</th><th className="th">Report</th><th className="th">Schedule</th><th className="th">Format</th><th className="th">Recipients</th><th className="th">Owner</th><th className="th">Last run</th><th className="th">Status</th><th className="th"></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {schedules.map((r) => (
              <tr key={r.id}>
                <td className="td font-medium text-slate-900">{r.name}</td>
                <td className="td text-xs">{reportById(r.reportType)?.title ?? r.reportType.replace(/_/g, " ")}{r.relativeDates && <span className="block text-slate-400">{r.relativeDates.replace(/_/g, " ")}</span>}</td>
                <td className="td text-xs">{r.scheduleDescription}</td>
                <td className="td text-xs capitalize">{r.format}</td>
                <td className="td text-xs text-slate-500">{r.recipientEmails}</td>
                <td className="td text-xs">{r.createdBy}</td>
                <td className="td text-xs">{r.lastRunAt ? formatDateTime(r.lastRunAt) : "Never run"}{r.lastRunStatus && <span className="ml-1"><StatusBadge status={r.lastRunStatus === "success" ? "completed" : "failed"} /></span>}</td>
                <td className="td"><StatusBadge status={r.status} /></td>
                <td className="td">
                  <div className="flex flex-wrap justify-end gap-2 text-xs">
                    <form action={runScheduleNow}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="trigger" value={r.lastRunStatus === "failed" ? "retry" : "manual"} /><button className="text-blue-600 hover:underline" type="submit">{r.lastRunStatus === "failed" ? "Repeat run" : "Run now"}</button></form>
                    <form action={toggleSchedule}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="nextStatus" value={r.status === "active" ? "inactive" : "active"} /><button className="text-slate-600 hover:underline" type="submit">{r.status === "active" ? "Pause" : "Resume"}</button></form>
                    <form action={deleteSchedule}><input type="hidden" name="id" value={r.id} /><button className="text-rose-600 hover:underline" type="submit">Delete</button></form>
                  </div>
                </td>
              </tr>
            ))}
            {schedules.length === 0 && <tr><td className="td text-slate-400" colSpan={9}>No schedules yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card p-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">New schedule</h3>
        <ScheduleForm reports={REPORTS.map((r) => ({ id: r.id, title: r.title, filters: r.filters }))} options={options} />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Run history &amp; report inbox</h3>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Started</th><th className="th">Schedule</th><th className="th">Trigger</th><th className="th">Outcome</th><th className="th">Rows</th><th className="th">Detail</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="td text-xs">{formatDateTime(r.startedAt)}</td>
                  <td className="td">{r.report.name}</td>
                  <td className="td text-xs capitalize">{r.trigger}</td>
                  <td className="td"><StatusBadge status={r.status === "success" ? "completed" : "failed"} /></td>
                  <td className="td">{r.rowCount ?? "—"}</td>
                  <td className="td text-xs">{r.error ? <span className="text-rose-600">{r.error}</span> : <Link className="text-blue-600 hover:underline" href={`/admin/scheduled-reports/runs/${r.id}`}>Open delivered report</Link>}</td>
                </tr>
              ))}
              {runs.length === 0 && <tr><td className="td text-slate-400" colSpan={6}>Nothing has run yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
