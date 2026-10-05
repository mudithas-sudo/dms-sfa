import Link from "next/link";
import { prisma } from "@/lib/prisma";
import KpiCard from "@/components/KpiCard";
import CsvExportButton from "@/components/CsvExportButton";
import PrintButton from "@/components/PrintButton";
import AiInsightsPanel from "@/components/AiInsightsPanel";
import SalesByBranchChart from "@/components/charts/SalesByBranchChart";
import SalesTrendChart from "@/components/charts/SalesTrendChart";
import { formatCurrency, daysAgo } from "@/lib/format";
import { LAST_SYNC_LABEL } from "@/lib/constants";
import { TrendingUp, Wallet, Warehouse, ReceiptText, ShoppingBag, AlertCircle } from "lucide-react";

export default async function ManagementDashboard() {
  const since = daysAgo(30);

  const [branches, invoices, payments, stockRows, vanStockRows, pendingClaims, purchaseOrders, overdueAR] = await Promise.all([
    prisma.branch.findMany({ orderBy: { name: "asc" } }),
    prisma.invoice.findMany({ where: { invoiceDate: { gte: since } }, include: { branch: true } }),
    prisma.aRLedgerEntry.findMany({ where: { type: "payment", entryDate: { gte: since } } }),
    prisma.stockBalance.findMany({ where: { locationType: "warehouse" }, include: { product: true, warehouse: true } }),
    prisma.stockBalance.findMany({ where: { locationType: "van" }, include: { product: true, van: true } }),
    prisma.claim.aggregate({ where: { status: { in: ["submitted", "reviewed"] } }, _sum: { amount: true }, _count: true }),
    prisma.purchaseOrderLine.findMany({ where: { purchaseOrder: { orderDate: { gte: since } } }, include: { purchaseOrder: true } }),
    prisma.invoice.aggregate({ where: { status: "overdue" }, _sum: { amount: true }, _count: true }),
  ]);

  const totalSales = invoices.reduce((s, i) => s + i.amount, 0);
  const totalCollections = payments.reduce((s, p) => s + p.amount, 0);
  const totalStockValue = stockRows.reduce((s, r) => s + r.qtyGood * r.product.unitPrice, 0);
  const totalVanStockValue = vanStockRows.reduce((s, r) => s + r.qtyGood * r.product.unitPrice, 0);
  const totalPurchases = purchaseOrders.reduce((s, l) => s + l.qtyOrdered * l.unitCost, 0);

  const salesByBranch = branches.map((b) => ({
    name: b.name.replace(" Branch", ""),
    sales: invoices.filter((i) => i.branchId === b.id).reduce((s, i) => s + i.amount, 0),
  }));

  const dailyMap = new Map<string, number>();
  for (let d = 29; d >= 0; d--) {
    const day = daysAgo(d);
    dailyMap.set(day.toISOString().slice(0, 10), 0);
  }
  for (const inv of invoices) {
    const key = inv.invoiceDate.toISOString().slice(0, 10);
    if (dailyMap.has(key)) dailyMap.set(key, (dailyMap.get(key) ?? 0) + inv.amount);
  }
  const salesTrend = Array.from(dailyMap.entries()).map(([date, sales]) => ({
    date: date.slice(5),
    sales,
  }));

  const branchStockValue = (branchId: string) =>
    stockRows.filter((r) => r.warehouse?.branchId === branchId).reduce((s, r) => s + r.qtyGood * r.product.unitPrice, 0);

  const branchVanStockValue = (branchId: string) =>
    vanStockRows.filter((r) => r.van?.branchId === branchId).reduce((s, r) => s + r.qtyGood * r.product.unitPrice, 0);

  const branchPurchases = (branchId: string) =>
    purchaseOrders.filter((l) => l.purchaseOrder.branchId === branchId).reduce((s, l) => s + l.qtyOrdered * l.unitCost, 0);

  const exportRows = branches.map((b) => ({
    Branch: b.name,
    "Sales (30d)": invoices.filter((i) => i.branchId === b.id).reduce((s, i) => s + i.amount, 0),
    "Purchases (30d)": branchPurchases(b.id),
    "Warehouse Stock Value": branchStockValue(b.id),
    "Van Stock Value": branchVanStockValue(b.id),
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <p className="text-xs text-slate-400">{LAST_SYNC_LABEL}</p>
          <p className="text-xs text-slate-400">Last exported to BI: Today 06:15 AM (stubbed BI feed)</p>
        </div>
        <div className="no-print flex gap-2">
          <CsvExportButton filename="branch-summary" rows={exportRows} />
          <PrintButton />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <KpiCard label="Sales (30d)" value={formatCurrency(totalSales)} icon={TrendingUp} tone="good" />
        <KpiCard label="Collections (30d)" value={formatCurrency(totalCollections)} icon={Wallet} tone="good" />
        <KpiCard label="Purchases (30d)" value={formatCurrency(totalPurchases)} icon={ShoppingBag} />
        <KpiCard label="Warehouse Stock Value" value={formatCurrency(totalStockValue)} icon={Warehouse} />
        <KpiCard label="Van Stock Value" value={formatCurrency(totalVanStockValue)} icon={Warehouse} />
        <KpiCard label="Pending Claims" value={formatCurrency(pendingClaims._sum.amount ?? 0)} sublabel={`${pendingClaims._count} claims`} icon={ReceiptText} tone="warn" />
        <KpiCard label="Overdue AR" value={formatCurrency(overdueAR._sum.amount ?? 0)} sublabel={`${overdueAR._count} invoices`} icon={AlertCircle} tone="bad" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Sales by Branch (30d)</h2>
          <SalesByBranchChart data={salesByBranch} />
        </div>
        <div className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Daily Sales Trend (30d)</h2>
          <SalesTrendChart data={salesTrend} />
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Branch</th>
              <th className="th">Sales (30d)</th>
              <th className="th">Purchases (30d)</th>
              <th className="th">Warehouse Stock</th>
              <th className="th">Van Stock</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {branches.map((b) => (
              <tr key={b.id} className="hover:bg-slate-50">
                <td className="td font-medium text-slate-900">{b.name}</td>
                <td className="td">
                  {formatCurrency(invoices.filter((i) => i.branchId === b.id).reduce((s, i) => s + i.amount, 0))}
                </td>
                <td className="td">{formatCurrency(branchPurchases(b.id))}</td>
                <td className="td">{formatCurrency(branchStockValue(b.id))}</td>
                <td className="td">{formatCurrency(branchVanStockValue(b.id))}</td>
                <td className="td text-right">
                  <Link href={`/management/branch/${b.id}`} className="text-blue-600 hover:underline">
                    View Transactions
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AiInsightsPanel />
    </div>
  );
}
