"use client";

import { useState } from "react";
import { saveStockRequest } from "@/app/actions/van-actions";

interface Row {
  id: string;
  name: string;
  sku: string;
  vanBalance: number;
  warehouse: number;
  suggested: number;
}

// Multi-line stock request: shows the van balance and warehouse availability for each product so the request
// is realistic, with a rules-based suggestion the rep can accept or adjust.
export default function StockRequestForm({ rows, defaultDate }: { rows: Row[]; defaultDate: string }) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [q, setQ] = useState("");
  const shown = rows.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()) || r.sku.toLowerCase().includes(q.toLowerCase()));
  const lines = Object.values(qty).filter((n) => n > 0).length;

  return (
    <form action={saveStockRequest} className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">Needed on</label>
          <input className="input" type="date" name="requiredDate" defaultValue={defaultDate} />
        </div>
        <div>
          <label className="label">Search</label>
          <input className="input" placeholder="Name or code" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => setQty(Object.fromEntries(rows.filter((r) => r.suggested > 0).map((r) => [r.id, r.suggested])))}>
        Use the suggested quantities (from your recent sales)
      </button>
      <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
        {shown.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2 px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-slate-900">{r.name}</p>
              <p className="text-[10px] text-slate-500">On van {r.vanBalance} · Warehouse {r.warehouse}{r.suggested > 0 ? ` · Suggest ${r.suggested}` : ""}</p>
            </div>
            <input
              className="input w-16 py-1 text-xs"
              type="number"
              min={0}
              name={`qty_${r.id}`}
              value={qty[r.id] ?? ""}
              placeholder="0"
              onChange={(e) => setQty((s) => ({ ...s, [r.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
            />
          </div>
        ))}
      </div>
      <input className="input" name="remarks" placeholder="Note for the warehouse (optional)" />
      <div className="flex gap-2">
        <button type="submit" name="intent" value="submit" className="btn-primary flex-1" disabled={lines === 0}>Submit {lines > 0 ? `(${lines} items)` : ""}</button>
        <button type="submit" name="intent" value="draft" className="btn-secondary" disabled={lines === 0}>Save draft</button>
      </div>
    </form>
  );
}
