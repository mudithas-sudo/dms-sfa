"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ShoppingCart, Truck, Wallet, MapPin, Briefcase, ListChecks } from "lucide-react";

const items = [
  { href: "/sfa", label: "Home", icon: Home },
  { href: "/sfa/order/new", label: "Order", icon: ShoppingCart },
  { href: "/sfa/van-stock", label: "Van", icon: Truck },
  { href: "/sfa/collections/new", label: "Collect", icon: Wallet },
  { href: "/sfa/visit/new", label: "Visit", icon: MapPin },
];

const kaItems = [
  { href: "/sfa/key-accounts", label: "Accounts", icon: Briefcase },
  { href: "/sfa/key-accounts/actions", label: "Actions", icon: ListChecks },
  { href: "/sfa/order/new", label: "Order", icon: ShoppingCart },
  { href: "/sfa/collections/new", label: "Collect", icon: Wallet },
  { href: "/sfa/tasks", label: "Tasks", icon: MapPin },
];

export default function MobileBottomNav({ role }: { role?: string }) {
  const pathname = usePathname();
  const list = role === "key_account" ? kaItems : items;
  // The most specific entry that matches wins, so /sfa/key-accounts/actions does not also light up /sfa/key-accounts.
  const current = [...list].sort((a, b) => b.href.length - a.href.length).find((i) => (i.href === "/sfa" ? pathname === "/sfa" : pathname === i.href || pathname.startsWith(`${i.href}/`)))?.href;

  return (
    <nav aria-label="Main" className="grid shrink-0 grid-cols-5 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
      {list.map((item) => {
        const active = current === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium active:bg-slate-50 ${active ? "text-blue-600" : "text-slate-500"}`}
          >
            {active && <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-blue-600" />}
            <Icon size={22} strokeWidth={active ? 2.4 : 2} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
