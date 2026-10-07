import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createOutlet } from "@/app/actions/admin-actions";
import Banner from "@/components/Banner";
import OutletForm from "@/components/admin/OutletForm";
import { paymentTermOptions } from "@/lib/reference";
import { channelOptions } from "@/lib/masterdata";

export default async function NewOutletPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const dupIds = sp.duplicates ? sp.duplicates.split(",") : [];
  const [branches, channels, routes, duplicates] = await Promise.all([
    prisma.branch.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
    channelOptions(),
    prisma.route.findMany({ orderBy: { name: "asc" } }),
    dupIds.length
      ? prisma.outlet.findMany({ where: { id: { in: dupIds } }, select: { id: true, name: true, address: true, code: true, status: true } })
      : Promise.resolve([]),
  ]);

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/admin/outlets" className="hover:underline">Outlets</Link>
        <span>/</span>
        <span className="text-slate-900">New</span>
      </div>
      <div className="card p-6">
        <h2 className="mb-1 text-base font-semibold text-slate-900">New Outlet</h2>
        <p className="mb-4 text-xs text-slate-500">
          Name, address, GPS location, channel, route and branch are mandatory. The outlet is saved as <strong>Pending Approval</strong> and is
          sellable only after an approver other than you approves it.
        </p>
        <div className="mb-4">
          <Banner error={sp.error} />
        </div>
        <OutletForm terms={await paymentTermOptions()} action={createOutlet} values={sp} branches={branches} channels={channels} routes={routes} duplicates={duplicates} submitLabel="Submit for approval" />
      </div>
    </div>
  );
}
