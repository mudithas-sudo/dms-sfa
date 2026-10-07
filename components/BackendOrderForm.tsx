"use client";

import { useEffect, useMemo, useState } from "react";
import { previewBackendOrder, createBackendOrder } from "@/app/actions/sales-actions";

interface Product {
  id: string;
  name: string;
  sku: string;
  unitPrice: number;
  category: string;
  minOrderQty: number;
}
interface Outlet {
  id: string;
  name: string;
  code: string | null;
  address: string;
  paymentTerms: string;
}
type Preview = Awaited<ReturnType<typeof previewBackendOrder>>;

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TONE = { pass: "text-emerald-700 bg-emerald-50", warn: "text-amber-800 bg-amber-50", block: "text-rose-800 bg-rose-50" } as const;
const ICON = { pass: "✓", warn: "!", block: "✕" } as const;
const TERMS: Record<string, string> = { cash: "Cash on delivery", credit_15: "Credit — 15 days", credit_30: "Credit — 30 days", credit_45: "Credit — 45 days" };

// Branch-staff order screen: the customer's status, credit position and price list appear on selection, products
// are added by code or search, and every validation outcome is shown at once before anything is saved.
export default function BackendOrderForm({ outlets, products }: { outlets: Outlet[]; products: Product[] }) {
  const [outletId, setOutletId] = useState(outlets[0]?.id ?? "");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [override, setOverride] = useState(0);
  const [result, setResult] = useState<{ key: string; preview: Preview } | null>(null);

  const items = useMemo(() => Object.entries(qty).filter(([, q]) => q > 0).map(([productId, q]) => ({ productId, qty: q })), [qty]);
  const outlet = outlets.find((o) => o.id === outletId);
  const key = JSON.stringify([outletId, items, override]);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await previewBackendOrder(outletId, items, override);
      if (!cancelled) setResult({ key, preview: r });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [key, outletId, items, override]);
  const preview = result?.preview ?? null;
  const busy = result?.key !== key;

  const shown = products.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase()));
  const lineOf = (id: string) => preview?.lines.find((l) => l.productId === id);

  return (
    <form action={createBackendOrder} className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-4">
        <div className="card p-5">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label" htmlFor="outletId">Customer</label>
              <select className="input" id="outletId" name="outletId" value={outletId} onChange={(e) => setOutletId(e.target.value)} required>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}{o.code ? ` (${o.code})` : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="paymentTerms">Payment terms (defaults from the customer)</label>
              <select className="input" id="paymentTerms" name="paymentTerms" key={outletId} defaultValue={outlet?.paymentTerms}>
                {Object.entries(TERMS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="requestedDeliveryDate">Requested delivery date</label>
              <input className="input" id="requestedDeliveryDate" name="requestedDeliveryDate" type="date" />
            </div>
            <div>
              <label className="label" htmlFor="deliveryAddress">Delivery address</label>
              <input className="input" id="deliveryAddress" name="deliveryAddress" key={outletId} defaultValue={outlet?.address} />
            </div>
          </div>
          <div className="mt-3">
            <label className="label" htmlFor="remarks">Remarks for the warehouse / delivery</label>
            <input className="input" id="remarks" name="remarks" placeholder="e.g. phone order from the owner, deliver before noon" />
          </div>
        </div>

        <div className="card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Products</h3>
            <input className="input max-w-xs" placeholder="Search by code or name" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-b border-slate-200 bg-white">
                <tr>
                  <th className="th">Product</th>
                  <th className="th">List price</th>
                  <th className="th">Qty</th>
                  <th className="th">Price for this customer</th>
                  <th className="th">Line total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((p) => {
                  const l = lineOf(p.id);
                  return (
                    <tr key={p.id}>
                      <td className="td">
                        <span className="font-medium text-slate-900">{p.name}</span>
                        <div className="text-xs text-slate-400">{p.sku} · min {p.minOrderQty}</div>
                      </td>
                      <td className="td">{peso(p.unitPrice)}</td>
                      <td className="td">
                        <input
                          className="input w-20"
                          type="number"
                          min={0}
                          name={`qty_${p.id}`}
                          value={qty[p.id] ?? 0}
                          onChange={(e) => setQty((q) => ({ ...q, [p.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
                        />
                      </td>
                      <td className="td text-xs">
                        {l ? (
                          <>
                            {peso(l.unitPrice)}
                            {l.promos.length > 0 && <div className="text-emerald-700">{l.promos.join(", ")}</div>}
                            {preview?.hints[p.id] && <div className="text-blue-700">{preview.hints[p.id]}</div>}
                          </>
                        ) : (
                          preview?.hints[p.id] && <span className="text-blue-700">{preview.hints[p.id]}</span>
                        )}
                      </td>
                      <td className="td">{l ? peso(l.lineTotal) : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="card p-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Customer position</h3>
          {preview ? (
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Status</dt><dd className="font-medium capitalize">{preview.outlet.status}{preview.outlet.creditStatus !== "active" ? ` · credit ${preview.outlet.creditStatus.replace("_", " ")}` : ""}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Channel</dt><dd>{preview.outlet.channel}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Credit limit</dt><dd>{peso(preview.outlet.creditLimit)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Outstanding</dt><dd>{peso(preview.position.outstanding)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Overdue</dt><dd className={preview.position.overdueAmount > 0 ? "font-medium text-rose-600" : ""}>{peso(preview.position.overdueAmount)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Open orders</dt><dd>{peso(preview.position.openOrderValue)}</dd></div>
              <div className="flex justify-between border-t border-slate-100 pt-1"><dt className="text-slate-500">Available credit</dt><dd className="font-medium">{peso(Math.max(0, preview.outlet.creditLimit - preview.position.outstanding))}</dd></div>
            </dl>
          ) : (
            <p className="text-xs text-slate-400">Loading…</p>
          )}
        </div>

        <div className="card p-5">
          <h3 className="mb-2 flex items-center justify-between text-sm font-semibold text-slate-900">
            Order summary {busy && <span className="text-xs font-normal text-slate-400">checking…</span>}
          </h3>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd>{peso(preview?.subtotal ?? 0)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Promotions &amp; discounts</dt><dd className="text-emerald-700">−{peso(preview?.discountTotal ?? 0)}</dd></div>
            <div className="flex justify-between border-t border-slate-100 pt-1 text-base font-semibold"><dt>Total</dt><dd>{peso(preview?.total ?? 0)}</dd></div>
          </dl>
          <div className="mt-4 border-t border-slate-100 pt-3">
            <label className="label" htmlFor="overridePct">Discount override request (%) — beyond the configured rules</label>
            <input className="input" id="overridePct" name="overridePct" type="number" min={0} max={100} step="0.5" value={override || ""} onChange={(e) => setOverride(Number(e.target.value) || 0)} placeholder="0" />
            {override > 0 && <input className="input mt-2" name="overrideReason" placeholder="Reason (required)" required />}
          </div>
        </div>

        <div className="card p-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Validation</h3>
          <ul className="space-y-1.5">
            {(preview?.checks ?? []).map((c) => (
              <li key={c.id} className={`rounded-md px-2.5 py-1.5 text-xs ${TONE[c.outcome]}`}>
                <span className="mr-1 font-bold">{ICON[c.outcome]}</span>
                <span className="font-medium">{c.label}:</span> {c.message}
              </li>
            ))}
            {(preview?.checks.length ?? 0) === 0 && <li className="text-xs text-slate-400">Add products to see every check at once.</li>}
          </ul>
          <p className="mt-2 text-[11px] text-slate-400">Pass = continues · Warning = continues with a note · Block = the order is held for a supervisor decision (severity is configurable).</p>
        </div>

        <div className="flex gap-2">
          <button type="submit" name="intent" value="submit" className="btn-primary flex-1" disabled={items.length === 0}>Submit order</button>
          <button type="submit" name="intent" value="draft" className="btn-secondary" disabled={items.length === 0}>Save draft</button>
        </div>
      </div>
    </form>
  );
}
