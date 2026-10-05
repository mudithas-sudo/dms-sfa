"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  Store,
  Package,
  Tags,
  Megaphone,
  ScrollText,
  LayoutDashboard,
  ClipboardList,
  Warehouse,
  ListChecks,
  Truck,
  ShieldCheck,
  ReceiptText,
  Wallet,
  Users,
  BarChart3,
  UserCheck,
  Layers,
  Map,
  Percent,
  CalendarClock,
  Lock,
  ArrowLeftRight,
  SlidersHorizontal,
  Undo2,
  Inbox,
  CalendarCheck,
  AlertOctagon,
  MapPinned,
  Download,
  Sparkles,
  AlertTriangle,
  Cable,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  Building2,
  Store,
  Package,
  Tags,
  Megaphone,
  ScrollText,
  LayoutDashboard,
  ClipboardList,
  Warehouse,
  ListChecks,
  Truck,
  ShieldCheck,
  ReceiptText,
  Wallet,
  Users,
  BarChart3,
  UserCheck,
  Layers,
  Map,
  Percent,
  CalendarClock,
  Lock,
  ArrowLeftRight,
  SlidersHorizontal,
  Undo2,
  Inbox,
  CalendarCheck,
  AlertOctagon,
  MapPinned,
  Download,
  Sparkles,
  AlertTriangle,
  Cable,
};

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
}

export default function Sidebar({
  navItems,
  roleLabel,
}: {
  navItems: NavItem[];
  roleLabel: string;
}) {
  const pathname = usePathname();

  return (
    <aside className="no-print flex h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex h-16 items-center gap-2 border-b border-slate-200 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">
          CF
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900 leading-tight">Company F and B</p>
          <p className="text-xs text-slate-500 leading-tight">{roleLabel}</p>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {navItems.map((item) => {
          const active = pathname === item.href;
          const Icon = ICONS[item.icon];
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                active
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Icon size={18} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-slate-200 p-4 text-xs text-slate-400">
        Prototype build · not for production use
      </div>
    </aside>
  );
}
