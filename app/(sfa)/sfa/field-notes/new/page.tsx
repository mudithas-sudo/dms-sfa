import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { createFieldNote } from "@/app/actions/sfa-actions";
import { Camera } from "lucide-react";

const TYPE_LABELS: Record<string, string> = {
  shelf_audit: "Customer Stock Check / Shelf Audit",
  merchandising: "Merchandising Insight",
  competitor: "Competitor Observation",
};

export default async function NewFieldNotePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; outlet?: string }>;
}) {
  const { branchId } = await getSession();
  const { type: typeParam, outlet: outletParam } = await searchParams;
  const type = typeParam && TYPE_LABELS[typeParam] ? typeParam : "shelf_audit";

  const outlets = branchId ? await prisma.outlet.findMany({ where: { branchId, status: "active" }, orderBy: { name: "asc" } }) : [];

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">Field Execution Note</h2>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {Object.entries(TYPE_LABELS).map(([value, label]) => (
          <a
            key={value}
            href={`/sfa/field-notes/new?type=${value}${outletParam ? `&outlet=${outletParam}` : ""}`}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${type === value ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {label}
          </a>
        ))}
      </div>

      <form action={createFieldNote} className="card space-y-4 p-4">
        <input type="hidden" name="type" value={type} />
        <div>
          <label className="label" htmlFor="outletId">Outlet</label>
          <select className="input" id="outletId" name="outletId" defaultValue={outletParam} required>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="notes">{TYPE_LABELS[type]}</label>
          <textarea
            className="input"
            id="notes"
            name="notes"
            rows={5}
            required
            placeholder={
              type === "shelf_audit"
                ? "Facing counts, planogram compliance, out-of-stock items..."
                : type === "merchandising"
                  ? "Display requests, shelf space issues, POSM needs..."
                  : "Competitor pricing, promotions, or activity observed..."
            }
          />
        </div>
        <button type="button" className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 py-6 text-sm text-slate-400">
          <Camera size={18} /> Tap to attach photo (placeholder)
        </button>
        <button type="submit" className="btn-primary w-full">Submit</button>
      </form>
    </div>
  );
}
