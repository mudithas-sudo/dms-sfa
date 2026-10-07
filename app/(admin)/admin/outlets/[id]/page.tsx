import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { updateOutlet, setOutletBlocked } from "@/app/actions/admin-actions";
import Banner from "@/components/Banner";
import StatusBadge from "@/components/StatusBadge";
import OutletForm from "@/components/admin/OutletForm";
import { paymentTermOptions } from "@/lib/reference";
import { channelOptions } from "@/lib/masterdata";
import { formatDateTime } from "@/lib/format";

export default async function EditOutletPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const [outlet, branches, channels, routes, history] = await Promise.all([
    prisma.outlet.findUnique({ where: { id } }),
    prisma.branch.findMany({ orderBy: { name: "asc" } }),
    channelOptions(),
    prisma.route.findMany({ orderBy: { name: "asc" } }),
    prisma.auditLog.findMany({ where: { entity: "Outlet", entityId: id }, orderBy: { createdAt: "desc" }, take: 8, include: { user: true } }),
  ]);
  if (!outlet) notFound();

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/admin/outlets" className="hover:underline">Outlets</Link>
        <span>/</span>
        <span className="text-slate-900">{outlet.name}</span>
      </div>
      <div className="card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Edit Outlet</h2>
          <div className="flex gap-2">
            <StatusBadge status={outlet.status} />
            <StatusBadge status={outlet.onboardingStatus} />
          </div>
        </div>
        <div className="mb-4 space-y-3">
          <Banner error={error} />
          {outlet.status === "blocked" && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">Blocked: {outlet.blockedReason}. No new orders can be raised.</p>
          )}
          {outlet.onboardingStatus === "returned" && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">Returned for correction: {outlet.onboardingReason}</p>
          )}
        </div>
        <OutletForm terms={await paymentTermOptions()} action={updateOutlet} outlet={outlet} branches={branches} channels={channels} routes={routes} submitLabel="Save changes" />
        {outlet.status !== "blocked" ? (
          <form action={setOutletBlocked} className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <input type="hidden" name="id" value={outlet.id} />
            <input type="hidden" name="block" value="1" />
            <input className="input max-w-xs" name="reason" placeholder="Reason (credit, compliance…)" />
            <button className="btn-danger" type="submit">Block outlet</button>
            <span className="text-xs text-slate-500">Temporarily bars new orders; can be released later.</span>
          </form>
        ) : (
          <form action={setOutletBlocked} className="mt-5 flex items-center gap-2 border-t border-slate-100 pt-4">
            <input type="hidden" name="id" value={outlet.id} />
            <input type="hidden" name="block" value="0" />
            <button className="btn-primary" type="submit">Release block</button>
          </form>
        )}
      </div>
      <div className="card p-5">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Change history</h3>
        <ul className="space-y-1.5 text-xs text-slate-600">
          {history.map((h) => (
            <li key={h.id}>
              <span className="text-slate-400">{formatDateTime(h.createdAt)}</span> · {h.user.name} · {h.summary}
            </li>
          ))}
          {history.length === 0 && <li className="text-slate-400">No recorded changes.</li>}
        </ul>
      </div>
    </div>
  );
}
