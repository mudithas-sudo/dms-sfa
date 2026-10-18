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
    <aside className="no-print sticky top-0 flex h-screen w-64 shrink-0 flex-col bg-slate-900 text-white">
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
        <div className="numeral flex h-9 w-9 items-center justify-center rounded-md bg-leaf text-lg font-bold text-ink">CF</div>
        <div className="min-w-0">
          <p className="font-display truncate text-lg font-semibold leading-tight text-white">Company F and B</p>
          <p className="truncate text-xs leading-tight text-white/60">{roleLabel}</p>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {navItems.map((item) => {
          const active = pathname === item.href;
          const Icon = ICONS[item.icon];
          return (
            <div key={item.href}>
              {item.section && (
                <p className="px-3 pb-1 pt-5 text-xs font-semibold text-white/50">{item.section}</p>
              )}
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
                active
                  ? "bg-white/10 font-semibold text-white before:absolute before:inset-y-1.5 before:-left-3 before:w-1 before:rounded-r before:bg-leaf"
                  : "font-medium text-white/75 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon size={18} />
              {item.label}
            </Link>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-4 text-xs text-white/50">Prototype build, not for production use</div>
    </aside>
  );
}
