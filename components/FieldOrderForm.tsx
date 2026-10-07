"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fieldOrderContext, previewFieldOrder, submitFieldOrder, suggestedQuantities, type SubmitInput, type SubmitResult } from "@/app/actions/sfa-order-actions";
import SignaturePad from "@/components/SignaturePad";
import { enqueue, isOffline, newRef } from "@/lib/offline-queue";

interface Product {
  id: string;
  name: string;
  sku: string;
  brand: string | null;
  category: string;
  unitPrice: number;
  unitsPerPack: number;
  packMultiple: number;
  minOrderQty: number;
}
interface Outlet {
  id: string;
  name: string;
}
type Ctx = NonNullable<Awaited<ReturnType<typeof fieldOrderContext>>>;
type Preview = Awaited<ReturnType<typeof previewFieldOrder>>;

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TONE = { pass: "text-emerald-700", warn: "text-amber-700", block: "text-rose-700" } as const;
const ICON = { pass: "✓", warn: "!", block: "✕" } as const;

// The field order screen: customer position and delivery calendar, a filterable catalogue with live pricing and
// promotion hints, the same validation results the branch sees, and a pre-sales or van-sale choice.
export default function FieldOrderForm({
  outlets, products, promoLabels, defaultOutletId, draft,
}: {
  outlets: Outlet[];
  products: Product[];
  promoLabels: Record<string, string>;
  defaultOutletId?: string;
  draft?: { id: string; outletId: string; orderType: string; items: { productId: string; qty: number }[]; remarks: string | null; clientRef: string | null } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [clientRef] = useState(() => draft?.clientRef ?? newRef());
  const [outletId, setOutletId] = useState(draft?.outletId ?? defaultOutletId ?? outlets[0]?.id ?? "");
  const [orderType, setOrderType] = useState<"pre_sales" | "van_sale">((draft?.orderType as "pre_sales" | "van_sale") ?? "pre_sales");
  const [qty, setQty] = useState<Record<string, number>>(Object.fromEntries((draft?.items ?? []).map((i) => [i.productId, i.qty])));
  const [packMode, setPackMode] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [promoOnly, setPromoOnly] = useState(false);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [result, setResult] = useState<{ key: string; preview: Preview } | null>(null);
  const [date, setDate] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [urgentReason, setUrgentReason] = useState("");
  const [remarks, setRemarks] = useState(draft?.remarks ?? "");
  const [signatory, setSignatory] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);
  const [declinedReason, setDeclinedReason] = useState("");
  const [override, setOverride] = useState(0);
  const [overrideReason, setOverrideReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const items = useMemo(() => Object.entries(qty).filter(([, q]) => q > 0).map(([productId, q]) => ({ productId, qty: q })), [qty]);
  const key = JSON.stringify([outletId, items, orderType, override]);
  const pmap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const brands = useMemo(() => [...new Set(products.map((p) => p.brand).filter(Boolean))].sort() as string[], [products]);
  const categories = useMemo(() => [...new Set(products.map((p) => p.category))].sort(), [products]);

  useEffect(() => {
    let off = false;
    fieldOrderContext(outletId).then((c) => {
      if (!off && c) setCtx(c);
    });
    return () => {
      off = true;
    };
  }, [outletId]);

  useEffect(() => {
    if (items.length === 0) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await previewFieldOrder(outletId, items, orderType, override);
      if (!cancelled) setResult({ key, preview: r });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [key, outletId, items, orderType, override]);
  const preview = items.length > 0 && result?.key === key ? result.preview : null;
  const busy = items.length > 0 && result?.key !== key;
  const lineOf = (id: string) => preview?.lines.find((l) => l.productId === id);

  const shown = products.filter(
    (p) => (!search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase())) && (!brand || p.brand === brand) && (!category || p.category === category) && (!promoOnly || promoLabels[p.id]),
  );
  const setBase = (id: string, n: number) => setQty((s) => ({ ...s, [id]: Math.max(0, Math.floor(n || 0)) }));

  const reorderLast = () => ctx?.lastOrder && setQty(Object.fromEntries(ctx.lastOrder.items.map((i) => [i.productId, i.qty])));
  const suggest = async () => setQty(await suggestedQuantities(outletId, products.map((p) => p.id)));

  const send = (intent: "submit" | "draft") => {
    setMsg(null);
    const input: SubmitInput = {
      outletId, items, orderType, intent, clientRef: clientRef, draftId: draft?.id,
      requestedDeliveryDate: orderType === "pre_sales" ? date || undefined : undefined,
      urgent: orderType === "pre_sales" ? urgent : false, urgentReason: urgent ? urgentReason : undefined,
      signatoryName: signatory, signatureDataUrl: declined ? null : signature, declinedReason: declined ? declinedReason : undefined,
      remarks, overridePct: override || undefined, overrideReason: override ? overrideReason : undefined,
      devicePrices: Object.fromEntries((preview?.lines ?? []).map((l) => [l.productId, l.unitPrice])),
    };
    if (isOffline()) {
      if (orderType === "van_sale" && intent === "submit") return setMsg({ ok: false, text: "A van sale needs a live check of the van stock — go online, or save it as a pre-sales order or draft." });
      enqueue({ id: clientRef, kind: "order", label: `${outlets.find((o) => o.id === outletId)?.name ?? "Order"} · ${items.length} lines`, payload: input });
      return setMsg({ ok: true, text: "Saved on the device — it will be sent from the Sync centre when you are back online." });
    }
    start(async () => {
      const r: SubmitResult = await submitFieldOrder(input);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok && r.status !== "draft") setTimeout(() => router.push(`/sfa/orders?highlight=${r.orderNumber}`), 1200);
    });
  };

  const unitLabel = (p: Product) => (packMode[p.id] && p.unitsPerPack > 1 ? `pack ×${p.unitsPerPack}` : "pc");
  const days = ctx?.calendar.days ?? [];

  return (
    <div className="space-y-3 pb-24">
      <div className="card space-y-2 p-3">
        <label className="label" htmlFor="outlet">Customer</label>
        <select className="input" id="outlet" value={outletId} onChange={(e) => setOutletId(e.target.value)}>
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        {ctx && (
          <div className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
            <p>
              Credit limit {peso(ctx.outlet.creditLimit)} · owes {peso(ctx.position.outstanding)} · open orders {peso(ctx.position.openOrderValue)} ·{" "}
              <strong className={ctx.available < 0 ? "text-rose-600" : "text-slate-900"}>available {peso(ctx.available)}</strong>
            </p>
            {ctx.outlet.creditStatus !== "active" && <p className="mt-1 font-medium text-amber-700">Credit status: {ctx.outlet.creditStatus.replace("_", " ")}</p>}
            {ctx.position.overdueAmount > 0 && <p className="mt-1 font-medium text-rose-600">Overdue {peso(ctx.position.overdueAmount)} ({ctx.position.oldestOverdueDays} days, {ctx.overdueInvoices} invoice(s)) — consider collecting before selling.</p>}
            {ctx.dataAge && <p className="mt-1 text-amber-700">{ctx.dataAge}</p>}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setOrderType("pre_sales")} className={`rounded-lg border px-2 py-2 text-xs font-medium ${orderType === "pre_sales" ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>
            Pre-sales order<span className="block text-[10px] font-normal">delivered later from the warehouse</span>
          </button>
          <button type="button" disabled={!ctx?.hasVan} onClick={() => setOrderType("van_sale")} className={`rounded-lg border px-2 py-2 text-xs font-medium disabled:opacity-40 ${orderType === "van_sale" ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>
            Van sale<span className="block text-[10px] font-normal">sold &amp; delivered now from your van</span>
          </button>
        </div>
      </div>

      <div className="card space-y-2 p-3">
        <input className="input" placeholder="Search name or code" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <select className="input py-1 text-xs" value={brand} onChange={(e) => setBrand(e.target.value)}><option value="">All brands</option>{brands.map((b) => <option key={b}>{b}</option>)}</select>
          <select className="input py-1 text-xs" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{categories.map((c) => <option key={c}>{c}</option>)}</select>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1"><input type="checkbox" checked={promoOnly} onChange={(e) => setPromoOnly(e.target.checked)} /> Promoted only</label>
          <button type="button" className="text-blue-600 underline" onClick={reorderLast} disabled={!ctx?.lastOrder}>Reorder last{ctx?.lastOrder ? ` (${ctx.lastOrder.number})` : ""}</button>
          <button type="button" className="text-blue-600 underline" onClick={suggest}>Suggested</button>
        </div>
        {ctx && ctx.topProducts.length > 0 && (
          <p className="text-[11px] text-slate-500">Top products here: {ctx.topProducts.map((t) => `${pmap.get(t.productId)?.name ?? "?"} (${t.qty})`).join(", ")}</p>
        )}
        <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white">
          {shown.map((p) => {
            const l = lineOf(p.id);
            const base = qty[p.id] ?? 0;
            const factor = packMode[p.id] && p.unitsPerPack > 1 ? p.unitsPerPack : 1;
            const stock = ctx?.sellable[p.id];
            return (
              <div key={p.id} className="px-2 py-1.5">
                <div className="flex items-start gap-2">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[10px] font-semibold text-slate-400">{p.sku.slice(-3)}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-slate-900">{p.name}</p>
                    <p className="text-[10px] text-slate-500">{p.brand ?? p.category} · {peso(p.unitPrice)} · min {p.minOrderQty}{p.packMultiple > 1 ? ` · ×${p.packMultiple}` : ""}{orderType === "van_sale" && stock !== undefined ? ` · van ${stock}` : ""}</p>
                    {promoLabels[p.id] && <p className="text-[10px] font-medium text-emerald-700">🎁 {promoLabels[p.id]}</p>}
                    {preview?.hints[p.id] && <p className="text-[10px] text-blue-600">{preview.hints[p.id]}</p>}
                    {l && base > 0 && <p className="text-[10px] text-slate-600">{peso(l.lineTotal)}{l.discount > 0 ? ` (−${peso(l.discount)}${l.promos.length ? ` · ${l.promos.join(", ")}` : ""})` : ""}{l.free ? ` · ${l.free} free` : ""}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <input className="input w-16 py-1 text-right text-xs" type="number" min={0} value={base ? Math.round(base / factor) : ""} placeholder="0" onChange={(e) => setBase(p.id, Number(e.target.value) * factor)} />
                    {p.unitsPerPack > 1 ? (
                      <button type="button" className="text-[10px] text-blue-600 underline" onClick={() => setPackMode((s) => ({ ...s, [p.id]: !s[p.id] }))}>{unitLabel(p)}</button>
                    ) : (
                      <span className="text-[10px] text-slate-400">pc</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {orderType === "pre_sales" && (
        <div className="card space-y-2 p-3">
          <p className="text-xs font-semibold text-slate-900">Delivery</p>
          <p className="text-[11px] text-slate-500">Orders placed before {ctx?.calendar.cutoffHour ?? 14}:00 follow the standard lead time. Earliest date: <strong>{ctx?.calendar.earliest}</strong></p>
          <div className="flex flex-wrap gap-1">
            {days.map((d) => (
              <button key={d.date} type="button" disabled={!d.ok && !urgent} title={d.reason ?? ""} onClick={() => setDate(d.date)} className={`rounded-md border px-2 py-1 text-[10px] ${date === d.date ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"} disabled:bg-slate-50 disabled:text-slate-300 disabled:line-through`}>
                {d.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgent request (outside the calendar — flagged to the branch)</label>
          {urgent && <input className="input" placeholder="Why is it urgent? *" value={urgentReason} onChange={(e) => setUrgentReason(e.target.value)} />}
        </div>
      )}

      <div className="card space-y-2 p-3">
        <input className="input" placeholder="Remarks (optional)" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-600">Request a discount beyond the rules</summary>
          <div className="mt-2 grid grid-cols-[80px_1fr] gap-2">
            <input className="input" type="number" min={0} max={100} value={override || ""} placeholder="%" onChange={(e) => setOverride(Number(e.target.value))} />
            <input className="input" placeholder="Reason (required)" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
          </div>
        </details>
      </div>

      {preview && (
        <div className="card space-y-1 p-3">
          <p className="text-xs font-semibold text-slate-900">Checks {busy && <span className="font-normal text-slate-400">— updating…</span>}</p>
          {preview.checks.filter((c) => c.outcome !== "pass").map((c) => (
            <p key={c.id} className={`text-[11px] ${TONE[c.outcome]}`}>{ICON[c.outcome]} <strong>{c.label}:</strong> {c.message}</p>
          ))}
          {preview.checks.every((c) => c.outcome === "pass") && <p className="text-[11px] text-emerald-700">✓ All checks passed.</p>}
          {preview.orderPromos.length > 0 && <p className="text-[11px] text-emerald-700">🎁 Order promotion: {preview.orderPromos.join(", ")}</p>}
        </div>
      )}

      {orderType === "van_sale" && (
        <div className="card space-y-2 p-3">
          <p className="text-xs font-semibold text-slate-900">Customer acknowledgement</p>
          <input className="input" placeholder="Name of the person receiving the goods *" value={signatory} onChange={(e) => setSignatory(e.target.value)} />
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={declined} onChange={(e) => setDeclined(e.target.checked)} /> Customer declined to sign</label>
          {declined ? <input className="input" placeholder="Reason for declining *" value={declinedReason} onChange={(e) => setDeclinedReason(e.target.value)} /> : <SignaturePad onChange={setSignature} />}
        </div>
      )}
      {orderType === "pre_sales" && (
        <details className="card p-3 text-xs">
          <summary className="cursor-pointer text-slate-600">Customer signature (optional for pre-sales)</summary>
          <div className="mt-2 space-y-2">
            <input className="input" placeholder="Signatory name" value={signatory} onChange={(e) => setSignatory(e.target.value)} />
            <SignaturePad onChange={setSignature} />
          </div>
        </details>
      )}

      {msg && <p className={`rounded-lg px-3 py-2 text-xs ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{msg.text}</p>}

      <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white px-4 py-3">
        <div className="mb-2 flex justify-between text-sm">
          <span className="text-slate-500">{items.length} line(s){preview && preview.discountTotal > 0 ? ` · saves ${peso(preview.discountTotal)}` : ""}</span>
          <strong className="text-slate-900">{preview ? peso(preview.total) : "—"}</strong>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-primary flex-1" disabled={pending || items.length === 0} onClick={() => send("submit")}>
            {pending ? "Sending…" : orderType === "van_sale" ? "Complete van sale" : "Submit order"}
          </button>
          <button type="button" className="btn-secondary" disabled={pending || items.length === 0} onClick={() => send("draft")}>Save draft</button>
        </div>
      </div>
    </div>
  );
}
