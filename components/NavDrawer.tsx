"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import Sidebar, { type NavItem } from "@/components/Sidebar";

// Below laptop width the sidebar folds into this slide-out menu, opened from the top bar.
export default function NavDrawer({ navItems, roleLabel }: { navItems: NavItem[]; roleLabel: string }) {
  const pathname = usePathname();
  // the menu is open only for the page it was opened on, so following a link closes it
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (v: boolean) => setOpenOn(v ? pathname : null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenOn(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button type="button" className="btn-round h-10 w-10 lg:hidden" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
        <Menu size={18} />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[min(85vw,300px)] flex-col bg-slate-50 shadow-lg">
            <button type="button" className="btn-round absolute right-3 top-4 z-10 h-9 w-9" aria-label="Close menu" onClick={() => setOpen(false)}>
              <X size={16} />
            </button>
            <Sidebar navItems={navItems} roleLabel={roleLabel} />
          </div>
        </div>
      )}
    </>
  );
}
