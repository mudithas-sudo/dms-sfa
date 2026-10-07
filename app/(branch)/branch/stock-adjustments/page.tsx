import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import StatusBadge from "@/components/StatusBadge";
import { formatDateTime, formatCurrency } from "@/lib/format";
import { requestStockAdjustment, decideStockAdjustment } from "@/app/actions/inventory-actions";
import { ADJUST_REASONS } from "@/lib/inventory-constants";
import { getAllSettings, num } from "@/lib/settings";

const ROLE_LABEL: Record<string, string> = {
  warehouse_supervisor: "Warehouse supervisor",
  branch_manager: "Branch manager",
  head_office_controller: "Head office inventory controller",
};

export default async function StockAdjustmentsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { branchId, role } = await getSession();
  const { error, notice } = await searchParams;
  const settings = await getAllSettings();
  const warehouses = await prisma.warehouse.findMany({ where: branchId ? { branchId, status: "active" } : { status: "active" }, orderBy: { name: "asc" } });
  const ids = warehouses.map((w) => w.id);
  const [rows, adjustments] = await Promise.all([
    prisma.stockBalance.findMany({ where: { warehouseId: { in: ids } }, include: { product: true }, orderBy: [{ product: { name: "asc" } }, { expiryDate: "asc" }] }),
    prisma.stockAdjustment.findMany({ where: { warehouseId: { in: ids } }, include: { product: true }, orderBy: { createdAt: "desc" }, take: 40 }),
  ]);
  const options = rows.map((r) => ({ key: `${r.warehouseId}|${r.productId}|${r.lotNumber}`, label: `${r.product.name} — lot ${r.lotNumber} (${r.qtyGood} good)`, productId: r.productId, warehouseId: r.warehouseId!, lot: r.lotNumber }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Stock Adjustments</h2>
        <p className="mt-1 text-xs text-slate-500">
          Every correction needs a reason code and is routed by size/value: up to ₱{num(settings, "adjust.supervisorMaxValue").toLocaleString()} the warehouse supervisor, up to ₱
          {num(settings, "adjust.managerMaxValue").toLocaleString()} the branch manager, above that a head office inventory controller (limits are set in Platform Configuration).
          The requester cannot approve their own adjustment, and an approved adjustment is locked.
        </p>
      </div>
      <Banner error={error} notice={notice} />

      <div className="card max-w-3xl p-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">New adjustment request</h3>
        <form action={requestStockAdjustment} className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <label className="label">Product &amp; lot</label>
            <select className="input" name="lotChoice" required defaultValue="">
              <option value="" disabled>Select a lot…</option>
              {options.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-400">The warehouse, product and lot are taken from this choice.</p>
          </div>
          <div>
            <label className="label">Quantity change (+/−)</label>
            <input className="input" type="number" name="qtyDelta" required />
          </div>
          <div>
            <label className="label">Reason code</label>
            <select className="input" name="reasonCode" defaultValue="count_variance">
              {ADJUST_REASONS.map((r) => (
                <option key={r.id} value={r.id}>{r.label}{r.needsNote ? " (comment required)" : ""}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="label">Comment</label>
            <input className="input" name="notes" placeholder="Required for loss/theft and data-entry corrections" />
          </div>
          <div className="md:col-span-2">
            <label className="label">Attachment reference (incident report etc.)</label>
            <input className="input" name="attachmentNote" placeholder="Required for loss or theft" />
          </div>
          <button className="btn-primary" type="submit">Submit for approval</button>
        </form>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Requested</th>
              <th className="th">Product / lot</th>
              <th className="th">Change</th>
              <th className="th">Reason</th>
              <th className="th">Value</th>
              <th className="th">Approver needed</th>
              <th className="th">Status</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {adjustments.map((a) => (
              <tr key={a.id}>
                <td className="td text-xs">{formatDateTime(a.createdAt)}<div className="text-slate-400">by {a.requestedBy}</div></td>
                <td className="td font-medium text-slate-900">{a.product.name}<div className="text-xs font-normal text-slate-400">lot {a.lotNumber}</div></td>
                <td className={`td font-medium ${a.qtyDelta < 0 ? "text-rose-600" : "text-emerald-700"}`}>{a.qtyDelta > 0 ? "+" : ""}{a.qtyDelta}</td>
                <td className="td text-xs capitalize">{a.reasonCode.replace(/_/g, " ")}{a.notes && <div className="max-w-[200px] text-slate-500">{a.notes}</div>}</td>
                <td className="td text-xs">{formatCurrency(Math.abs(a.qtyDelta) * a.product.unitPrice)}</td>
                <td className="td text-xs">{ROLE_LABEL[a.approverRole ?? ""] ?? "Branch manager"}</td>
                <td className="td"><StatusBadge status={a.status} /></td>
                <td className="td">
                  {a.status === "pending" && (
                    <form action={decideStockAdjustment} className="flex gap-1">
                      <input type="hidden" name="id" value={a.id} />
                      <button className="btn-primary px-2 py-1 text-xs" type="submit" name="decision" value="approved" disabled={a.approverRole === "head_office_controller" && role !== "admin"}>Approve</button>
                      <button className="btn-secondary px-2 py-1 text-xs" type="submit" name="decision" value="rejected">Reject</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {adjustments.length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={8}>No adjustments yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
