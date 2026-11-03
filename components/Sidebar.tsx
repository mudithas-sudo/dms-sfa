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
  Settings,
  FileText,
  FileBarChart,
  ClipboardCheck,
  PackageCheck,
  Boxes,
  ShieldAlert,
  Smartphone,
  KeyRound,
  Activity,
  Trophy,
  Target,
  CircleDollarSign,
  ListTodo,
  Plug,
  UserCog,
  Gauge,
  Bell,
  Landmark,
  Upload,
  FileCheck2,
  Briefcase,
  Share2,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  Landmark,
  Upload,
  FileCheck2,
  Briefcase,
  Share2,
  ShoppingCart,
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
  Settings,
  FileText,
  FileBarChart,
  ClipboardCheck,
  PackageCheck,
  Boxes,
  ShieldAlert,
  Smartphone,
  KeyRound,
  Activity,
  Trophy,
  Target,
  CircleDollarSign,
  ListTodo,
  Plug,
  UserCog,
  Gauge,
  Bell,
};

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  section?: string; // renders a small heading above this item
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
    <aside className="no-print flex h-full w-72 shrink-0 flex-col px-3 py-5">
      <div className="flex items-center gap-3 px-3 pb-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white shadow-md">
          <Boxes size={20} strokeWidth={2.2} />
        </div>
        <div className="min-w-0">
          <p className="font-display truncate text-lg font-bold uppercase leading-tight tracking-tight text-slate-900">Company F&amp;B</p>
          <p className="truncate text-xs leading-tight text-slate-500">{roleLabel}</p>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto pr-1">
        {navItems.map((item) => {
          const active = pathname === item.href;
          const Icon = ICONS[item.icon];
          return (
            <div key={item.href}>
              {item.section && <p className="px-3 pb-1.5 pt-5 text-[13px] font-medium text-slate-900">{item.section}</p>}
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                  active ? "bg-slate-200/70 font-semibold text-slate-900" : "font-normal text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <Icon size={18} strokeWidth={1.75} className={active ? "text-slate-900" : "text-slate-500"} />
                {item.label}
              </Link>
            </div>
          );
        })}
      </nav>
      <p className="mt-4 px-3 text-xs text-slate-400">Prototype build · not for production use</p>
    </aside>
  );
}
