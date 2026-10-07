import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import Banner from "@/components/Banner";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { promoSummary, promoTypeLabel, STACKING } from "@/lib/promotions";
import { transitionPromotion } from "@/app/actions/promotion-actions";

export default async function PromotionDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { id } = await params;
  const { error, notice } = await searchParams;
  const p = await prisma.promotion.findUnique({ where: { id }, include: { product: true, channel: true } });
  if (!p) notFound();
  const rootId = p.parentId ?? p.id;
  const [versions, products, branches, lines, claims, audit] = await Promise.all([
    prisma.promotion.findMany({ where: { OR: [{ id: rootId }, { parentId: rootId }] }, orderBy: { version: "asc" } }),
    prisma.product.findMany({ select: { id: true, name: true } }),
    prisma.branch.findMany({ select: { id: true, name: true } }),
    prisma.salesOrderLine.findMany({ where: { promotionId: id, salesOrder: { status: { not: "voided" } } }, select: { discount: true, salesOrderId: true } }),
    prisma.claim.findMany({ where: { promotionId: id }, orderBy: { submittedAt: "desc" } }),
    prisma.auditLog.findMany({ where: { entity: "Promotion", entityId: id }, orderBy: { createdAt: "desc" }, take: 12 }),
  ]);
  const pname = (pid: string) => products.find((x) => x.id === pid)?.name ?? pid;
  const given = lines.reduce((s, l) => s + l.discount, 0);
  const orders = new Set(lines.map((l) => l.salesOrderId)).size;
  const branchNames = p.branchIds ? p.branchIds.split(",").map((b) => branches.find((x) => x.id === b)?.name ?? b).join(", ") : "All branches";
  const stack = STACKING.find((s) => s.id === p.stacking)?.label ?? p.stacking;

  const actions: { action: string; label: string; tone: "primary" | "secondary" | "danger"; needsReason?: boolean }[] = [];
  if (p.status === "draft") actions.push({ action: "approve", label: "Approve", tone: "primary" }, { action: "discard", label: "Discard draft", tone: "danger" });
  if (p.status === "approved") actions.push({ action: "activate", label: "Activate", tone: "primary" }, { action: "end", label: "Withdraw", tone: "danger" });
  if (p.status === "active") actions.push({ action: "suspend", label: "Suspend", tone: "secondary", needsReason: true }, { action: "end", label: "End now", tone: "danger" });
  if (p.status === "suspended") actions.push({ action: "resume", label: "Resume", tone: "primary" }, { action: "end", label: "End now", tone: "danger" });

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/admin/promotions" className="hover:underline">Promotions</Link>
        <span>/</span>
        <span className="text-slate-900">{p.name}</span>
      </div>
      <Banner error={error} notice={notice} />

      <div className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{p.name} <span className="text-xs font-normal text-slate-400">v{p.version}{p.code ? ` · ${p.code}` : ""}</span></h2>
            <p className="text-sm text-slate-500">{promoTypeLabel(p.type)} — {promoSummary(p, pname)}</p>
          </div>
          <StatusBadge status={p.status} />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-slate-500">Period</dt><dd>{formatDate(p.startDate)} – {formatDate(p.endDate)}</dd></div>
          <div><dt className="text-xs text-slate-500">Product</dt><dd>{p.product?.name ?? "All products"}</dd></div>
          <div><dt className="text-xs text-slate-500">Channel</dt><dd>{p.channel?.name ?? "All channels"}</dd></div>
          <div><dt className="text-xs text-slate-500">Branches</dt><dd>{branchNames}</dd></div>
          <div><dt className="text-xs text-slate-500">Days</dt><dd className="capitalize">{p.daysOfWeek?.replace(/,/g, ", ") ?? "Every day"}</dd></div>
          <div><dt className="text-xs text-slate-500">Eligibility</dt><dd>{p.eligibilityRule}</dd></div>
          <div><dt className="text-xs text-slate-500">Stacking</dt><dd>{stack}</dd></div>
          <div><dt className="text-xs text-slate-500">Priority</dt><dd>{p.priority}</dd></div>
          <div><dt className="text-xs text-slate-500">Max discount cap</dt><dd>{p.maxDiscountCap ? formatCurrency(p.maxDiscountCap) : "None"}</dd></div>
          <div><dt className="text-xs text-slate-500">Budget</dt><dd>{formatCurrency(p.budgetUsed)}{p.budget ? ` of ${formatCurrency(p.budget)} (${Math.round((p.budgetUsed / p.budget) * 100)}%)` : " used (no limit)"}</dd></div>
          <div><dt className="text-xs text-slate-500">Redemptions</dt><dd>{p.redemptions}{p.maxRedemptions ? ` of ${p.maxRedemptions}` : " (no limit)"}</dd></div>
          <div><dt className="text-xs text-slate-500">Created / approved by</dt><dd>{p.createdBy ?? "—"} / {p.approvedBy ?? "—"}</dd></div>
        </dl>
        {p.suspendReason && <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">Suspended: {p.suspendReason}</p>}
        {p.notes && <p className="mt-3 text-xs text-slate-500">Notes: {p.notes}</p>}

        {actions.length > 0 && (
          <form action={transitionPromotion} className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <input type="hidden" name="id" value={p.id} />
            <input className="input max-w-xs flex-1" name="reason" placeholder="Reason (required to suspend)" />
            {actions.map((a) => (
              <button key={a.action} type="submit" name="action" value={a.action} className={a.tone === "primary" ? "btn-primary" : a.tone === "danger" ? "btn-danger" : "btn-secondary"}>
                {a.label}
              </button>
            ))}
          </form>
        )}
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          {p.status === "draft" && <Link className="text-blue-600 hover:underline" href={`/admin/promotions/${p.id}/edit`}>Edit draft</Link>}
          {p.status !== "draft" && p.status !== "discarded" && <Link className="text-blue-600 hover:underline" href={`/admin/promotions/new?from=${p.id}`}>Start a new version</Link>}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card p-4"><p className="text-xs text-slate-500">Orders using it</p><p className="text-xl font-semibold text-slate-900">{orders}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Discount given (live orders)</p><p className="text-xl font-semibold text-slate-900">{formatCurrency(given)}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Claims raised</p><p className="text-xl font-semibold text-slate-900">{claims.length}</p></div>
      </div>

      {versions.length > 1 && (
        <div className="card p-6">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Version history</h3>
          <ul className="space-y-1.5 text-sm">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center gap-3">
                <Link href={`/admin/promotions/${v.id}`} className={`w-12 font-medium ${v.id === p.id ? "text-slate-900" : "text-blue-600 hover:underline"}`}>v{v.version}</Link>
                <span className="text-xs text-slate-500">{formatDate(v.startDate)} – {formatDate(v.endDate)}</span>
                <StatusBadge status={v.status} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card p-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Change history</h3>
        <ol className="space-y-2 border-l-2 border-slate-200 pl-4">
          {audit.map((a) => (
            <li key={a.id} className="text-xs text-slate-600">
              <span className="font-medium text-slate-800">{a.summary}</span>
              <span className="text-slate-400"> — {formatDateTime(a.createdAt)}</span>
            </li>
          ))}
          {audit.length === 0 && <li className="text-xs text-slate-400">No recorded changes.</li>}
        </ol>
      </div>
    </div>
  );
}
