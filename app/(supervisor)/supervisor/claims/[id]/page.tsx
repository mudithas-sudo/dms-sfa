import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { decideClaim } from "@/app/actions/supervisor-actions";

const NEXT_STEPS: Record<string, { value: string; label: string; tone: "primary" | "danger" }[]> = {
  submitted: [
    { value: "reviewed", label: "Mark Reviewed", tone: "primary" },
    { value: "rejected", label: "Reject", tone: "danger" },
  ],
  reviewed: [
    { value: "approved", label: "Approve", tone: "primary" },
    { value: "rejected", label: "Reject", tone: "danger" },
  ],
  approved: [{ value: "settled", label: "Mark Settled", tone: "primary" }],
  settled: [],
  rejected: [],
};

export default async function ClaimDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const claim = await prisma.claim.findUnique({
    where: { id },
    include: {
      promotion: true,
      submittedBy: true,
      statusHistory: { orderBy: { changedAt: "asc" } },
    },
  });
  if (!claim) notFound();

  const nextSteps = NEXT_STEPS[claim.status] ?? [];

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/supervisor/claims" className="hover:underline">Claims</Link>
        <span>/</span>
        <span className="text-slate-900">{claim.claimNumber}</span>
      </div>

      <div className="card p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{claim.claimNumber}</h2>
            <p className="text-sm text-slate-500">{claim.promotion.name}</p>
          </div>
          <StatusBadge status={claim.status} />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-xs text-slate-500">Submitted By</dt><dd>{claim.submittedBy.name}</dd></div>
          <div><dt className="text-xs text-slate-500">Amount</dt><dd>{formatCurrency(claim.amount)}</dd></div>
          <div><dt className="text-xs text-slate-500">Submitted</dt><dd>{formatDateTime(claim.submittedAt)}</dd></div>
          <div><dt className="text-xs text-slate-500">Notes</dt><dd>{claim.notes ?? "—"}</dd></div>
        </dl>

        {nextSteps.length > 0 && (
          <form action={decideClaim} className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <input type="hidden" name="id" value={claim.id} />
            <input className="input max-w-xs flex-1" name="reason" placeholder="Reason / note (optional)" />
            {nextSteps.map((s) => (
              <button
                key={s.value}
                type="submit"
                name="decision"
                value={s.value}
                className={s.tone === "primary" ? "btn-primary" : "btn-danger"}
              >
                {s.label}
              </button>
            ))}
          </form>
        )}
      </div>

      <div className="card p-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Status History</h3>
        <ol className="space-y-3 border-l-2 border-slate-200 pl-4">
          {claim.statusHistory.map((h) => (
            <li key={h.id} className="relative">
              <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-blue-500" />
              <p className="text-sm font-medium capitalize text-slate-900">{h.status}</p>
              <p className="text-xs text-slate-500">{h.changedBy} · {formatDateTime(h.changedAt)}</p>
              {h.reason && <p className="text-xs text-slate-600">{h.reason}</p>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
