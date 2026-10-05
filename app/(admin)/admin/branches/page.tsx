import Link from "next/link";
import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import { Plus } from "lucide-react";

export default async function BranchesPage() {
  const branches = await prisma.branch.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { outlets: true, warehouses: true, vans: true } } },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">Branches</h2>
        <Link href="/admin/branches/new" className="btn-primary">
          <Plus size={16} /> New Branch
        </Link>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Name</th>
              <th className="th">Code</th>
              <th className="th">Address</th>
              <th className="th">Outlets</th>
              <th className="th">Warehouses</th>
              <th className="th">Vans</th>
              <th className="th">Status</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {branches.map((b) => (
              <tr key={b.id} className="hover:bg-slate-50">
                <td className="td font-medium text-slate-900">{b.name}</td>
                <td className="td text-xs text-slate-500">{b.code ?? "—"}</td>
                <td className="td">{b.address}</td>
                <td className="td">{b._count.outlets}</td>
                <td className="td">{b._count.warehouses}</td>
                <td className="td">{b._count.vans}</td>
                <td className="td"><StatusBadge status={b.status} /></td>
                <td className="td text-right">
                  <Link href={`/admin/branches/${b.id}`} className="text-blue-600 hover:underline">
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
