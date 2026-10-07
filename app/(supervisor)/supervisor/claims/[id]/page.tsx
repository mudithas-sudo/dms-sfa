import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import Banner from "@/components/Banner";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { CLAIM_DOCUMENTS } from "@/lib/claims";
import { decideClaim, submitClaim } from "@/app/actions/claim-actions";

const NEXT_STEPS: Record<string, { value: string; label: string; tone: "primary" | "danger" | "secondary" }[]> = {
  submitted: [{ value: "under_review", label: "Start review", tone: "primary" }],
  under_review: [
    { value: "approved", label: "Approve", tone: "primary" },
    { value: "returned", label: "Return for correction", tone: "secondary" },
    { value: "rejected", label: "Reject", tone: "danger" },
  ],
  reviewed: [
    { value: "approved", label: "Approve", tone: "primary" },
    { value: "returned", label: "Return for correction", tone: "secondary" },
    { value: "rejected", label: "Reject", tone: "danger" },
  ],
  approved: [{ value: "settlement_pending", label: "Send for settlement", tone: "primary" }],
  settlement_pending: [{ value: "settled", label: "Mark settled", tone: "primary" }],
};

export default async function ClaimDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { id } = await params;
  const { error, notice } = await searchParams;
  const claim = await prisma.claim.findUnique({
    where: { id },
    include: { promotion: true, submittedBy: true, lines: true, statusHistory: { orderBy: { changedAt: "asc" } } },
  });
  if (!claim) notFound();
  const exception = await prisma.approvalRequest.findFirst({ where: { type: "claim_exception", refId: id }, orderBy: { createdAt: "desc" } });
  const docs: string[] = claim.documents ? JSON.parse(claim.documents) : [];
  const nextSteps = NEXT_STEPS[claim.status] ?? [];
  const over = claim.eligibleAmount != null && claim.amount > claim.eligibleAmount + 0.5;
  const canSubmit = ["draft", "returned"].includes(claim.status) && exception?.status !== "pending";

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/supervisor/claims" className="hover:underline">Claims</Link>
        <span>/</span>
        <span className="text-slate-900">{claim.claimNumber}</span>
      </div>
      <Banner error={error} notice={notice} />

      <div className="card p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{claim.claimNumber}</h2>
            <p className="text-sm text-slate-500">{claim.promotion.name} · v{claim.promotion.version}</p>
          </div>
          <StatusBadge status={claim.status} />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-slate-500">Raised by</dt><dd>{claim.submittedBy.name}</dd></div>
          <div><dt className="text-xs text-slate-500">Period</dt><dd>{claim.periodStart ? `${formatDate(claim.periodStart)} – ${formatDate(claim.periodEnd ?? claim.periodStart)}` : "—"}</dd></div>
          <div><dt className="text-xs text-slate-500">Created</dt><dd>{formatDateTime(claim.submittedAt)}</dd></div>
          <div><dt className="text-xs text-slate-500">Eligible amount</dt><dd>{claim.eligibleAmount != null ? formatCurrency(claim.eligibleAmount) : "—"}</dd></div>
          <div><dt className="text-xs text-slate-500">Claimed amount</dt><dd className={over ? "font-medium text-rose-600" : ""}>{formatCurrency(claim.amount)}</dd></div>
          <div><dt className="text-xs text-slate-500">Settlement ref.</dt><dd>{claim.settlementReference ?? "—"}</dd></div>
        </dl>
        {over && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Claimed amount is above the eligible amount.{" "}
            {claim.exceptionApproved ? "An exception was approved." : exception ? `Exception request is ${exception.status}.` : "No exception has been approved."}
          </p>
        )}
        {claim.notes && <p className="mt-3 text-xs text-slate-600">Notes: {claim.notes}</p>}
        {claim.tradePromoStatus && <p className="mt-1 text-[11px] text-slate-400">Status shared with the trade promotion application: {claim.tradePromoStatus.replace(/_/g, " ")}</p>}

        <div className="mt-4">
          <p className="text-xs font-semibold text-slate-700">Supporting documents</p>
          {docs.length > 0 ? (
            <ul className="mt-1 list-inside list-disc text-sm text-slate-600">{docs.map((d) => <li key={d}>{d}</li>)}</ul>
          ) : (
            <p className="text-sm text-slate-400">None attached.</p>
          )}
        </div>

        {canSubmit && (
          <form action={submitClaim} className="mt-5 space-y-2 border-t border-slate-100 pt-4">
            <input type="hidden" name="id" value={claim.id} />
            <p className="text-xs text-slate-500">{claim.status === "returned" ? "Fix what the reviewer asked for, add documents if needed and resubmit." : "Attach the supporting documents and submit for review."}</p>
            <div className="flex flex-wrap gap-3">
              {CLAIM_DOCUMENTS.filter((d) => !docs.includes(d)).map((d) => (
                <label key={d} className="flex items-center gap-1.5 text-sm text-slate-700">
                  <input type="checkbox" name="docType" value={d} className="h-4 w-4 rounded border-slate-300" /> {d}
                </label>
              ))}
            </div>
            <input className="input" type="file" name="docs" multiple />
            <input className="input" name="reason" placeholder="Note to the reviewer (optional)" />
            <button type="submit" className="btn-primary">{claim.status === "returned" ? "Resubmit claim" : "Submit claim"}</button>
          </form>
        )}

        {nextSteps.length > 0 && (
          <form action={decideClaim} className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <input type="hidden" name="id" value={claim.id} />
            <input className="input max-w-xs flex-1" name="reason" placeholder="Reason / note (required to return or reject)" />
            {["approved", "settlement_pending"].includes(claim.status) && <input className="input w-48" name="reference" placeholder="Settlement reference" />}
            {nextSteps.map((s) => (
              <button key={s.value} type="submit" name="decision" value={s.value} className={s.tone === "primary" ? "btn-primary" : s.tone === "danger" ? "btn-danger" : "btn-secondary"}>
                {s.label}
              </button>
            ))}
          </form>
        )}
      </div>

      {claim.lines.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <h3 className="px-6 pt-5 text-sm font-semibold text-slate-900">Qualifying orders in this claim</h3>
          <table className="mt-3 w-full">
            <thead className="border-y border-slate-200 bg-slate-50"><tr><th className="th">Order</th><th className="th text-right">Eligible amount</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {claim.lines.map((l) => (
                <tr key={l.id}><td className="td"><Link className="text-blue-600 hover:underline" href={`/supervisor/orders/${l.salesOrderId}`}>{l.orderNumber}</Link></td><td className="td text-right">{formatCurrency(l.amount)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card p-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Status history</h3>
        <ol className="space-y-3 border-l-2 border-slate-200 pl-4">
          {claim.statusHistory.map((h) => (
            <li key={h.id} className="relative">
              <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-blue-500" />
              <p className="text-sm font-medium capitalize text-slate-900">{h.status.replace(/_/g, " ")}</p>
              <p className="text-xs text-slate-500">{h.changedBy} · {formatDateTime(h.changedAt)}</p>
              {h.reason && <p className="text-xs text-slate-600">{h.reason}</p>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
