import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import PhotoCapture from "@/components/PhotoCapture";
import { submitFieldForm } from "@/app/actions/sfa-field-actions";
import { COMPETITOR_BRANDS, DISPLAY_TYPES } from "@/lib/field-constants";

const TYPE_LABELS: Record<string, string> = {
  shelf_audit: "Shelf audit",
  merchandising: "Merchandising insight",
  competitor: "Competitor observation",
};

export default async function NewFieldNotePage({ searchParams }: { searchParams: Promise<{ type?: string; outlet?: string; error?: string }> }) {
  const { branchId, userId } = await getSession();
  const { type: typeParam, outlet: outletParam, error } = await searchParams;
  const type = typeParam && TYPE_LABELS[typeParam] ? typeParam : "shelf_audit";

  const [outlets, products, open] = await Promise.all([
    branchId ? prisma.outlet.findMany({ where: { branchId, status: "active" }, orderBy: { name: "asc" } }) : [],
    type === "shelf_audit" ? prisma.product.findMany({ where: { status: "active" }, orderBy: [{ category: "asc" }, { name: "asc" }], take: 14 }) : [],
    userId ? prisma.fieldVisit.findFirst({ where: { salespersonId: userId, status: "in_progress" } }) : null,
  ]);
  const outletId = outletParam ?? open?.outletId ?? outlets[0]?.id;

  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold text-slate-900">Field execution</h2>
      <Banner error={error} />
      <div className="flex gap-2 overflow-x-auto pb-1">
        {Object.entries(TYPE_LABELS).map(([value, label]) => (
          <a key={value} href={`/sfa/field-notes/new?type=${value}${outletId ? `&outlet=${outletId}` : ""}`} className={`inline-flex min-h-[40px] shrink-0 items-center rounded-full px-4 text-xs font-medium ${type === value ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>
            {label}
          </a>
        ))}
      </div>

      <form action={submitFieldForm} className="card space-y-3 p-4">
        <input type="hidden" name="type" value={type} />
        <div>
          <label className="label" htmlFor="outletId">Customer</label>
          <select className="input" id="outletId" name="outletId" defaultValue={outletId} required>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>

        {type === "shelf_audit" && (
          <div>
            <p className="label">Products on the shelf</p>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {products.map((p) => (
                <div key={p.id} className="px-2 py-1.5">
                  <input type="hidden" name={`seen_${p.id}`} value="1" />
                  <p className="text-xs font-medium text-slate-900">{p.name}</p>
                  <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-600">
                    <label className="flex items-center gap-1"><input type="checkbox" name={`avail_${p.id}`} defaultChecked /> Available</label>
                    <label className="flex items-center gap-1">Facings <input className="input w-14 py-0.5 text-xs" type="number" min={0} name={`facings_${p.id}`} defaultValue={2} /></label>
                    <label className="flex items-center gap-1"><input type="checkbox" name={`exp_${p.id}`} /> Expiry risk</label>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {type === "merchandising" && (
          <div className="space-y-2">
            <div>
              <label className="label" htmlFor="display">Display type *</label>
              <select className="input" id="display" name="display" defaultValue="">
                <option value="">— choose —</option>
                {DISPLAY_TYPES.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" name="posm" /> Point-of-sale material in place</label>
            <div>
              <label className="label" htmlFor="shelfShare">Our share of shelf (%)</label>
              <input className="input" id="shelfShare" name="shelfShare" type="number" min={0} max={100} />
            </div>
            <input className="input" name="opportunity" placeholder="Opportunity / request (e.g. extra facing, chiller space)" />
          </div>
        )}

        {type === "competitor" && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="brand">Competitor brand *</label>
                <select className="input" id="brand" name="brand" defaultValue="">
                  <option value="">— choose —</option>
                  {COMPETITOR_BRANDS.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="price">Shelf price (₱)</label>
                <input className="input" id="price" name="price" type="number" step="0.01" min={0} />
              </div>
            </div>
            <input className="input" name="product" placeholder="Product observed *" />
            <input className="input" name="promotion" placeholder="Promotion running (if any)" />
          </div>
        )}

        <textarea className="input" name="notes" rows={3} placeholder="Notes (optional)" />
        <PhotoCapture label="Add photo" max={3} />
        <button type="submit" className="btn-primary w-full">Submit</button>
        <p className="text-[10px] text-slate-400">Forms are tied to your visit, the customer, your branch and a GPS-stamped time, and feed the supervisor&apos;s field activity report.</p>
      </form>
    </div>
  );
}
