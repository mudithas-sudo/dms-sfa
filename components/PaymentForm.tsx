"use client";

import { useState } from "react";
import { recordPayment } from "@/app/actions/finance-actions";
import { PAYMENT_MODES } from "@/lib/payment-modes";

interface InvoiceRow {
  id: string;
  number: string;
  date: string;
  due: string;
  outstanding: number;
  overdue: boolean;
}

// Records a customer payment: mode-specific fields appear for cheques and bank transfers, and the amount can be
// matched to chosen invoices or left to settle the oldest first.
export default function PaymentForm({ outletId, invoices, today, banks = [] }: { outletId: string; invoices: InvoiceRow[]; today: string; banks?: string[] }) {
  const [method, setMethod] = useState("cash");
  const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <form action={recordPayment} className="space-y-4">
      <input type="hidden" name="outletId" value={outletId} />
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr><th className="th w-8"></th><th className="th">Invoice</th><th className="th">Date</th><th className="th">Due</th><th className="th">Open balance</th><th className="th">Apply (₱)</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoices.map((i) => (
              <tr key={i.id}>
                <td className="td"><input type="checkbox" name="invoiceId" value={i.id} className="h-4 w-4 rounded border-slate-300" /></td>
                <td className="td font-medium text-slate-900">{i.number}</td>
                <td className="td text-xs">{i.date}</td>
                <td className={`td text-xs ${i.overdue ? "font-medium text-rose-600" : ""}`}>{i.due}{i.overdue ? " · overdue" : ""}</td>
                <td className="td">{peso(i.outstanding)}</td>
                <td className="td"><input className="input w-28" type="number" step="0.01" min={0} name={`amount_${i.id}`} defaultValue={i.outstanding} /></td>
              </tr>
            ))}
            {invoices.length === 0 && <tr><td className="td text-slate-400" colSpan={6}>No open invoices — a payment will be kept as unapplied credit.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400">Tick invoices to match the payment to them, or leave all unticked to settle the oldest first. Anything left over stays as unapplied credit.</p>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="method">Payment mode</label>
          <select className="input" id="method" name="method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_MODES.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="amount">Amount received (₱)</label>
          <input className="input" id="amount" name="amount" type="number" step="0.01" min={0.01} required />
        </div>
        <div>
          <label className="label" htmlFor="reference">{method === "bank_transfer" ? "Transfer reference *" : "Receipt / reference"}</label>
          <input className="input" id="reference" name="reference" required={method === "bank_transfer"} placeholder={method === "bank_transfer" ? "Bank reference no." : "OR number (optional)"} />
        </div>
      </div>

      {method === "cheque" && (
        <div className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 sm:grid-cols-4">
          <div>
            <label className="label" htmlFor="chequeNumber">Cheque no. *</label>
            <input className="input" id="chequeNumber" name="chequeNumber" required />
          </div>
          <div>
            <label className="label" htmlFor="chequeBank">Bank *</label>
            <input className="input" id="chequeBank" name="chequeBank" list="bank-list" required />
            <datalist id="bank-list">{banks.map((b) => <option key={b} value={b} />)}</datalist>
          </div>
          <div>
            <label className="label" htmlFor="chequeBranch">Branch</label>
            <input className="input" id="chequeBranch" name="chequeBranch" />
          </div>
          <div>
            <label className="label" htmlFor="chequeDate">Cheque date *</label>
            <input className="input" id="chequeDate" name="chequeDate" type="date" defaultValue={today} required />
          </div>
          <p className="text-[11px] text-amber-800 sm:col-span-4">A cheque dated in the future is held as pending and only reduces the balance once it is cleared. The same cheque cannot be recorded twice.</p>
        </div>
      )}
      <button type="submit" className="btn-primary">Record payment</button>
    </form>
  );
}
