import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import StatusBadge from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";
import { decideReplenishmentRequest, markReplenishmentFulfilled } from "@/app/actions/branch-actions";

export default async function ReplenishmentRequestsPage() {
  const { branchId } = await getSession();
  const requests = branchId
    ? await prisma.replenishmentRequest.findMany({
        where: { branchId },
        orderBy: { createdAt: "desc" },
        include: { van: true, product: true },
      })
    : [];

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">Van Replenishment Requests</h2>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Van</th>
              <th className="th">Product</th>
              <th className="th">Qty Requested</th>
              <th className="th">Requested By</th>
              <th className="th">When</th>
              <th className="th">Status</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {requests.map((r) => (
              <tr key={r.id}>
                <td className="td">{r.van.code}</td>
                <td className="td font-medium text-slate-900">{r.product.name}</td>
                <td className="td">{r.qtyRequested}</td>
                <td className="td">{r.requestedBy}</td>
                <td className="td text-xs">{formatDateTime(r.createdAt)}</td>
                <td className="td"><StatusBadge status={r.status} /></td>
                <td className="td text-right">
                  {r.status === "pending" && (
                    <form action={decideReplenishmentRequest} className="flex justify-end gap-2">
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" name="decision" value="approved" className="text-xs text-emerald-600 hover:underline">Approve</button>
                      <button type="submit" name="decision" value="rejected" className="text-xs text-rose-600 hover:underline">Reject</button>
                    </form>
                  )}
                  {r.status === "approved" && (
                    <form action={markReplenishmentFulfilled}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className="text-xs text-blue-600 hover:underline">Mark Fulfilled (loaded via Van Loading)</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {requests.length === 0 && <tr><td className="td text-slate-400" colSpan={7}>No replenishment requests yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
