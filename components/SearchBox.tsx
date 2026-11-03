"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

// Jump to any screen of the current area by name. ⌘K / Ctrl+K focuses it; Enter opens the first match.
export default function SearchBox({ items }: { items: { href: string; label: string }[] }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? items.filter((i) => i.label.toLowerCase().includes(t)).slice(0, 8) : [];
  }, [q, items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (href: string) => {
    setQ("");
    setOpen(false);
    router.push(href);
  };

  return (
    <div className="no-print relative hidden w-64 md:block">
      <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-500 shadow-xs focus-within:border-slate-400">
        <Search size={15} aria-hidden="true" />
        <input
          ref={ref}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches[0]) go(matches[0].href);
            if (e.key === "Escape") { setQ(""); ref.current?.blur(); }
          }}
          placeholder="Search screens"
          aria-label="Search screens"
          className="min-w-0 flex-1 bg-transparent text-slate-900 outline-none placeholder:text-slate-500"
        />
        <kbd className="rounded-md border border-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">⌘K</kbd>
      </label>
      {open && matches.length > 0 && (
        <ul className="absolute right-0 top-12 z-40 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-lg">
          {matches.map((m) => (
            <li key={m.href}>
              <button type="button" onMouseDown={() => go(m.href)} className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100">
                {m.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
