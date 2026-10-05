import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import KpiCard from "@/components/KpiCard";
import { daysFromNow } from "@/lib/format";
import { ClipboardList, Warehouse, AlertTriangle, Truck, Inbox } from "lucide-react";

export default async function BranchOverview() {
  const { branchId } = await getSession();
  if (!branchId) return <p className="text-sm text-slate-500">No branch selected.</p>;

  const warehouse = await prisma.warehouse.findFirst({ where: { branchId } });
  const [pendingPOs, nearExpiryCount, vanCount, stockValueRows, pendingActions] = await Promise.all([
    prisma.purchaseOrder.count({ where: { branchId, status: { in: ["pending", "partially_received"] } } }),
    warehouse
      ? prisma.stockBalance.count({
          where: {
            warehouseId: warehouse.id,
            expiryDate: { lte: daysFromNow(30), gte: daysFromNow(0) },
          },
        })
      : Promise.resolve(0),
    prisma.van.count({ where: { branchId } }),
    warehouse
      ? prisma.stockBalance.findMany({ where: { warehouseId: warehouse.id }, include: { product: true } })
      : Promise.resolve([]),
    warehouse
      ? Promise.all([
          prisma.stockTransfer.count({ where: { toWarehouseId: warehouse.id, status: "pending" } }),
          prisma.stockAdjustment.count({ where: { warehouseId: warehouse.id, status: "pending" } }),
          prisma.replenishmentRequest.count({ where: { branchId, status: "pending" } }),
        ]).then(([t, a, r]) => t + a + r)
      : Promise.resolve(0),
  ]);

  const stockValue = stockValueRows.reduce((sum, r) => sum + r.qtyGood * r.product.unitPrice, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Pending Purchase Orders" value={String(pendingPOs)} icon={ClipboardList} tone={pendingPOs > 0 ? "warn" : "good"} />
        <KpiCard label="Warehouse Stock Value" value={`₱${stockValue.toLocaleString()}`} icon={Warehouse} />
        <KpiCard label="Near-Expiry Lots (30d)" value={String(nearExpiryCount)} icon={AlertTriangle} tone={nearExpiryCount > 0 ? "bad" : "good"} />
        <KpiCard label="Vans" value={String(vanCount)} icon={Truck} />
        <KpiCard label="Pending Approvals" value={String(pendingActions)} icon={Inbox} tone={pendingActions > 0 ? "warn" : "good"} sublabel="Transfers, adjustments, replenishment" />
      </div>

      <div className="card p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Quick Links</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Link href="/branch/purchase-orders" className="btn-secondary">Purchase Orders</Link>
          <Link href="/branch/warehouse-stock" className="btn-secondary">Warehouse Stock</Link>
          <Link href="/branch/opening-balance" className="btn-secondary">Opening Balance</Link>
          <Link href="/branch/stock-count" className="btn-secondary">Stock Count</Link>
          <Link href="/branch/stock-transfers" className="btn-secondary">Stock Transfers</Link>
          <Link href="/branch/stock-adjustments" className="btn-secondary">Stock Adjustments</Link>
          <Link href="/branch/near-expiry" className="btn-secondary">Near-Expiry Alerts</Link>
          <Link href="/branch/van-loading" className="btn-secondary">Van Loading</Link>
          <Link href="/branch/van-returns" className="btn-secondary">Van Returns</Link>
          <Link href="/branch/replenishment-requests" className="btn-secondary">Replenishment Requests</Link>
          <Link href="/branch/eod-reconciliation" className="btn-secondary">EOD Reconciliation</Link>
        </div>
      </div>
    </div>
  );
}
