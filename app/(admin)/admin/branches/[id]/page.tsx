import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { updateBranch } from "@/app/actions/admin-actions";
import BranchForm from "../BranchForm";

export default async function EditBranchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const branch = await prisma.branch.findUnique({ where: { id } });
  if (!branch) notFound();

  const [openOrders, openPos, vanStock] = await Promise.all([
    prisma.salesOrder.count({ where: { branchId: id, status: { in: ["draft", "confirmed"] } } }),
    prisma.purchaseOrder.count({ where: { branchId: id, status: { in: ["pending", "partially_received", "exception"] } } }),
    prisma.stockBalance.aggregate({ where: { locationType: "van", van: { branchId: id } }, _sum: { qtyGood: true, qtyDamaged: true } }),
  ]);
  const openItems: string[] = [];
  if (openOrders) openItems.push(`${openOrders} open order(s)`);
  if (openPos) openItems.push(`${openPos} purchase order(s) awaiting receipt`);
  const vanUnits = (vanStock._sum.qtyGood ?? 0) + (vanStock._sum.qtyDamaged ?? 0);
  if (vanUnits) openItems.push(`${vanUnits} unit(s) in vans`);

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/admin/branches" className="hover:underline">Branches</Link>
        <span>/</span>
        <span className="text-slate-900">{branch.name}</span>
      </div>
      <BranchForm action={updateBranch} branch={branch} error={error} openItems={openItems} submitLabel="Save Changes" />
    </div>
  );
}
