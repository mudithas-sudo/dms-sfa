"use client";

import { useState } from "react";
import { Sparkles, ChevronDown, ChevronUp } from "lucide-react";

export default function AiInsightsToggle({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="card border-violet-200 bg-violet-50/40 p-5">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-left">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-violet-600" />
          <span className="text-sm font-semibold text-violet-900">AI Insights (Preview)</span>
          <span className="badge bg-violet-100 text-violet-700 ring-1 ring-inset ring-violet-600/20">
            Optional capability — priced separately
          </span>
        </div>
        {open ? <ChevronUp size={18} className="text-violet-600" /> : <ChevronDown size={18} className="text-violet-600" />}
      </button>
      {open && <div className="mt-4 space-y-4">{children}</div>}
    </div>
  );
}
