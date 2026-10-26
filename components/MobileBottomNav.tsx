"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ShoppingCart, Truck, Wallet, MapPin } from "lucide-react";

const items = [
  { href: "/sfa", label: "Home", icon: Home },
  { href: "/sfa/order/new", label: "Order", icon: ShoppingCart },
  { href: "/sfa/van-stock", label: "Van", icon: Truck },
  { href: "/sfa/collections/new", label: "Collect", icon: Wallet },
  { href: "/sfa/visit/new", label: "Visit", icon: MapPin },
];

export default function MobileBottomNav() {
  const pathname = usePathname();
  const list = items;
  // The most specific entry that matches wins, so /sfa/key-accounts/actions does not also light up /sfa/key-accounts.
  const current = [...list].sort((a, b) => b.href.length - a.href.length).find((i) => (i.href === "/sfa" ? pathname === "/sfa" : pathname === i.href || pathname.startsWith(`${i.href}/`)))?.href;

  return (
    <nav aria-label="Main" className="shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1">
      <div className="grid grid-cols-5 gap-1 rounded-full bg-white p-1.5 shadow-md">
        {list.map((item) => {
          const active = current === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-full text-[11px] transition ${active ? "bg-blue-600 font-semibold text-white" : "font-medium text-slate-500 active:bg-slate-50"}`}
            >
              <Icon size={20} strokeWidth={active ? 2.4 : 2} />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
