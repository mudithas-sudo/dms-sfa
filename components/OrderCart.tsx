"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Minus, Plus } from "lucide-react";
import { submitOrder, quoteOrder } from "@/app/actions/sfa-actions";
import { formatCurrency } from "@/lib/format";
import SignaturePad from "@/components/SignaturePad";

interface Outlet {
  id: string;
  name: string;
}
interface Product {
  id: string;
  name: string;
  sku: string;
  unitPrice: number;
  category: string;
}
export default function OrderCart({
  outlets,
  products,
  promoLabelByProduct,
  suggestedQtyByProduct,
  defaultOutletId,
}: {
  outlets: Outlet[];
  products: Product[];
  promoLabelByProduct: Record<string, string>;
  suggestedQtyByProduct: Record<string, number>;
  defaultOutletId?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [outletId, setOutletId] = useState(defaultOutletId ?? outlets[0]?.id ?? "");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [deliveryDate, setDeliveryDate] = useState("");
  const [signature, setSignature] = useState<string | null>(null);

  const setQty = (productId: string, qty: number) => {
    setCart((prev) => ({ ...prev, [productId]: Math.max(0, qty) }));
  };

  const items = useMemo(
    () =>
      Object.entries(cart)
        .filter(([, qty]) => qty > 0)
        .map(([productId, qty]) => ({ productId, qty })),
    [cart],
  );
  const lineCount = items.length;

  // Totals come from the server's pricing engine (the same one that prices
  // the invoice), so promotions, minimum quantities and pricing rules shown
  // here always match what actually gets billed.
  const [quote, setQuote] = useState({ discountTotal: 0, total: 0 });
  useEffect(() => {
    if (!outletId || items.length === 0) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      quoteOrder(outletId, items)
        .then((q) => {
          if (!cancelled) setQuote(q);
        })
        .catch(() => {});
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [outletId, items]);
  const discount = lineCount === 0 ? 0 : quote.discountTotal;
  const total = lineCount === 0 ? 0 : quote.total;

  const handleSubmit = () => {
    if (!outletId || items.length === 0) return;
    startTransition(() => {
      submitOrder(outletId, items, {
        requestedDeliveryDate: deliveryDate || undefined,
        signatureDataUrl: signature ?? undefined,
      }).catch(() => {
        // submitOrder redirects on success/hold; a thrown redirect() is expected here.
      });
    });
  };

  const categories = Array.from(new Set(products.map((p) => p.category)));

  return (
    <div className="space-y-4 pb-24">
      <div className="card p-4">
        <label className="label" htmlFor="outlet">Outlet</label>
        <select
          id="outlet"
          className="input"
          value={outletId}
          onChange={(e) => setOutletId(e.target.value)}
        >
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </div>

      {categories.map((category) => (
        <div key={category} className="card p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{category}</h3>
          <ul className="divide-y divide-slate-100">
            {products.filter((p) => p.category === category).map((p) => {
              const qty = cart[p.id] ?? 0;
              const promoLabel = promoLabelByProduct[p.id];
              const suggested = suggestedQtyByProduct[p.id];
              return (
                <li key={p.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{p.name}</p>
                    <p className="text-xs text-slate-500">
                      {formatCurrency(p.unitPrice)}
                      {promoLabel && <span className="ml-1 badge badge-green">{promoLabel}</span>}
                    </p>
                    {suggested > 0 && qty === 0 && (
                      <button
                        type="button"
                        onClick={() => setQty(p.id, suggested)}
                        className="mt-1 text-xs text-blue-600 hover:underline"
                      >
                        Suggested: {suggested} (avg of last 3 orders)
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setQty(p.id, qty - 1)}
                      className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 active:bg-slate-100"
                      aria-label={`Decrease quantity of ${p.name}`}
                    >
                      <Minus size={16} />
                    </button>
                    <span className="w-6 text-center text-sm font-medium">{qty}</span>
                    <button
                      type="button"
                      onClick={() => setQty(p.id, qty + 1)}
                      className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 active:bg-slate-100"
                      aria-label={`Increase quantity of ${p.name}`}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {lineCount > 0 && (
        <div className="card space-y-3 p-4">
          <div>
            <label className="label" htmlFor="deliveryDate">Requested Delivery Date</label>
            <input
              id="deliveryDate"
              type="date"
              className="input"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
            />
          </div>
          <SignaturePad onChange={setSignature} />
        </div>
      )}

      <div className="fixed bottom-[68px] left-1/2 w-full max-w-[358px] -translate-x-1/2 rounded-t-xl border border-slate-200 bg-white p-4 shadow-lg">
        <div className="flex justify-between text-xs text-slate-500">
          <span>{lineCount} item(s)</span>
          <span>Discount: {formatCurrency(discount)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-900">Total: {formatCurrency(total)}</span>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || lineCount === 0 || !outletId}
            className="btn-primary"
          >
            {isPending ? "Submitting..." : "Submit Order"}
          </button>
        </div>
      </div>
    </div>
  );
}
