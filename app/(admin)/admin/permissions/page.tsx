import { Check, Minus } from "lucide-react";

const ROLES = ["Admin", "Branch Ops", "Supervisor", "Sales Rep", "Management"] as const;

const MATRIX: { capability: string; access: Record<(typeof ROLES)[number], boolean> }[] = [
  { capability: "Manage master data (branches, outlets, products, pricing)", access: { Admin: true, "Branch Ops": false, Supervisor: false, "Sales Rep": false, Management: false } },
  { capability: "Approve outlet onboarding", access: { Admin: true, "Branch Ops": false, Supervisor: false, "Sales Rep": false, Management: false } },
  { capability: "Configure promotions & standing discounts", access: { Admin: true, "Branch Ops": false, Supervisor: false, "Sales Rep": false, Management: false } },
  { capability: "View audit log", access: { Admin: true, "Branch Ops": false, Supervisor: false, "Sales Rep": false, Management: true } },
  { capability: "Receive purchase orders / manage warehouse stock", access: { Admin: false, "Branch Ops": true, Supervisor: false, "Sales Rep": false, Management: false } },
  { capability: "Approve stock transfers & adjustments", access: { Admin: false, "Branch Ops": true, Supervisor: true, "Sales Rep": false, Management: false } },
  { capability: "Load / unload van stock", access: { Admin: false, "Branch Ops": true, Supervisor: false, "Sales Rep": false, Management: false } },
  { capability: "Approve credit-limit exceptions & discount overrides", access: { Admin: false, "Branch Ops": false, Supervisor: true, "Sales Rep": false, Management: false } },
  { capability: "Void an invoiced order", access: { Admin: false, "Branch Ops": false, Supervisor: true, "Sales Rep": false, Management: false } },
  { capability: "Review & settle promo claims", access: { Admin: false, "Branch Ops": false, Supervisor: true, "Sales Rep": false, Management: false } },
  { capability: "Reconcile payments against invoices", access: { Admin: false, "Branch Ops": false, Supervisor: true, "Sales Rep": false, Management: false } },
  { capability: "Capture orders, collections & field visits", access: { Admin: false, "Branch Ops": false, Supervisor: false, "Sales Rep": true, Management: false } },
  { capability: "Submit leave & expense requests", access: { Admin: false, "Branch Ops": false, Supervisor: false, "Sales Rep": true, Management: false } },
  { capability: "View cross-branch dashboards (read-only)", access: { Admin: true, "Branch Ops": false, Supervisor: false, "Sales Rep": false, Management: true } },
  { capability: "Export reports (CSV / print)", access: { Admin: true, "Branch Ops": false, Supervisor: true, "Sales Rep": false, Management: true } },
];

export default function PermissionsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">RBAC Permission Matrix</h2>
        <p className="mt-1 text-sm text-slate-500">
          A read-only view of what each role can see and do. This prototype does not enforce
          these rules server-side — the role switcher stands in for real authentication — but this
          is the access model the platform is designed around.
        </p>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Capability</th>
              {ROLES.map((r) => (
                <th key={r} className="th text-center">{r}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {MATRIX.map((row) => (
              <tr key={row.capability}>
                <td className="td">{row.capability}</td>
                {ROLES.map((r) => (
                  <td key={r} className="td text-center">
                    {row.access[r] ? (
                      <Check size={16} className="mx-auto text-emerald-600" aria-label={`${r} can: ${row.capability}`} />
                    ) : (
                      <Minus size={16} className="mx-auto text-slate-300" aria-label={`${r} cannot: ${row.capability}`} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
