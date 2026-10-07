import { Cable, ShieldCheck, Activity, Database } from "lucide-react";
import { prisma } from "@/lib/prisma";
import Banner from "@/components/Banner";
import StatusBadge from "@/components/StatusBadge";
import { INTEGRATIONS, SECURITY_MEASURES, PLATFORM_SCALE_NOTE } from "@/lib/constants";
import { CONNECTOR_LABEL, type Connector } from "@/lib/integration";
import { formatDateTime, daysAgo } from "@/lib/format";
import { resolveIntegrationMessage, setSimulatedOutage, runBiExtract, toggleBiConsumer } from "@/app/actions/platform-actions";

const DATASETS = [
  { id: "sales", label: "Sales", schedule: "Hourly, incremental" },
  { id: "inventory", label: "Inventory", schedule: "Hourly, incremental" },
  { id: "purchasing", label: "Purchasing", schedule: "Daily 05:30" },
  { id: "claims", label: "Claims", schedule: "Daily 05:45" },
  { id: "receivables", label: "Receivables", schedule: "Daily 06:00" },
  { id: "master_data", label: "Master data", schedule: "Daily 05:00" },
];

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  const since = daysAgo(1);
  const [messages, failNext, extracts, consumers] = await Promise.all([
    prisma.integrationMessage.findMany({ orderBy: { createdAt: "desc" }, take: 300 }),
    prisma.appSetting.findUnique({ where: { key: "integration.failNext" } }),
    prisma.biExtract.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
    prisma.appSetting.findMany({ where: { key: { startsWith: "bi.consumer." } } }),
  ]);
  const revoked = new Set(consumers.filter((c) => c.value === "revoked").map((c) => c.key.replace("bi.consumer.", "")));
  const queue = messages.filter((m) => m.status === "error" || m.status === "retrying");
  const connectors = Object.keys(CONNECTOR_LABEL) as Connector[];

  const stats = connectors.map((c) => {
    const ms = messages.filter((m) => m.connector === c);
    const recent = ms.filter((m) => m.createdAt >= since);
    const errors = recent.filter((m) => m.status === "error").length;
    return {
      connector: c,
      total: ms.length,
      recent: recent.length,
      errors,
      queueDepth: ms.filter((m) => m.status === "error" || m.status === "retrying").length,
      resolved: ms.filter((m) => m.status === "resolved").length,
      last: ms[0]?.createdAt,
    };
  });
  const byDoc = new Map<string, { connector: string; docType: string; ok: number; err: number; resolved: number; discarded: number }>();
  for (const m of messages) {
    const k = `${m.connector}/${m.docType}`;
    const r = byDoc.get(k) ?? { connector: m.connector, docType: m.docType, ok: 0, err: 0, resolved: 0, discarded: 0 };
    if (m.status === "ok") r.ok++;
    else if (m.status === "resolved") r.resolved++;
    else if (m.status === "discarded") r.discarded++;
    else r.err++;
    byDoc.set(k, r);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Integrations & API Gateway</h2>
        <p className="mt-1 text-sm text-slate-500">
          Data exchange happens only through defined, agreed interfaces behind a single API gateway that authenticates each system, limits request rates and logs every call.
          No system connects to the database directly. The connected systems here are simulated, but every message the DMS exchanges is logged, failures wait in the error queue,
          and an administrator can correct and resend them.
        </p>
      </div>
      <Banner error={error} notice={notice} />

      <div className="card divide-y divide-slate-100">
        {INTEGRATIONS.map((it) => (
          <div key={it.name} className="flex items-start justify-between gap-4 p-4">
            <div className="flex items-start gap-3">
              <Cable size={18} className="mt-0.5 shrink-0 text-slate-400" />
              <div>
                <p className="text-sm font-medium text-slate-900">{it.name}</p>
                <p className="mt-0.5 text-xs text-slate-500">{it.value}</p>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <StatusBadge status="simulated" />
              <p className="mt-1 text-[11px] text-slate-400">{it.lastSync}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="card p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900"><Activity size={16} className="text-slate-500" /> Gateway monitoring (last 24 hours)</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Interface</th>
                <th className="th">Calls (24h)</th>
                <th className="th">Failures</th>
                <th className="th">Error queue depth</th>
                <th className="th">Corrected &amp; resent</th>
                <th className="th">Last message</th>
                <th className="th">Health</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stats.map((s) => (
                <tr key={s.connector}>
                  <td className="td font-medium text-slate-900">{CONNECTOR_LABEL[s.connector]}</td>
                  <td className="td">{s.recent}</td>
                  <td className="td">{s.errors}</td>
                  <td className="td">{s.queueDepth}</td>
                  <td className="td">{s.resolved}</td>
                  <td className="td text-xs">{s.last ? formatDateTime(s.last) : "—"}</td>
                  <td className="td">
                    <span className={`badge ${s.queueDepth > 0 ? "badge-red" : "badge-green"}`}>{s.queueDepth > 0 ? "Needs attention" : "Healthy"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form action={setSimulatedOutage} className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <span className="text-xs text-slate-600">Demo control — simulate an interface outage: fail the next</span>
          <input className="input w-20" name="count" type="number" min={0} max={20} defaultValue={Number(failNext?.value ?? 0) || 3} />
          <span className="text-xs text-slate-600">gateway messages</span>
          <button className="btn-secondary" type="submit">Apply</button>
          {Number(failNext?.value ?? 0) > 0 && <span className="text-xs font-medium text-amber-700">Outage active: {failNext?.value} message(s) will fail</span>}
        </form>
      </div>

      <div className="card p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Error queue ({queue.length})</h3>
        <div className="space-y-3">
          {queue.map((m) => (
            <div key={m.id} className="rounded-lg border border-rose-200 bg-rose-50/40 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {CONNECTOR_LABEL[m.connector as Connector]} · {m.direction} · {m.docType}
                  </p>
                  <p className="text-xs text-slate-600">Reference {m.reference} · {formatDateTime(m.createdAt)} · {m.retryCount} retry attempt(s)</p>
                  <p className="mt-1 text-xs text-rose-700">{m.error}</p>
                </div>
                <form action={resolveIntegrationMessage} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={m.id} />
                  <input className="input w-48 py-1 text-xs" name="correction" placeholder="Correction note (optional)" />
                  <button className="btn-primary px-3 py-1 text-xs" type="submit" name="action" value="resend">Correct &amp; resend</button>
                  <input className="input w-40 py-1 text-xs" name="reason" placeholder="Reason to discard" />
                  <button className="btn-secondary px-3 py-1 text-xs" type="submit" name="action" value="discard">Discard</button>
                </form>
              </div>
            </div>
          ))}
          {queue.length === 0 && <p className="text-sm text-slate-400">The error queue is empty — every message was delivered.</p>}
        </div>
      </div>

      <div className="card p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Reconciliation by interface</h3>
        <p className="mb-2 text-xs text-slate-500">Per-interface counts compared with what the connected system acknowledged; items present on one side only (failed or discarded) are highlighted.</p>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Interface</th>
                <th className="th">Document</th>
                <th className="th">Acknowledged</th>
                <th className="th">Resent OK</th>
                <th className="th">On one side only</th>
                <th className="th">Discarded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...byDoc.values()].map((r) => (
                <tr key={`${r.connector}${r.docType}`} className={r.err > 0 ? "bg-rose-50/40" : ""}>
                  <td className="td">{CONNECTOR_LABEL[r.connector as Connector]}</td>
                  <td className="td">{r.docType.replace(/_/g, " ")}</td>
                  <td className="td">{r.ok}</td>
                  <td className="td">{r.resolved}</td>
                  <td className="td font-medium">{r.err}</td>
                  <td className="td">{r.discarded}</td>
                </tr>
              ))}
              {byDoc.size === 0 && (
                <tr>
                  <td className="td text-slate-400" colSpan={6}>No messages exchanged yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900"><Database size={16} className="text-slate-500" /> Business intelligence reporting feed</h3>
        <p className="mb-3 text-xs text-slate-500">
          Governed, read-only extracts of agreed datasets — never open access to the transactional database. Each dataset has its own refresh schedule and consumer credential
          (revocable); every extract is logged with its time and row count.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Dataset</th>
                <th className="th">Schedule</th>
                <th className="th">Last extract</th>
                <th className="th">Rows</th>
                <th className="th">Consumer credential</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {DATASETS.map((d) => {
                const last = extracts.find((e) => e.dataset === d.id);
                const isRevoked = revoked.has(d.id);
                return (
                  <tr key={d.id}>
                    <td className="td font-medium text-slate-900">{d.label}</td>
                    <td className="td text-xs">{d.schedule}</td>
                    <td className="td text-xs">{last ? formatDateTime(last.createdAt) : "—"}</td>
                    <td className="td">{last?.rowCount ?? "—"}</td>
                    <td className="td">
                      <span className={`badge ${isRevoked ? "badge-red" : "badge-green"}`}>{isRevoked ? "Revoked" : "Granted"}</span>
                      <form action={toggleBiConsumer} className="ml-2 inline">
                        <input type="hidden" name="dataset" value={d.id} />
                        <input type="hidden" name="to" value={isRevoked ? "active" : "revoked"} />
                        <button className="text-xs text-blue-600 hover:underline" type="submit">{isRevoked ? "Grant" : "Revoke"}</button>
                      </form>
                    </td>
                    <td className="td text-right">
                      <form action={runBiExtract}>
                        <input type="hidden" name="dataset" value={d.id} />
                        <button className="btn-secondary px-3 py-1 text-xs" type="submit">Run extract now</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <ShieldCheck size={16} className="text-slate-500" /> Data Security Measures
        </h3>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {SECURITY_MEASURES.map((m) => (
            <div key={m.title} className="card p-4">
              <p className="text-sm font-medium text-slate-900">{m.title}</p>
              <p className="mt-1 text-xs text-slate-500">{m.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-4">
        <p className="text-xs text-slate-500">{PLATFORM_SCALE_NOTE}</p>
      </div>
    </div>
  );
}
