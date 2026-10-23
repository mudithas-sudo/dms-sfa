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
    <aside className="no-print sticky top-0 flex h-screen w-72 shrink-0 flex-col px-4 py-5">
      <div className="flex items-center gap-3 px-2 pb-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 text-sm font-bold text-white shadow-md">CF</div>
        <div className="min-w-0">
          <p className="font-display truncate text-base font-bold leading-tight text-slate-900">Company F and B</p>
          <p className="truncate text-xs leading-tight text-slate-500">{roleLabel}</p>
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto pr-1">
        {navItems.map((item) => {
          const active = pathname === item.href;
          const Icon = ICONS[item.icon];
          return (
            <div key={item.href}>
              {item.section && <p className="px-3 pb-1.5 pt-5 text-xs font-semibold text-slate-400">{item.section}</p>}
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-full px-3 py-2 text-sm transition ${
                  active ? "bg-white font-semibold text-slate-900 shadow-sm" : "font-medium text-slate-500 hover:bg-white/60 hover:text-slate-900"
                }`}
              >
                <span className={`flex h-7 w-7 items-center justify-center rounded-full ${active ? "bg-blue-600 text-white" : "text-slate-400"}`}>
                  <Icon size={16} />
                </span>
                {item.label}
              </Link>
            </div>
          );
        })}
      </nav>
      <div className="mt-4 rounded-2xl bg-white/70 p-4 text-xs leading-relaxed text-slate-500">
        <p className="font-semibold text-slate-700">Prototype build</p>
        Not for production use.
      </div>
    </aside>
  );
}
