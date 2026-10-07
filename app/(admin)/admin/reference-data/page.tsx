import { prisma } from "@/lib/prisma";
import Banner from "@/components/Banner";
import StatusBadge from "@/components/StatusBadge";
import { addReferenceItem, setDefaultTaxRate, toggleReferenceItem } from "@/app/actions/reference-actions";
import { PAYMENT_TERMS } from "@/lib/masterdata";
import { DEFAULT_BANKS } from "@/lib/reference";

export default async function ReferenceDataPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  const items = await prisma.referenceItem.findMany({ orderBy: [{ kind: "asc" }, { value: "asc" }, { label: "asc" }] });
  const terms = items.filter((i) => i.kind === "payment_term");
  const banks = items.filter((i) => i.kind === "bank");
  const taxes = items.filter((i) => i.kind === "tax_rate");
  const usage = await prisma.outlet.groupBy({ by: ["paymentTerms"], _count: true });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Financial Reference Data</h2>
        <p className="mt-1 text-sm text-slate-500">
          Payment terms, banks and tax rates are maintained here and used across the platform: customer terms and due dates, cheque bank selection and the tax shown on invoices. Changes are audited; an entry in use is switched off, never deleted.
        </p>
      </div>
      <Banner error={error} notice={notice} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Payment terms</h3>
          <ul className="space-y-1.5 text-sm">
            {(terms.length ? terms : PAYMENT_TERMS.map((t) => ({ id: t.id, code: t.id, label: t.label, value: t.id === "cash" ? 0 : Number(t.id.replace("credit_", "")), status: "active", isDefault: false, kind: "payment_term", createdAt: new Date() }))).map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2">
                <span>{t.label} <span className="text-xs text-slate-400">· {t.value} day(s) · {usage.find((u) => u.paymentTerms === t.code)?._count ?? 0} customer(s)</span></span>
                <span className="flex items-center gap-2"><StatusBadge status={t.status} />{terms.length > 0 && <form action={toggleReferenceItem}><input type="hidden" name="id" value={t.id} /><button className="text-xs text-blue-600 hover:underline" type="submit">{t.status === "active" ? "Switch off" : "Switch on"}</button></form>}</span>
              </li>
            ))}
          </ul>
          <form action={addReferenceItem} className="mt-4 space-y-2 border-t border-slate-100 pt-3">
            <input type="hidden" name="kind" value="payment_term" />
            <input className="input" name="label" placeholder="Name, e.g. Credit — 60 days" required />
            <input className="input" name="value" type="number" min={0} max={365} placeholder="Credit days (0 = cash)" required />
            <button className="btn-secondary w-full" type="submit">Add payment term</button>
          </form>
          {terms.length === 0 && <p className="mt-2 text-[11px] text-slate-400">Showing the built-in terms. Adding one saves the whole list for editing.</p>}
        </div>

        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Banks (cheque drawee)</h3>
          <ul className="max-h-64 space-y-1.5 overflow-y-auto text-sm">
            {(banks.length ? banks.map((b) => ({ id: b.id, label: b.label, status: b.status, real: true })) : DEFAULT_BANKS.map((b) => ({ id: b, label: b, status: "active", real: false }))).map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2">
                <span>{b.label}</span>
                <span className="flex items-center gap-2"><StatusBadge status={b.status} />{b.real && <form action={toggleReferenceItem}><input type="hidden" name="id" value={b.id} /><button className="text-xs text-blue-600 hover:underline" type="submit">{b.status === "active" ? "Switch off" : "Switch on"}</button></form>}</span>
              </li>
            ))}
          </ul>
          <form action={addReferenceItem} className="mt-4 space-y-2 border-t border-slate-100 pt-3">
            <input type="hidden" name="kind" value="bank" />
            <input className="input" name="label" placeholder="Bank name" required />
            <button className="btn-secondary w-full" type="submit">Add bank</button>
          </form>
        </div>

        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Tax rates</h3>
          <ul className="space-y-1.5 text-sm">
            {taxes.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2">
                <span>{t.code.toUpperCase()} — {t.label} <span className="text-xs text-slate-400">· {t.value}%</span> {t.isDefault && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-800">default</span>}</span>
                <span className="flex items-center gap-2">
                  <StatusBadge status={t.status} />
                  {!t.isDefault && t.status === "active" && <form action={setDefaultTaxRate}><input type="hidden" name="id" value={t.id} /><button className="text-xs text-blue-600 hover:underline" type="submit">Make default</button></form>}
                  <form action={toggleReferenceItem}><input type="hidden" name="id" value={t.id} /><button className="text-xs text-slate-500 hover:underline" type="submit">{t.status === "active" ? "Off" : "On"}</button></form>
                </span>
              </li>
            ))}
            {taxes.length === 0 && <li className="text-xs text-slate-400">No tax rates configured — 12% VAT is applied.</li>}
          </ul>
          <form action={addReferenceItem} className="mt-4 space-y-2 border-t border-slate-100 pt-3">
            <input type="hidden" name="kind" value="tax_rate" />
            <input className="input" name="code" placeholder="Tax code, e.g. VAT12" required />
            <input className="input" name="label" placeholder="Description, e.g. Value-added tax" required />
            <input className="input" name="value" type="number" step="0.01" min={0} max={100} placeholder="Rate %" required />
            <button className="btn-secondary w-full" type="submit">Add tax rate</button>
          </form>
        </div>
      </div>
    </div>
  );
}
