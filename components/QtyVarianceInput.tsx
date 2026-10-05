"use client";

import { useState } from "react";

export default function QtyVarianceInput({ name, ordered }: { name: string; ordered: number }) {
  const [value, setValue] = useState(ordered);
  const variance = value - ordered;

  return (
    <div className="flex items-center gap-2">
      <input
        className="input w-24"
        type="number"
        name={name}
        value={value}
        min={0}
        onChange={(e) => setValue(Number(e.target.value))}
      />
      {variance !== 0 && (
        <span className={`badge ${variance < 0 ? "badge-red" : "badge-amber"}`}>
          {variance > 0 ? `+${variance} over` : `${variance} short`}
        </span>
      )}
    </div>
  );
}
