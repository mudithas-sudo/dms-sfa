import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import StatusBadge from "@/components/StatusBadge";
import Banner from "@/components/Banner";
import { formatDateTime } from "@/lib/format";
import { receiveVanReturn, closeReturnVariance } from "@/app/actions/van-actions";

export default async function VanReturnsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { branchId } = await getSession();
  const { error, notice } = await searchParams;
  const [returns, products, vans] = await Promise.all([
    prisma.vanReturn.findMany({ where: { van: branchId ? { branchId } : {} }, orderBy: { createdAt: "desc" }, take: 80 }),
    prisma.product.findMany({ select: { id: true, name: true } }),
    prisma.van.findMany({ select: { id: true, code: true } }),
  ]);
  const pname = new Map(products.map((p) => [p.id, p.name]));
  const vcode = new Map(vans.map((v) => [v.id, v.code]));
  const groups = new Map<string, typeof returns>();
  for (const r of returns) {
    const key = r.returnNumber ?? r.id;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const initiated = [...groups.entries()].filter(([, ls]) => ls.some((l) => l.status === "initiated"));
  const variances = returns.filter((r) => r.status === "variance_pending");
  const history = [...groups.entries()].filter(([, ls]) => ls.every((l) => l.status !== "initiated")).slice(0, 12);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Van-to-Warehouse Returns</h2>
        <p className="mt-1 text-xs text-slate-500">
          The representative initiates the return on the mobile app, choosing quantity and condition (good, damaged, expired). The clerk counts the goods and confirms: the van balance falls and the warehouse is credited — good stock back to
          saleable inventory, damaged and expired stock to the non-saleable buckets. A difference between declared and counted quantity needs a reason and carries into the end-of-day reconciliation.
        </p>
      </div>
      <Banner error={error} notice={notice} />

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Waiting to be received ({initiated.length})</h3>
        {initiated.map(([no, ls]) => (
          <form key={no} action={receiveVanReturn} className="card p-4">
            <input type="hidden" name="returnNumber" value={no} />
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-slate-900">{no} <span className="font-normal text-slate-500">· {vcode.get(ls[0].vanId)} · {ls[0].returnedBy} · {formatDateTime(ls[0].createdAt)} · {ls[0].reason}</span></p>
              <StatusBadge status="initiated" />
            </div>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200"><tr><th className="th">Product</th><th className="th">Lot</th><th className="th">Condition</th><th className="th">Declared</th><th className="th">Counted</th><th className="th">Variance reason</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {ls.filter((l) => l.status === "initiated").map((l) => (
                  <tr key={l.id}>
                    <td className="td">{pname.get(l.productId)}</td>
                    <td className="td text-xs">{l.lotNumber}</td>
                    <td className="td capitalize">{l.condition}</td>
                    <td className="td">{l.qtyDeclared ?? l.qty}</td>
                    <td className="td"><input className="input w-24" type="number" min={0} name={`recv_${l.id}`} defaultValue={l.qtyDeclared ?? l.qty} /></td>
                    <td className="td"><input className="input py-1 text-xs" name={`why_${l.id}`} placeholder="Only if different" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="btn-primary mt-3" type="submit">Confirm receipt</button>
          </form>
        ))}
        {initiated.length === 0 && <p className="text-sm text-slate-400">No returns are waiting.</p>}
      </div>

      {variances.length > 0 && (
        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold text-amber-800">Variances pending review ({variances.length})</h3>
          <div className="space-y-2">
            {variances.map((v) => (
              <form key={v.id} action={closeReturnVariance} className="flex flex-wrap items-center gap-2 text-sm">
                <input type="hidden" name="id" value={v.id} />
                <span className="flex-1 text-slate-700">{v.returnNumber} · {pname.get(v.productId)} · declared {v.qtyDeclared}, counted {v.qtyReceived} — {v.varianceReason}</span>
                <input className="input max-w-xs py-1 text-xs" name="note" placeholder="How it was explained" required />
                <button className="btn-secondary px-3 py-1 text-xs" type="submit">Close variance</button>
              </form>
            ))}
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr><th className="th">Return</th><th className="th">Van · rep</th><th className="th">Lines</th><th className="th">Received by</th><th className="th">Status</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {history.map(([no, ls]) => (
              <tr key={no}>
                <td className="td text-xs"><span className="font-medium text-slate-900">{ls[0].returnNumber ?? "legacy"}</span><div className="text-slate-400">{formatDateTime(ls[0].createdAt)}</div></td>
                <td className="td text-xs">{vcode.get(ls[0].vanId)} · {ls[0].returnedBy}</td>
                <td className="td text-xs">{ls.map((l) => `${pname.get(l.productId)} ${l.qtyReceived ?? l.qty} (${l.condition})`).join("; ")}</td>
                <td className="td text-xs">{ls[0].receivedBy ?? "—"}</td>
                <td className="td"><StatusBadge status={ls.some((l) => l.status === "variance_pending") ? "variance_pending" : ls[0].status === "completed" ? "closed" : ls[0].status} /></td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr><td className="td text-slate-400" colSpan={5}>No completed returns yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
