"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordCollection } from "@/app/actions/sfa-actions";
import { PAYMENT_MODES } from "@/lib/payment-modes";
import { newRef } from "@/lib/offline-queue";

// Mobile collection: the amount settles the oldest invoices first; cheque and bank-transfer details are captured
// at the point of collection so the receipt and the ledger carry them.
export default function CollectionForm({ outlets, selected, outstanding, today, banks = [] }: { outlets: { id: string; name: string }[]; selected?: string; outstanding: number; today: string; banks?: string[] }) {
  const router = useRouter();
  const [method, setMethod] = useState("cash");
  const [ref] = useState(() => newRef());
  return (
    <form action={recordCollection} className="card space-y-4 p-4">
      <input type="hidden" name="clientRef" value={ref} />
      <div>
        <label className="label" htmlFor="outletId">Outlet</label>
        <select className="input" id="outletId" name="outletId" defaultValue={selected} onChange={(e) => router.push(`/sfa/collections/new?outlet=${e.target.value}`)}>
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </div>
      <div className="rounded-lg bg-slate-50 p-3 text-sm">
        Outstanding balance: <span className="font-semibold">₱{outstanding.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="method">Payment mode</label>
          <select className="input" id="method" name="method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_MODES.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="amount">Amount (₱)</label>
          <input className="input" id="amount" name="amount" type="number" step="0.01" min={0.01} required />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="reference">{method === "bank_transfer" ? "Transfer reference *" : "Reference / OR number"}</label>
        <input className="input" id="reference" name="reference" required={method === "bank_transfer"} placeholder={method === "bank_transfer" ? "Bank reference" : "Optional"} />
      </div>
      {method === "cheque" && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div>
            <label className="label" htmlFor="chequeNumber">Cheque no. *</label>
            <input className="input" id="chequeNumber" name="chequeNumber" required />
          </div>
          <div>
            <label className="label" htmlFor="chequeDate">Cheque date *</label>
            <input className="input" id="chequeDate" name="chequeDate" type="date" defaultValue={today} required />
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
          <p className="col-span-2 text-[11px] text-amber-800">A post-dated cheque is held as pending until its date. The same cheque cannot be recorded twice.</p>
        </div>
      )}
      <button type="submit" className="btn-primary w-full">Record payment</button>
    </form>
  );
}
