"use client";

import { useState } from "react";

interface Product {
  id: string;
  name: string;
}

export default function VanReplenishmentForm({
  action,
  products,
  suggestedByProduct,
}: {
  action: (formData: FormData) => void;
  products: Product[];
  suggestedByProduct: Record<string, number>;
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [qty, setQty] = useState("");
  const suggested = suggestedByProduct[productId] ?? 0;

  return (
    <form action={action} className="space-y-2">
      <select
        name="productId"
        className="input"
        value={productId}
        onChange={(e) => setProductId(e.target.value)}
        required
      >
        {products.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <input
        className="input"
        type="number"
        name="qtyRequested"
        min={1}
        placeholder="Quantity needed"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        required
      />
      {suggested > 0 && (
        <button
          type="button"
          onClick={() => setQty(String(suggested))}
          className="text-xs text-blue-600 hover:underline"
        >
          Suggested: {suggested} (avg of last 5 sales)
        </button>
      )}
      <button type="submit" className="btn-primary w-full">Send Request</button>
    </form>
  );
}
