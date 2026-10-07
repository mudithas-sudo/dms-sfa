import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import CollectionForm from "@/components/CollectionForm";
import { outletBalance } from "@/lib/finance";

export default async function NewCollectionPage({ searchParams }: { searchParams: Promise<{ outlet?: string; error?: string }> }) {
  const { branchId } = await getSession();
  const { outlet: outletIdParam, error } = await searchParams;
  const outlets = branchId ? await prisma.outlet.findMany({ where: { branchId, status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  const selectedOutletId = outletIdParam ?? outlets[0]?.id;
  const outstanding = selectedOutletId ? Math.max(0, await outletBalance(selectedOutletId)) : 0;

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">Collect Payment</h2>
      <Banner error={error} />
      <CollectionForm outlets={outlets} selected={selectedOutletId} outstanding={outstanding} today={new Date().toISOString().slice(0, 10)} />
    </div>
  );
}
