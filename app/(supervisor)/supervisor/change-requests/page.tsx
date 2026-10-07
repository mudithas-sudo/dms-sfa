import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import StatusBadge from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";
import { decideChangeRequest } from "@/app/actions/supervisor-field-actions";

export default async function ChangeRequestsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { branchId } = await getSession();
  const { error, notice } = await searchParams;
  const outlets = await prisma.outlet.findMany({ where: branchId ? { branchId } : {}, select: { id: true, name: true } });
  const reqs = await prisma.customerChangeRequest.findMany({ where: { outletId: { in: outlets.map((o) => o.id) } }, orderBy: { createdAt: "desc" }, take: 60 });
  const name = new Map(outlets.map((o) => [o.id, o.name]));
  const pending = reqs.filter((r) => r.status === "pending");
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Customer Change Requests</h2>
        <p className="text-xs text-slate-500">Corrections proposed by representatives in the field. The customer record changes only when you approve.</p>
      </div>
      <Banner error={error} notice={notice} />
      <div className="space-y-3">
        {pending.map((r) => (
          <div key={r.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">{name.get(r.outletId)} — {r.field.replace("_", " ")}</p>
                <p className="text-xs text-slate-500">By {r.requestedBy} · {formatDateTime(r.createdAt)}</p>
                <p className="mt-1 text-sm text-slate-700">{r.currentValue ? <><span className="text-slate-400 line-through">{r.currentValue}</span> → </> : null}<strong>{r.proposedValue}</strong></p>
                <p className="text-xs text-slate-500">Reason: {r.reason}</p>
                {r.photoData && <img src={r.photoData} alt="Supporting" className="mt-2 h-20 rounded-md ring-1 ring-slate-200" />}
              </div>
              <StatusBadge status={r.status} />
            </div>
            <form action={decideChangeRequest} className="mt-3 flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={r.id} />
              <input className="input max-w-xs flex-1" name="note" placeholder="Note (required to reject)" />
              <button type="submit" name="decision" value="approved" className="btn-primary">Approve &amp; apply</button>
              <button type="submit" name="decision" value="rejected" className="btn-danger">Reject</button>
            </form>
          </div>
        ))}
        {pending.length === 0 && <p className="text-sm text-slate-400">No pending change requests.</p>}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Customer</th><th className="th">Change</th><th className="th">By</th><th className="th">Decided by</th><th className="th">Status</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {reqs.filter((r) => r.status !== "pending").map((r) => (
              <tr key={r.id}><td className="td">{name.get(r.outletId)}</td><td className="td text-xs">{r.field.replace("_", " ")} → {r.proposedValue}</td><td className="td text-xs">{r.requestedBy}</td><td className="td text-xs">{r.decidedBy ?? "—"}{r.decisionNote ? ` — ${r.decisionNote}` : ""}</td><td className="td"><StatusBadge status={r.status} /></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
