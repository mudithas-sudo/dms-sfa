import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";
import { createScheduledReport, toggleScheduledReport } from "@/app/actions/admin-actions";

const REPORT_TYPES = [
  { value: "sales_summary", label: "Sales Summary" },
  { value: "ar_aging", label: "AR Aging" },
  { value: "inventory_valuation", label: "Inventory Valuation" },
  { value: "claims_status", label: "Claims Status" },
];

export default async function ScheduledReportsPage() {
  const reports = await prisma.scheduledReport.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <div className="space-y-6">
      <h2 className="text-base font-semibold text-slate-900">Scheduled Reports</h2>
      <p className="text-sm text-slate-500">
        Configuration only — this prototype has no real cron runner. Each row records what
        <em> would</em> run and when; &quot;Last run&quot; is illustrative.
      </p>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Name</th>
              <th className="th">Type</th>
              <th className="th">Schedule</th>
              <th className="th">Recipients</th>
              <th className="th">Last Run</th>
              <th className="th">Status</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {reports.map((r) => (
              <tr key={r.id}>
                <td className="td font-medium text-slate-900">{r.name}</td>
                <td className="td capitalize">{r.reportType.replace(/_/g, " ")}</td>
                <td className="td">{r.scheduleDescription}</td>
                <td className="td text-xs text-slate-500">{r.recipientEmails}</td>
                <td className="td text-xs">{r.lastRunAt ? formatDateTime(r.lastRunAt) : "Never run"}</td>
                <td className="td"><StatusBadge status={r.status} /></td>
                <td className="td text-right">
                  <form action={toggleScheduledReport}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="nextStatus" value={r.status === "active" ? "inactive" : "active"} />
                    <button type="submit" className="text-xs text-blue-600 hover:underline">
                      {r.status === "active" ? "Pause" : "Activate"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card max-w-lg p-6">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">New Scheduled Report</h3>
        <form action={createScheduledReport} className="space-y-4">
          <div>
            <label className="label" htmlFor="name">Report Name</label>
            <input className="input" id="name" name="name" required />
          </div>
          <div>
            <label className="label" htmlFor="reportType">Report Type</label>
            <select className="input" id="reportType" name="reportType" defaultValue="sales_summary">
              {REPORT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="scheduleDescription">Schedule</label>
            <input className="input" id="scheduleDescription" name="scheduleDescription" required placeholder="e.g. Every Monday 8:00 AM" />
          </div>
          <div>
            <label className="label" htmlFor="recipientEmails">Recipients</label>
            <input className="input" id="recipientEmails" name="recipientEmails" placeholder="comma-separated emails" />
          </div>
          <button type="submit" className="btn-primary">Create Schedule</button>
        </form>
      </div>
    </div>
  );
}
