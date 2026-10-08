"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
  channelId: string | null;
}
type PromoLabels = Record<string, { text: string; channelId: string | null }[]>;
type Ctx = NonNullable<Awaited<ReturnType<typeof fieldOrderContext>>>;
type Preview = Awaited<ReturnType<typeof previewFieldOrder>>;

const peso = (n: number) => `${n < 0 ? "−" : ""}₱${Math.abs(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TONE = { pass: "text-emerald-700", warn: "text-amber-700", block: "text-rose-700" } as const;
const ICON = { pass: "✓", warn: "!", block: "✕" } as const;

// The field order screen reads top to bottom as four short steps — customer, products, delivery, review & submit.
// Nothing is fixed to the screen: the Submit and Save draft buttons are the last thing on the page, below the totals.
export default function FieldOrderForm({
  outlets, products, promoLabels, defaultOutletId, draft,
}: {
  outlets: Outlet[];
  products: Product[];
  promoLabels: PromoLabels;
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
  const [visibleCount, setVisibleCount] = useState(10);
  const [sending, setSending] = useState<"submit" | "draft" | null>(null);
  const msgRef = useRef<HTMLDivElement>(null);

  // Bring the result of Submit / Save draft into view: the message sits just above the buttons at the end of the form.
  useEffect(() => {
    if (msg) msgRef.current?.scrollIntoView({ block: "center" });
  }, [msg]);

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

  // offers are shown only when they apply to the selected customer's channel
  const channelId = outlets.find((o) => o.id === outletId)?.channelId ?? null;
  const labelOf = (productId: string) => promoLabels[productId]?.find((l) => !l.channelId || l.channelId === channelId)?.text;
  const shown = products.filter(
    (p) => (!search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase())) && (!brand || p.brand === brand) && (!category || p.category === category) && (!promoOnly || labelOf(p.id)),
  );
  const setBase = (id: string, n: number) => setQty((s) => ({ ...s, [id]: Math.max(0, Math.floor(n || 0)) }));
  // the +/− buttons add to the latest value, so two quick taps in a row both count
  const bump = (id: string, delta: number) => setQty((s) => ({ ...s, [id]: Math.max(0, (s[id] ?? 0) + delta) }));

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
    setSending(intent);
    start(async () => {
      const r: SubmitResult = await submitFieldOrder(input);
      setSending(null);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok && r.status !== "draft") setTimeout(() => router.push(`/sfa/orders?highlight=${r.orderNumber}`), 1200);
    });
  };

  const unitLabel = (p: Product) => (packMode[p.id] && p.unitsPerPack > 1 ? `pack ×${p.unitsPerPack}` : "pc");
  const days = ctx?.calendar.days ?? [];
  const filterCount = [brand, category, promoOnly].filter(Boolean).length;
  const filtering = !!search || filterCount > 0;
  const visible = filtering ? shown : shown.slice(0, visibleCount);
  const hint = items.length === 0 ? "Add at least one product to continue." : null;

  return (
    <div className="space-y-4">
      <Section n={1} title="Customer">
        <select className="input" id="outlet" aria-label="Customer" value={outletId} onChange={(e) => setOutletId(e.target.value)}>
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        {ctx && (
          <div className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div><p className="text-[10px] text-slate-500">Credit limit</p><p className="font-semibold text-slate-900">{peso(ctx.outlet.creditLimit)}</p></div>
              <div><p className="text-[10px] text-slate-500">Owes</p><p className="font-semibold text-slate-900">{peso(ctx.position.outstanding)}</p></div>
              <div><p className="text-[10px] text-slate-500">Available</p><p className={`font-semibold ${ctx.available < 0 ? "text-rose-600" : "text-emerald-700"}`}>{peso(ctx.available)}</p></div>
            </div>
            {ctx.position.openOrderValue > 0 && <p className="mt-2">Open orders not yet invoiced: {peso(ctx.position.openOrderValue)}</p>}
            {ctx.outlet.creditStatus !== "active" && <p className="mt-1 font-medium text-amber-700">Credit status: {ctx.outlet.creditStatus.replace("_", " ")}</p>}
            {ctx.position.overdueAmount > 0 && <p className="mt-1 font-medium text-rose-600">Overdue {peso(ctx.position.overdueAmount)} ({ctx.position.oldestOverdueDays} days, {ctx.overdueInvoices} invoice(s)) — consider collecting before selling.</p>}
            {ctx.dataAge && <p className="mt-1 text-amber-700">{ctx.dataAge}</p>}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Order type">
          <button type="button" aria-pressed={orderType === "pre_sales"} onClick={() => setOrderType("pre_sales")} className={`min-h-[56px] rounded-lg border px-2 py-2 text-sm font-medium ${orderType === "pre_sales" ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>
            Pre-sales order<span className="block text-[11px] font-normal">delivered later from the warehouse</span>
          </button>
          <button type="button" aria-pressed={orderType === "van_sale"} disabled={!ctx?.hasVan} onClick={() => setOrderType("van_sale")} className={`min-h-[56px] rounded-lg border px-2 py-2 text-sm font-medium disabled:opacity-40 ${orderType === "van_sale" ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>
            Van sale<span className="block text-[11px] font-normal">sold &amp; delivered now from your van</span>
          </button>
        </div>
      </Section>

      <Section
        n={2}
        title="Products"
        aside={
          <a href="#review" className="inline-flex min-h-[40px] items-center rounded-full bg-blue-50 px-4 text-xs font-medium text-blue-700">
            {items.length === 0 ? "Cart empty" : `${items.length} line${items.length === 1 ? "" : "s"} · ${preview ? peso(preview.total) : "…"}`}
          </a>
        }
      >
        <input className="input" type="search" placeholder="Search name or code" aria-label="Search products" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="min-h-[40px] rounded-full border border-slate-200 px-3 text-xs font-medium text-blue-700 disabled:text-slate-300" onClick={reorderLast} disabled={!ctx?.lastOrder}>Reorder last{ctx?.lastOrder ? ` (${ctx.lastOrder.number})` : ""}</button>
          <button type="button" className="min-h-[40px] rounded-full border border-slate-200 px-3 text-xs font-medium text-blue-700" onClick={suggest}>Suggested quantities</button>
        </div>
        <details className="rounded-lg border border-slate-200 text-xs" open={filterCount > 0}>
          <summary className="flex min-h-[44px] cursor-pointer items-center justify-between px-3 text-slate-700">
            <span>Filters{filterCount ? ` (${filterCount})` : ""}</span>
            {filterCount > 0 && <span className="text-[11px] text-blue-600">{filterCount} active</span>}
          </summary>
          <div className="space-y-2 border-t border-slate-100 p-3">
            <div className="grid grid-cols-2 gap-2">
              <select className="input" aria-label="Brand" value={brand} onChange={(e) => setBrand(e.target.value)}><option value="">All brands</option>{brands.map((b) => <option key={b}>{b}</option>)}</select>
              <select className="input" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{categories.map((c) => <option key={c}>{c}</option>)}</select>
            </div>
            <label className="flex min-h-[44px] items-center gap-2 text-sm"><input className="h-5 w-5" type="checkbox" checked={promoOnly} onChange={(e) => setPromoOnly(e.target.checked)} /> Promoted products only</label>
            {filterCount > 0 && <button type="button" className="min-h-[40px] text-xs font-medium text-blue-600" onClick={() => { setBrand(""); setCategory(""); setPromoOnly(false); }}>Clear filters</button>}
          </div>
        </details>
        {ctx && ctx.topProducts.length > 0 && (
          <p className="text-xs text-slate-500">Top products here: {ctx.topProducts.map((t) => `${pmap.get(t.productId)?.name ?? "?"} (${t.qty})`).join(", ")}</p>
        )}
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {visible.map((p) => {
            const l = lineOf(p.id);
            const base = qty[p.id] ?? 0;
            const factor = packMode[p.id] && p.unitsPerPack > 1 ? p.unitsPerPack : 1;
            const stock = ctx?.sellable[p.id];
            return (
              <li key={p.id} className={`px-3 py-3 ${base > 0 ? "bg-blue-50/40" : ""}`}>
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[11px] font-semibold text-slate-500">{p.sku.slice(-3)}</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug text-slate-900">{p.name}</p>
                    <p className="text-xs text-slate-500">{p.brand ?? p.category} · {peso(p.unitPrice)} · min {p.minOrderQty}{p.packMultiple > 1 ? ` · ×${p.packMultiple}` : ""}{orderType === "van_sale" && stock !== undefined ? ` · van ${stock}` : ""}</p>
                    {labelOf(p.id) && <p className="mt-0.5 text-xs font-medium text-emerald-700">🎁 {labelOf(p.id)}</p>}
                    {preview?.hints[p.id] && <p className="mt-0.5 text-xs text-blue-600">{preview.hints[p.id]}</p>}
                    {l && base > 0 && <p className="mt-0.5 text-xs font-medium text-slate-700">{peso(l.lineTotal)}{l.discount > 0 ? ` (−${peso(l.discount)}${l.promos.length ? ` · ${l.promos.join(", ")}` : ""})` : ""}{l.free ? ` · ${l.free} free` : ""}</p>}
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  {p.unitsPerPack > 1 ? (
                    <button type="button" className="min-h-[40px] rounded-full border border-slate-200 px-3 text-xs font-medium text-blue-700" onClick={() => setPackMode((s) => ({ ...s, [p.id]: !s[p.id] }))}>By {unitLabel(p)} — switch</button>
                  ) : (
                    <span className="text-xs text-slate-400">By piece</span>
                  )}
                  <div className="flex items-center gap-1">
                    <button type="button" aria-label={`Remove one ${p.name}`} className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 bg-white text-lg font-medium text-slate-700 active:bg-slate-100 disabled:opacity-30" disabled={base === 0} onClick={() => bump(p.id, -factor)}>−</button>
                    <input className="input h-11 w-16 text-center" type="number" inputMode="numeric" min={0} aria-label={`Quantity of ${p.name}`} value={base ? Math.round(base / factor) : ""} placeholder="0" onChange={(e) => setBase(p.id, Number(e.target.value) * factor)} />
                    <button type="button" aria-label={`Add one ${p.name}`} className="flex h-11 w-11 items-center justify-center rounded-lg border border-blue-600 bg-blue-600 text-lg font-medium text-white active:bg-blue-700" onClick={() => bump(p.id, factor)}>+</button>
                  </div>
                </div>
              </li>
            );
          })}
          {visible.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-400">No products match.</li>}
        </ul>
        {!filtering && shown.length > visibleCount && (
          <button type="button" className="btn-secondary w-full" onClick={() => setVisibleCount((n) => n + 10)}>Show {Math.min(10, shown.length - visibleCount)} more ({shown.length - visibleCount} remaining)</button>
        )}
      </Section>

      {orderType === "pre_sales" && (
        <Section n={3} title="Delivery">
          <p className="text-xs text-slate-500">Orders placed before {ctx?.calendar.cutoffHour ?? 14}:00 follow the standard lead time. Earliest date: <strong>{ctx?.calendar.earliest}</strong></p>
          <div className="flex flex-wrap gap-2">
            {days.map((d) => (
              <button key={d.date} type="button" disabled={!d.ok && !urgent} title={d.reason ?? ""} aria-pressed={date === d.date} onClick={() => setDate(d.date)} className={`min-h-[44px] rounded-lg border px-3 text-xs font-medium ${date === d.date ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"} disabled:bg-slate-50 disabled:text-slate-300 disabled:line-through`}>
                {d.label}
              </button>
            ))}
          </div>
          <label className="flex min-h-[44px] items-center gap-2 text-sm"><input className="h-5 w-5" type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgent request — outside the calendar, flagged to the branch</label>
          {urgent && <input className="input" placeholder="Why is it urgent? *" value={urgentReason} onChange={(e) => setUrgentReason(e.target.value)} />}
        </Section>
      )}

      {orderType === "van_sale" && (
        <Section n={3} title="Customer acknowledgement">
          <input className="input" placeholder="Name of the person receiving the goods *" value={signatory} onChange={(e) => setSignatory(e.target.value)} />
          <label className="flex min-h-[44px] items-center gap-2 text-sm"><input className="h-5 w-5" type="checkbox" checked={declined} onChange={(e) => setDeclined(e.target.checked)} /> Customer declined to sign</label>
          {declined ? <input className="input" placeholder="Reason for declining *" value={declinedReason} onChange={(e) => setDeclinedReason(e.target.value)} /> : <SignaturePad onChange={setSignature} />}
        </Section>
      )}

      <Section n={4} title="Review & submit" id="review">
        <input className="input" placeholder="Remarks (optional)" aria-label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        <details className="rounded-lg border border-slate-200 text-sm">
          <summary className="flex min-h-[44px] cursor-pointer items-center px-3 text-slate-700">Request a discount beyond the rules</summary>
          <div className="grid grid-cols-[88px_1fr] gap-2 border-t border-slate-100 p-3">
            <input className="input" type="number" inputMode="decimal" min={0} max={100} aria-label="Discount percent" value={override || ""} placeholder="%" onChange={(e) => setOverride(Number(e.target.value))} />
            <input className="input" placeholder="Reason (required)" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
          </div>
        </details>
        {orderType === "pre_sales" && (
          <details className="rounded-lg border border-slate-200 text-sm">
            <summary className="flex min-h-[44px] cursor-pointer items-center px-3 text-slate-700">Customer signature (optional for pre-sales)</summary>
            <div className="space-y-2 border-t border-slate-100 p-3">
              <input className="input" placeholder="Signatory name" value={signatory} onChange={(e) => setSignatory(e.target.value)} />
              <SignaturePad onChange={setSignature} />
            </div>
          </details>
        )}

        {preview && (
          <div className="space-y-1 rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-900">Checks {busy && <span className="font-normal text-slate-400">— updating…</span>}</p>
            {preview.checks.filter((c) => c.outcome !== "pass").map((c) => (
              <p key={c.id} className={`text-xs ${TONE[c.outcome]}`}>{ICON[c.outcome]} <strong>{c.label}:</strong> {c.message}</p>
            ))}
            {preview.checks.every((c) => c.outcome === "pass") && <p className="text-xs text-emerald-700">✓ All checks passed.</p>}
            {preview.orderPromos.length > 0 && <p className="text-xs text-emerald-700">🎁 Order promotion: {preview.orderPromos.join(", ")}</p>}
          </div>
        )}

        <dl className="space-y-1 rounded-lg border border-slate-200 p-3 text-sm">
          <div className="flex justify-between"><dt className="text-slate-500">Lines</dt><dd className="font-medium text-slate-900">{items.length}</dd></div>
          {preview && preview.discountTotal > 0 && <div className="flex justify-between"><dt className="text-slate-500">You save</dt><dd className="font-medium text-emerald-700">{peso(preview.discountTotal)}</dd></div>}
          <div className="flex justify-between border-t border-slate-100 pt-1 text-base"><dt className="font-medium text-slate-900">Total</dt><dd className="font-semibold text-slate-900">{preview ? peso(preview.total) : "—"}</dd></div>
        </dl>

        <div ref={msgRef} aria-live="polite">
          {msg && <p className={`rounded-lg px-3 py-3 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{msg.text}</p>}
        </div>
        {hint && <p className="text-center text-xs text-slate-400">{hint}</p>}
        <div className="grid gap-2">
          <button type="button" className="btn-primary min-h-[48px] w-full text-base" disabled={pending || items.length === 0} onClick={() => send("submit")}>
            {pending && sending === "submit" ? "Sending…" : orderType === "van_sale" ? "Complete van sale" : "Submit order"}
          </button>
          <button type="button" className="btn-secondary min-h-[48px] w-full text-base" disabled={pending || items.length === 0} onClick={() => send("draft")}>{pending && sending === "draft" ? "Saving draft…" : "Save as draft"}</button>
        </div>
      </Section>
    </div>
  );
}

// One numbered block of the order form.
function Section({ n, title, aside, id, children }: { n: number; title: string; aside?: React.ReactNode; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-2 space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">{n}</span>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
