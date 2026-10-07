"use client";

import { useState } from "react";
import Link from "next/link";
import { savePromotion } from "@/app/actions/promotion-actions";
import { PROMO_TYPES, STACKING, WEEKDAYS, parseConfig } from "@/lib/promotions";

interface Opt {
  id: string;
  name: string;
}

export interface PromoFormValues {
  id?: string;
  parentId?: string;
  name?: string;
  code?: string | null;
  type?: string;
  eligibilityRule?: string;
  minQty?: number | null;
  productId?: string | null;
  channelId?: string | null;
  discountValue?: number;
  freeQty?: number | null;
  minOrderValue?: number | null;
  startDate?: string;
  endDate?: string;
  config?: string | null;
  maxDiscountCap?: number | null;
  budget?: number | null;
  maxRedemptions?: number | null;
  stacking?: string;
  priority?: number;
  branchIds?: string | null;
  daysOfWeek?: string | null;
  notes?: string | null;
}

// One form for every promotion type: the sections that apply to the chosen type are shown, the rest are hidden.
export default function PromotionForm({ values = {}, products, channels, branches }: { values?: PromoFormValues; products: Opt[]; channels: Opt[]; branches: Opt[] }) {
  const [type, setType] = useState(values.type ?? "volume_discount");
  const cfg = parseConfig(values.config);
  const days = (values.daysOfWeek ?? "").split(",").filter(Boolean);
  const chosenBranches = (values.branchIds ?? "").split(",").filter(Boolean);
  const lineType = ["volume_discount", "free_good", "qty_slab", "price_off", "rebate"].includes(type);
  const help = PROMO_TYPES.find((t) => t.id === type)?.help;

  return (
    <form action={savePromotion} className="space-y-5">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      {values.parentId && <input type="hidden" name="parentId" value={values.parentId} />}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="name">Promotion name</label>
          <input className="input" id="name" name="name" defaultValue={values.name} required />
        </div>
        <div>
          <label className="label" htmlFor="code">Code (optional)</label>
          <input className="input" id="code" name="code" defaultValue={values.code ?? ""} placeholder="e.g. PR-BUN-01" />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="type">Type</label>
        <select className="input" id="type" name="type" value={type} onChange={(e) => setType(e.target.value)}>
          {PROMO_TYPES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
      </div>

      {lineType && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="productId">Product</label>
            <select className="input" id="productId" name="productId" defaultValue={values.productId ?? ""}>
              <option value="">All products</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          {type !== "qty_slab" && (
            <div>
              <label className="label" htmlFor="minQty">Minimum quantity</label>
              <input className="input" id="minQty" name="minQty" type="number" min={1} defaultValue={values.minQty ?? ""} placeholder="e.g. 10" />
            </div>
          )}
        </div>
      )}

      {type === "free_good" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="freeQty">Free units</label>
            <input className="input" id="freeQty" name="freeQty" type="number" min={1} defaultValue={values.freeQty ?? ""} />
          </div>
          <label className="mt-6 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="repeat" defaultChecked={cfg.repeat} className="h-4 w-4 rounded border-slate-300" /> Repeats (every full set earns the free units)
          </label>
        </div>
      )}

      {["volume_discount", "price_off", "rebate"].includes(type) && (
        <div>
          <label className="label" htmlFor="discountValue">Discount %</label>
          <input className="input max-w-[160px]" id="discountValue" name="discountValue" type="number" step="0.01" min={0} max={100} defaultValue={values.discountValue ?? ""} />
        </div>
      )}

      {type === "qty_slab" && (
        <div>
          <p className="label">Slabs (the highest slab reached applies)</p>
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="grid grid-cols-3 gap-2">
                <input className="input" name={`slabQty${i}`} type="number" min={1} placeholder={`From qty ${i === 1 ? "(e.g. 10)" : ""}`} defaultValue={cfg.slabs?.[i - 1]?.minQty ?? ""} />
                <input className="input" name={`slabPct${i}`} type="number" step="0.01" min={0} max={100} placeholder="% off" defaultValue={cfg.slabs?.[i - 1]?.discountPct ?? ""} />
                <input className="input" name={`slabFree${i}`} type="number" min={0} placeholder="free units" defaultValue={cfg.slabs?.[i - 1]?.freeQty ?? ""} />
              </div>
            ))}
          </div>
        </div>
      )}

      {type === "bundle" && (
        <div className="space-y-2">
          <p className="label">Bundle contents (at least two products)</p>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="grid grid-cols-[1fr_90px] gap-2">
              <select className="input" name={`bundleProduct${i}`} defaultValue={cfg.items?.[i - 1]?.productId ?? ""}>
                <option value="">— product {i} —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <input className="input" name={`bundleQty${i}`} type="number" min={1} placeholder="qty" defaultValue={cfg.items?.[i - 1]?.qty ?? ""} />
            </div>
          ))}
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="bundlePrice">Bundle price (₱)</label>
              <input className="input" id="bundlePrice" name="bundlePrice" type="number" step="0.01" min={0} defaultValue={cfg.bundlePrice ?? ""} />
            </div>
            <div>
              <label className="label" htmlFor="bundleDiscountPct">…or % off the bundle</label>
              <input className="input" id="bundleDiscountPct" name="bundleDiscountPct" type="number" step="0.01" min={0} max={100} defaultValue={cfg.bundleDiscountPct ?? ""} />
            </div>
            <div>
              <label className="label" htmlFor="maxBundles">Max bundles per order</label>
              <input className="input" id="maxBundles" name="maxBundles" type="number" min={1} defaultValue={cfg.maxBundles ?? ""} />
            </div>
          </div>
        </div>
      )}

      {type === "value_based" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="minOrderValue">Minimum order value (₱)</label>
            <input className="input" id="minOrderValue" name="minOrderValue" type="number" min={0} defaultValue={values.minOrderValue ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="valueOff">Value off (₱)</label>
            <input className="input" id="valueOff" name="valueOff" type="number" step="0.01" min={0} defaultValue={cfg.valueOff ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="valueOffPct">…or % off the order</label>
            <input className="input" id="valueOffPct" name="valueOffPct" type="number" step="0.01" min={0} max={100} defaultValue={cfg.valueOffPct ?? ""} />
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="startDate">Start date</label>
          <input className="input" id="startDate" name="startDate" type="date" defaultValue={values.startDate} required />
        </div>
        <div>
          <label className="label" htmlFor="endDate">End date</label>
          <input className="input" id="endDate" name="endDate" type="date" defaultValue={values.endDate} required />
        </div>
      </div>

      <fieldset className="rounded-lg border border-slate-200 p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Limits &amp; control</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="maxDiscountCap">Max discount per line / order (₱)</label>
            <input className="input" id="maxDiscountCap" name="maxDiscountCap" type="number" min={0} defaultValue={values.maxDiscountCap ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="budget">Budget (₱)</label>
            <input className="input" id="budget" name="budget" type="number" min={0} defaultValue={values.budget ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="maxRedemptions">Max redemptions</label>
            <input className="input" id="maxRedemptions" name="maxRedemptions" type="number" min={1} defaultValue={values.maxRedemptions ?? ""} />
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="stacking">Stacking rule</label>
            <select className="input" id="stacking" name="stacking" defaultValue={values.stacking ?? "none"}>
              {STACKING.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="priority">Priority (higher wins)</label>
            <input className="input" id="priority" name="priority" type="number" defaultValue={values.priority ?? 0} />
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-slate-200 p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Who and when it applies</legend>
        <div>
          <label className="label" htmlFor="channelId">Channel</label>
          <select className="input max-w-xs" id="channelId" name="channelId" defaultValue={values.channelId ?? ""}>
            <option value="">All channels</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <p className="label mt-3">Branches (none ticked = all branches)</p>
        <div className="flex flex-wrap gap-3">
          {branches.map((b) => (
            <label key={b.id} className="flex items-center gap-1.5 text-sm text-slate-700">
              <input type="checkbox" name="branchId" value={b.id} defaultChecked={chosenBranches.includes(b.id)} className="h-4 w-4 rounded border-slate-300" /> {b.name}
            </label>
          ))}
        </div>
        <p className="label mt-3">Days of the week (all or none ticked = every day)</p>
        <div className="flex flex-wrap gap-3">
          {WEEKDAYS.map((d) => (
            <label key={d} className="flex items-center gap-1.5 text-sm capitalize text-slate-700">
              <input type="checkbox" name={`day_${d}`} defaultChecked={days.includes(d)} className="h-4 w-4 rounded border-slate-300" /> {d.slice(0, 3)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="eligibilityRule">Eligibility (shown to reps and on claims)</label>
          <input className="input" id="eligibilityRule" name="eligibilityRule" defaultValue={values.eligibilityRule} placeholder="e.g. General Trade outlets, 10+ cases" />
        </div>
        <div>
          <label className="label" htmlFor="notes">Internal notes</label>
          <input className="input" id="notes" name="notes" defaultValue={values.notes ?? ""} />
        </div>
      </div>

      <div className="flex gap-2">
        <button type="submit" className="btn-primary">{values.id ? "Save draft" : values.parentId ? "Save new version" : "Save as draft"}</button>
        <Link href="/admin/promotions" className="btn-secondary">Cancel</Link>
      </div>
    </form>
  );
}
