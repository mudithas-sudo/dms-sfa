"use client";

import { useState } from "react";
import SignaturePad from "@/components/SignaturePad";
import { confirmDelivery } from "@/app/actions/sales-actions";

interface Line {
  id: string;
  name: string;
  qty: number;
}

const REASONS = ["Customer accepted fewer units", "Damaged on delivery", "Outlet closed / not received", "Wrong item", "Customer refused", "Other"];

// Records what the customer actually accepted, who signed, and why anything was short.
export default function DeliveryForm({ invoiceId, lines }: { invoiceId: string; lines: Line[] }) {
  const [sig, setSig] = useState<string | null>(null);
  return (
    <form action={confirmDelivery} className="space-y-3">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="signatureDataUrl" value={sig ?? ""} />
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200">
          <tr>
            <th className="th">Product</th>
            <th className="th">Invoiced</th>
            <th className="th">Delivered</th>
            <th className="th">Shortfall reason</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lines.map((l) => (
            <tr key={l.id}>
              <td className="td">{l.name}</td>
              <td className="td">{l.qty}</td>
              <td className="td"><input className="input w-24" type="number" min={0} max={l.qty} name={`delivered_${l.id}`} defaultValue={l.qty} /></td>
              <td className="td">
                <select className="input py-1 text-xs" name={`reason_${l.id}`} defaultValue="">
                  <option value="">— none (delivered in full) —</option>
                  {REASONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="label">Received by (name of the signatory)</label>
          <input className="input" name="receivedBy" required placeholder="Full name" />
        </div>
        <SignaturePad onChange={setSig} />
      </div>
      <button className="btn-primary" type="submit">Confirm delivery</button>
      <p className="text-xs text-slate-500">Receivables follow delivered quantities, not ordered quantities; any shortfall becomes an undelivered balance that is tracked to closure.</p>
    </form>
  );
}
