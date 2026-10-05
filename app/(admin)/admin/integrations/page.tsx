import { Cable, ShieldCheck, Smartphone, Printer } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import { INTEGRATIONS, SECURITY_MEASURES, PLATFORM_SCALE_NOTE, MDM_POLICY_NOTE, APPROVED_PRINTERS } from "@/lib/constants";

export default function IntegrationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Integrations & Platform</h2>
        <p className="mt-1 text-sm text-slate-500">
          Data exchange happens only through defined, agreed interfaces — never a direct connection to the ERP
          or another core system — behind a single API gateway providing authentication, rate limiting and
          logging. Every integration below is simulated in this prototype with a static status indicator.
        </p>
      </div>

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

      <div>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Smartphone size={16} className="text-slate-500" /> Field Device Governance
        </h3>
        <div className="card p-4">
          <p className="text-xs text-slate-500">{MDM_POLICY_NOTE}</p>
        </div>
        <div className="card mt-3 overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th"><Printer size={14} className="mr-1 inline" />Printer Model</th>
                <th className="th">Connection</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {APPROVED_PRINTERS.map((p) => (
                <tr key={p.model}>
                  <td className="td font-medium text-slate-900">{p.model}</td>
                  <td className="td">{p.connection}</td>
                  <td className="td"><StatusBadge status={p.status} /></td>
                </tr>
              ))}
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
