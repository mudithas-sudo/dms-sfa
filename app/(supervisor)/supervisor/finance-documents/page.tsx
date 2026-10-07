import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import StatusBadge from "@/components/StatusBadge";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { getAllSettings, num } from "@/lib/settings";
import { invoiceBalance } from "@/lib/finance";
import { requestCreditNote, requestFinancialDocument } from "@/app/actions/finance-actions";

export default async function FinanceDocumentsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { branchId } = await getSession();
  const { error, notice } = await searchParams;
  const s = await getAllSettings();
  const outletWhere = branchId ? { outlet: { branchId } } : {};
  const [outlets, openInvoices, docs, notes] = await Promise.all([
    prisma.outlet.findMany({ where: { ...(branchId ? { branchId } : {}), status: { in: ["active", "blocked"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.invoice.findMany({ where: { ...(branchId ? { branchId } : {}), status: { in: ["unpaid", "partially_paid", "overdue"] } }, include: { arLedgerEntries: true, outlet: { select: { name: true } } }, orderBy: { invoiceDate: "desc" }, take: 80 }),
    prisma.financialDocument.findMany({ where: branchId ? { outletId: { in: (await prisma.outlet.findMany({ where: { branchId }, select: { id: true } })).map((o) => o.id) } } : {}, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.creditNote.findMany({ where: outletWhere, orderBy: { issuedAt: "desc" }, take: 30, include: { outlet: { select: { name: true } } } }),
  ]);
  const outletName = new Map(outlets.map((o) => [o.id, o.name]));
  const invoiceOptions = openInvoices.map((i) => ({ id: i.id, label: `${i.invoiceNumber} · ${i.outlet.name} · ${formatCurrency(invoiceBalance(i))} open` }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Debit Notes, Adjustments, Write-offs &amp; Credit Notes</h2>
        <p className="text-xs text-slate-500">
          Every document needs a reason and goes through approval before it posts to the customer ledger. Debit notes and adjustments up to ₱{num(s, "finance.docSupervisorLimit").toLocaleString()} are approved by a supervisor;
          larger amounts and every write-off go to head office finance. Credit notes above ₱{num(s, "creditNote.supervisorLimit").toLocaleString()} also go to head office.
        </p>
      </div>
      <Banner error={error} notice={notice} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-6">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">New debit note / adjustment / write-off</h3>
          <form action={requestFinancialDocument} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="type">Document</label>
                <select className="input" id="type" name="type" defaultValue="debit_note">
                  <option value="debit_note">Debit note (customer owes more)</option>
                  <option value="adjustment">Adjustment</option>
                  <option value="write_off">Write-off (bad debt)</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="direction">Adjustment direction</label>
                <select className="input" id="direction" name="direction" defaultValue="increase">
                  <option value="increase">Increase balance</option>
                  <option value="decrease">Decrease balance</option>
                </select>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="outletId">Customer</label>
              <select className="input" id="outletId" name="outletId" required>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="invoiceId">Invoice (required for a write-off)</label>
              <select className="input" id="invoiceId" name="invoiceId" defaultValue="">
                <option value="">— none —</option>
                {invoiceOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label" htmlFor="amount">Amount (₱)</label>
                <input className="input" id="amount" name="amount" type="number" step="0.01" min={0.01} required />
              </div>
              <div className="col-span-2">
                <label className="label" htmlFor="reason">Reason</label>
                <input className="input" id="reason" name="reason" required placeholder="e.g. Price correction on INV-…" />
              </div>
            </div>
            <button type="submit" className="btn-primary">Submit for approval</button>
          </form>
        </div>

        <div className="card p-6">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">New credit note</h3>
          <form action={requestCreditNote} className="space-y-3">
            <div>
              <label className="label" htmlFor="cnOutlet">Customer</label>
              <select className="input" id="cnOutlet" name="outletId" required>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="cnInvoice">Apply to invoice (optional)</label>
              <select className="input" id="cnInvoice" name="invoiceId" defaultValue="">
                <option value="">— keep as unapplied credit —</option>
                {invoiceOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label" htmlFor="cnAmount">Amount (₱)</label>
                <input className="input" id="cnAmount" name="amount" type="number" step="0.01" min={0.01} required />
              </div>
              <div className="col-span-2">
                <label className="label" htmlFor="cnReason">Reason</label>
                <input className="input" id="cnReason" name="reason" required placeholder="e.g. Goodwill for late delivery" />
              </div>
            </div>
            <button type="submit" className="btn-primary">Raise credit note</button>
            <p className="text-[11px] text-slate-400">Credit notes from market returns are raised on the Market Returns screen.</p>
          </form>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Documents</h3>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Number</th><th className="th">Type</th><th className="th">Customer</th><th className="th">Amount</th><th className="th">Reason</th><th className="th">Requested</th><th className="th">Status</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {docs.map((d) => (
                <tr key={d.id}>
                  <td className="td font-medium text-slate-900">{d.docNumber}</td>
                  <td className="td text-xs capitalize">{d.type.replace("_", " ")}{d.type === "adjustment" ? ` (${d.direction})` : ""}</td>
                  <td className="td">{outletName.get(d.outletId) ?? "—"}</td>
                  <td className="td">{formatCurrency(d.amount)}</td>
                  <td className="td max-w-[240px] text-xs text-slate-500">{d.reason}{d.decisionNote ? ` — ${d.decisionNote}` : ""}</td>
                  <td className="td text-xs">{d.requestedBy}<br />{formatDateTime(d.createdAt)}</td>
                  <td className="td"><StatusBadge status={d.status} /></td>
                </tr>
              ))}
              {docs.length === 0 && <tr><td className="td text-slate-400" colSpan={7}>No debit notes, adjustments or write-offs yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Credit notes</h3>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Number</th><th className="th">Customer</th><th className="th">Amount</th><th className="th">Reason</th><th className="th">Issued</th><th className="th">Status</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {notes.map((n) => (
                <tr key={n.id}>
                  <td className="td font-medium text-slate-900">{n.noteNumber}</td>
                  <td className="td">{n.outlet.name}</td>
                  <td className="td">{formatCurrency(n.amount)}</td>
                  <td className="td max-w-[260px] text-xs text-slate-500">{n.reason}</td>
                  <td className="td text-xs">{n.issuedBy}<br />{formatDateTime(n.issuedAt)}</td>
                  <td className="td"><StatusBadge status={n.status} /></td>
                </tr>
              ))}
              {notes.length === 0 && <tr><td className="td text-slate-400" colSpan={6}>No credit notes yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
