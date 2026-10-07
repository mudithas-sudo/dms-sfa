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

  return (
    <nav className="grid shrink-0 grid-cols-5 border-t border-slate-200 bg-white">
      {(role === "key_account" ? kaItems : items).map((item) => {
        const active = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${
              active ? "text-blue-600" : "text-slate-400"
            }`}
          >
            <Icon size={20} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
