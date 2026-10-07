import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import StatusBadge from "@/components/StatusBadge";
import Banner from "@/components/Banner";
import { formatDate, formatDateTime } from "@/lib/format";
import { decideReplenishment } from "@/app/actions/van-actions";

export default async function ReplenishmentRequestsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { branchId } = await getSession();
  const { error, notice } = await searchParams;
  const [requests, products, vans] = await Promise.all([
    branchId
      ? prisma.replenishmentRequest.findMany({ where: { branchId }, orderBy: { createdAt: "desc" }, take: 30, include: { lines: true } })
      : Promise.resolve([]),
    prisma.product.findMany({ select: { id: true, name: true } }),
    prisma.van.findMany({ where: branchId ? { branchId } : {}, select: { id: true, code: true, driverName: true } }),
  ]);
  const pname = new Map(products.map((p) => [p.id, p.name]));
  const vname = new Map(vans.map((v) => [v.id, `${v.code} · ${v.driverName}`]));
  const pending = requests.filter((r) => r.status === "pending");
  const others = requests.filter((r) => r.status !== "pending" && r.status !== "draft");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Van Stock Requests</h2>
        <p className="mt-1 text-xs text-slate-500">
          A representative raises a request from the mobile app showing the van balance and warehouse availability. The warehouse supervisor approves it in full, approves it with reduced quantities, or rejects it with a reason.
          An approved request becomes the loading document — stock can only leave the warehouse against an authorised request, and approved quantities cannot exceed what the warehouse holds.
        </p>
      </div>
      <Banner error={error} notice={notice} />

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Awaiting decision ({pending.length})</h3>
        {pending.map((r) => (
          <form key={r.id} action={decideReplenishment} className="card p-4">
            <input type="hidden" name="id" value={r.id} />
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-900">
                {r.requestNumber} <span className="font-normal text-slate-500">· {vname.get(r.vanId)} · by {r.requestedBy} · needed {r.requiredDate ? formatDate(r.requiredDate) : "—"}</span>
              </p>
              <StatusBadge status={r.status} />
            </div>
            {r.remarks && <p className="mb-2 text-xs text-slate-500">Salesman note: {r.remarks}</p>}
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200">
                <tr>
                  <th className="th">Product</th>
                  <th className="th">Van balance</th>
                  <th className="th">Warehouse available</th>
                  <th className="th">Requested</th>
                  <th className="th">Approve</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {r.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="td">{pname.get(l.productId)}</td>
                    <td className="td">{l.vanBalance ?? "—"}</td>
                    <td className={`td ${l.warehouseAvail !== null && l.warehouseAvail < l.qtyRequested ? "text-amber-700" : ""}`}>{l.warehouseAvail ?? "—"}</td>
                    <td className="td">{l.qtyRequested}</td>
                    <td className="td"><input className="input w-24" type="number" min={0} max={l.qtyRequested} name={`appr_${l.id}`} defaultValue={Math.min(l.qtyRequested, l.warehouseAvail ?? l.qtyRequested)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input className="input max-w-sm flex-1" name="reason" placeholder="Decision note (required when rejecting or reducing)" />
              <button className="btn-primary" type="submit" name="decision" value="approve">Approve (as entered)</button>
              <button className="btn-danger" type="submit" name="decision" value="reject">Reject</button>
            </div>
          </form>
        ))}
        {pending.length === 0 && <p className="text-sm text-slate-400">No requests are waiting.</p>}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Request</th>
              <th className="th">Van</th>
              <th className="th">Lines (requested → approved)</th>
              <th className="th">Decision</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {others.map((r) => (
              <tr key={r.id}>
                <td className="td text-xs"><span className="font-medium text-slate-900">{r.requestNumber}</span><div className="text-slate-400">{formatDateTime(r.createdAt)}</div></td>
                <td className="td text-xs">{vname.get(r.vanId)}</td>
                <td className="td text-xs">{r.lines.map((l) => `${pname.get(l.productId)}: ${l.qtyRequested}${l.qtyApproved !== null ? ` → ${l.qtyApproved}` : ""}`).join("; ") || `${pname.get(r.productId)}: ${r.qtyRequested}`}</td>
                <td className="td text-xs">{r.decisionNote ?? "—"}</td>
                <td className="td"><StatusBadge status={r.status} /></td>
              </tr>
            ))}
            {others.length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={5}>No decided requests yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
