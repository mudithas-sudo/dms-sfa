import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import StatusBadge from "@/components/StatusBadge";
import PaymentForm from "@/components/PaymentForm";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { invoiceBalance, outletBalance, isEffectivePayment, CREDIT_STATUS_LABEL } from "@/lib/finance";
import { requestArReversal } from "@/app/actions/supervisor-actions";
import { bankOptions } from "@/lib/reference";
import { clearCheque, bounceCheque, applyUnapplied } from "@/app/actions/finance-actions";

export default async function PaymentReconciliationPage({ searchParams }: { searchParams: Promise<{ outlet?: string; error?: string; notice?: string }> }) {
  const { branchId } = await getSession();
  const { outlet: outletIdParam, error, notice } = await searchParams;

  const outlets = await prisma.outlet.findMany({ where: { ...(branchId ? { branchId } : {}), status: { in: ["active", "blocked"] } }, orderBy: { name: "asc" } });
  const selected = outlets.find((o) => o.id === outletIdParam) ?? outlets[0];

  const [invoices, entries, balance] = selected
    ? await Promise.all([
        prisma.invoice.findMany({ where: { outletId: selected.id, status: { in: ["unpaid", "partially_paid", "overdue"] } }, include: { arLedgerEntries: true }, orderBy: { invoiceDate: "asc" } }),
        prisma.aRLedgerEntry.findMany({ where: { outletId: selected.id, type: { in: ["payment", "credit_note", "debit_note", "adjustment", "write_off", "reversal", "payment_application"] } }, orderBy: { entryDate: "desc" }, take: 40, include: { reversalRequests: true } }),
        outletBalance(selected.id),
      ])
    : [[], [], 0];

  const now = new Date();
  const open = invoices.map((inv) => ({ inv, bal: invoiceBalance(inv, { includePending: true }) })).filter((o) => o.bal > 0);
  const rows = open.map(({ inv, bal }) => ({ id: inv.id, number: inv.invoiceNumber, date: formatDate(inv.invoiceDate), due: formatDate(inv.dueDate), outstanding: bal, overdue: inv.dueDate < now }));

  // cheques grouped by reference
  const chequeGroups = new Map<string, typeof entries>();
  for (const e of entries.filter((x) => x.method === "cheque" && x.type === "payment")) {
    chequeGroups.set(e.reference ?? e.id, [...(chequeGroups.get(e.reference ?? e.id) ?? []), e]);
  }
  const cheques = [...chequeGroups.entries()].map(([ref, es]) => ({ ref, es, total: es.reduce((s, e) => s + e.amount, 0), head: es[0] }));
  const unapplied = entries.filter((e) => e.unappliedAmount > 0 && isEffectivePayment(e) && e.recStatus !== "reversed");
  const history = entries.filter((e) => ["payment", "credit_note"].includes(e.type)).slice(0, 12);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Payment Reconciliation</h2>
        <p className="text-sm text-slate-500">Record cash, cheque and bank-transfer payments, match them to invoices, clear or bounce cheques and apply unapplied credit.</p>
      </div>
      <Banner error={error} notice={notice} />

      <form className="card flex flex-wrap items-end gap-3 p-4" method="get">
        <div>
          <label className="label" htmlFor="outlet">Customer</label>
          <select className="input" id="outlet" name="outlet" defaultValue={selected?.id}>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-secondary">Load</button>
        {selected && (
          <div className="ml-auto flex flex-wrap items-center gap-4 text-sm">
            <span className="text-slate-500">Balance <strong className="text-slate-900">{formatCurrency(balance)}</strong></span>
            <span className="text-slate-500">Limit <strong className="text-slate-900">{formatCurrency(selected.creditLimit)}</strong></span>
            <StatusBadge status={selected.creditStatus} />
            <Link href="/supervisor/credit" className="text-xs text-blue-600 hover:underline">{CREDIT_STATUS_LABEL[selected.creditStatus]} · credit control</Link>
          </div>
        )}
      </form>

      {selected && (
        <div className="card p-6">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Record a payment</h3>
          <PaymentForm banks={await bankOptions()} outletId={selected.id} invoices={rows} today={now.toISOString().slice(0, 10)} />
        </div>
      )}

      {cheques.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Cheques</h3>
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr><th className="th">Cheque</th><th className="th">Bank</th><th className="th">Cheque date</th><th className="th">Amount</th><th className="th">Status</th><th className="th"></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cheques.map(({ ref, total, head }) => {
                  const bounced = head.paymentStatus === "bounced";
                  const pending = head.paymentStatus === "pending";
                  return (
                    <tr key={ref}>
                      <td className="td font-medium text-slate-900">{head.chequeNumber}<p className="text-[11px] font-normal text-slate-400">{ref}</p></td>
                      <td className="td text-xs">{head.chequeBank}{head.chequeBranch ? ` · ${head.chequeBranch}` : ""}</td>
                      <td className="td text-xs">{head.chequeDate ? formatDate(head.chequeDate) : "—"}{pending && head.chequeDate && head.chequeDate > now ? " (post-dated)" : ""}</td>
                      <td className="td">{formatCurrency(total)}</td>
                      <td className="td"><StatusBadge status={bounced ? "reversed" : head.paymentStatus ?? "cleared"} /></td>
                      <td className="td text-right">
                        {!bounced && (
                          <div className="flex flex-wrap justify-end gap-2">
                            {pending && (
                              <form action={clearCheque}>
                                <input type="hidden" name="outletId" value={selected?.id} /><input type="hidden" name="reference" value={ref} />
                                <button className="btn-secondary px-2 py-1 text-xs" type="submit">Mark cleared</button>
                              </form>
                            )}
                            <form action={bounceCheque} className="flex gap-1">
                              <input type="hidden" name="outletId" value={selected?.id} /><input type="hidden" name="reference" value={ref} />
                              <input className="input w-32 py-1 text-xs" name="reason" placeholder="Bounce reason" />
                              <button className="text-xs text-rose-600 hover:underline" type="submit">{pending ? "Bounced" : "Bounced — request reversal"}</button>
                            </form>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">A pending cheque does not reduce the customer&apos;s balance. A cleared cheque that bounces needs an approved reversal; the customer is then put on watch.</p>
        </div>
      )}

      {unapplied.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Unapplied credit</h3>
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Date</th><th className="th">Source</th><th className="th">Available</th><th className="th">Apply to invoice</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {unapplied.map((e) => (
                  <tr key={e.id}>
                    <td className="td text-xs">{formatDateTime(e.entryDate)}</td>
                    <td className="td capitalize">{e.type.replace(/_/g, " ")} <span className="text-xs text-slate-400">{e.reference}</span></td>
                    <td className="td font-medium">{formatCurrency(e.unappliedAmount)}</td>
                    <td className="td">
                      {open.length === 0 ? (
                        <span className="text-xs text-slate-400">No open invoices</span>
                      ) : (
                        <form action={applyUnapplied} className="flex flex-wrap gap-2">
                          <input type="hidden" name="outletId" value={selected?.id} /><input type="hidden" name="entryId" value={e.id} />
                          <select className="input w-52 py-1 text-xs" name="invoiceId">
                            {open.map((o) => (
                              <option key={o.inv.id} value={o.inv.id}>{o.inv.invoiceNumber} · {formatCurrency(o.bal)}</option>
                            ))}
                          </select>
                          <input className="input w-24 py-1 text-xs" name="amount" type="number" step="0.01" min={0.01} defaultValue={e.unappliedAmount} />
                          <button className="btn-secondary px-2 py-1 text-xs" type="submit">Apply</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Recent payments &amp; credit notes</h3>
        <p className="mb-2 text-xs text-slate-500">A posted entry can&apos;t be edited — correcting one means requesting a reversal, which reaches the approvals queue like any other financial correction.</p>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr><th className="th">Date</th><th className="th">Type</th><th className="th">Mode</th><th className="th">Amount</th><th className="th">Reference</th><th className="th"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.map((e) => {
                const pendingReversal = e.reversalRequests.some((r) => r.status === "pending");
                const reversed = e.recStatus === "reversed";
                return (
                  <tr key={e.id} className={reversed ? "text-slate-400" : ""}>
                    <td className="td text-xs">{formatDateTime(e.entryDate)}</td>
                    <td className="td capitalize">{e.type.replace(/_/g, " ")}</td>
                    <td className="td text-xs capitalize">{e.method?.replace("_", " ") ?? "—"}{e.paymentStatus === "pending" ? " · pending" : ""}</td>
                    <td className="td">{formatCurrency(Math.abs(e.amount))}</td>
                    <td className="td text-xs text-slate-500">{e.reference ?? "—"}</td>
                    <td className="td text-right">
                      {reversed ? (
                        <span className="text-xs text-slate-400">Reversed</span>
                      ) : pendingReversal ? (
                        <span className="text-xs text-amber-600">Reversal pending</span>
                      ) : (
                        <form action={requestArReversal} className="flex justify-end gap-2">
                          <input type="hidden" name="arLedgerEntryId" value={e.id} />
                          <input className="input w-40" name="reason" placeholder="Reason for reversal" required />
                          <button type="submit" className="text-xs text-rose-600 hover:underline">Request reversal</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
              {history.length === 0 && <tr><td className="td text-slate-400" colSpan={6}>No payments or credit notes recorded for this customer yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
