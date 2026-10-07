import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import { formatCurrency, formatDate } from "@/lib/format";
import { qualifyingOrders, CLAIM_DOCUMENTS } from "@/lib/claims";
import { getAllSettings, num } from "@/lib/settings";
import { createClaim } from "@/app/actions/claim-actions";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function NewClaimPage({ searchParams }: { searchParams: Promise<{ promotion?: string; from?: string; to?: string; error?: string }> }) {
  const { promotion, from, to, error } = await searchParams;
  const { branchId } = await getSession();
  const promos = await prisma.promotion.findMany({ where: { status: { in: ["active", "suspended", "expired"] } }, orderBy: { endDate: "desc" } });
  const selected = promos.find((p) => p.id === promotion);
  const start = from ? new Date(from) : selected?.startDate ?? new Date();
  const end = to ? new Date(to) : selected ? (selected.endDate < new Date() ? selected.endDate : new Date()) : new Date();
  const orders = selected ? await qualifyingOrders(selected.id, branchId, start, end) : [];
  const total = orders.reduce((s, o) => s + o.eligible, 0);
  const s = await getAllSettings();

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/supervisor/claims" className="hover:underline">Claims</Link>
        <span>/</span>
        <span className="text-slate-900">New claim</span>
      </div>
      <Banner error={error} />

      <form method="get" className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[220px] flex-1">
          <label className="label" htmlFor="promotion">Promotion</label>
          <select className="input" id="promotion" name="promotion" defaultValue={selected?.id ?? ""} required>
            <option value="">— choose —</option>
            {promos.map((p) => (
              <option key={p.id} value={p.id}>{p.name} (v{p.version}, {p.status})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="from">From</label>
          <input className="input" id="from" name="from" type="date" defaultValue={iso(start)} />
        </div>
        <div>
          <label className="label" htmlFor="to">To</label>
          <input className="input" id="to" name="to" type="date" defaultValue={iso(end)} />
        </div>
        <button className="btn-secondary" type="submit">Find qualifying orders</button>
      </form>

      {selected && (
        <form action={createClaim} className="card space-y-4 p-6">
          <input type="hidden" name="promotionId" value={selected.id} />
          <input type="hidden" name="periodStart" value={iso(start)} />
          <input type="hidden" name="periodEnd" value={iso(end)} />
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{selected.name}</h3>
            <p className="text-xs text-slate-500">
              Delivered orders in this period that earned the promotion and are not yet in another claim. Claims are accepted for {num(s, "claim.submitWindowDays")} days after the promotion ends.
            </p>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr><th className="th w-8"></th><th className="th">Order</th><th className="th">Outlet</th><th className="th">Date</th><th className="th">Units</th><th className="th">Eligible</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map((o) => (
                  <tr key={o.orderId}>
                    <td className="td"><input type="checkbox" name="orderId" value={o.orderId} defaultChecked className="h-4 w-4 rounded border-slate-300" /></td>
                    <td className="td font-medium text-slate-900">{o.orderNumber}</td>
                    <td className="td">{o.outletName}</td>
                    <td className="td text-xs">{formatDate(o.orderDate)}</td>
                    <td className="td">{o.units}</td>
                    <td className="td">{formatCurrency(o.eligible)}</td>
                  </tr>
                ))}
                {orders.length === 0 && <tr><td className="td text-slate-400" colSpan={6}>No unclaimed qualifying orders in this period.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-slate-700">Eligible total: <strong>{formatCurrency(total)}</strong></p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="amount">Amount to claim (₱)</label>
              <input className="input" id="amount" name="amount" type="number" step="0.01" min={0} defaultValue={total} />
              <p className="mt-1 text-[11px] text-slate-400">More than the eligible amount (beyond {num(s, "claim.tolerancePct")}%) needs a justification and an approved exception.</p>
            </div>
            <div>
              <label className="label" htmlFor="justification">Justification (only if above eligible)</label>
              <input className="input" id="justification" name="justification" />
            </div>
          </div>

          <div>
            <p className="label">Supporting documents</p>
            <div className="flex flex-wrap gap-3">
              {CLAIM_DOCUMENTS.map((d) => (
                <label key={d} className="flex items-center gap-1.5 text-sm text-slate-700">
                  <input type="checkbox" name="docType" value={d} className="h-4 w-4 rounded border-slate-300" /> {d}
                </label>
              ))}
            </div>
            <input className="input mt-2" type="file" name="docs" multiple />
          </div>
          <div>
            <label className="label" htmlFor="notes">Notes</label>
            <input className="input" id="notes" name="notes" />
          </div>

          <div className="flex gap-2">
            <button type="submit" name="intent" value="submit" className="btn-primary" disabled={orders.length === 0}>Submit claim</button>
            <button type="submit" name="intent" value="draft" className="btn-secondary" disabled={orders.length === 0}>Save as draft</button>
          </div>
        </form>
      )}
    </div>
  );
}
