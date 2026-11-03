import { ChevronDown } from "lucide-react";

// Mobile building blocks for forms that ask for several small numbers per product (counts, returns).
// Every number gets its own label and a full-width box, instead of a bare input squeezed beside the product name.

export interface StockField {
  name: string;
  label: string;
  defaultValue?: number;
  max?: number;
  required?: boolean;
  disabled?: boolean;
}

export function StockInputRow({
  title,
  note,
  fields,
  remark,
}: {
  title: string;
  note?: string;
  fields: StockField[];
  remark?: { name: string; placeholder: string };
}) {
  return (
    <div className="space-y-2 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-sm font-semibold leading-snug text-slate-900">{title}</p>
        {note && <p className="shrink-0 text-xs text-slate-500">{note}</p>}
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${fields.length}, minmax(0, 1fr))` }}>
        {fields.map((f) => (
          <label key={f.name} className="block">
            <span className="label">{f.label}</span>
            <input
              className="input text-center"
              type="number"
              inputMode="numeric"
              min={0}
              max={f.max}
              name={f.name}
              defaultValue={f.defaultValue}
              required={f.required}
              disabled={f.disabled}
              placeholder="0"
            />
          </label>
        ))}
      </div>
      {remark && <input className="input" name={remark.name} placeholder={remark.placeholder} />}
    </div>
  );
}

// A card whose body folds away: long screens stay scannable, and every action is one tap from the list.
export function Collapsible({ title, hint, children, defaultOpen = false }: { title: string; hint?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="card group" open={defaultOpen}>
      <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-900">{title}</span>
          {hint && <span className="block text-xs text-slate-500">{hint}</span>}
        </span>
        <ChevronDown size={18} className="shrink-0 text-slate-500 transition group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-slate-100 px-4 pb-4 pt-3">{children}</div>
    </details>
  );
}
