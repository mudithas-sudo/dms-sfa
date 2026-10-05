import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { updateBranch } from "@/app/actions/admin-actions";

export default async function EditBranchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const branch = await prisma.branch.findUnique({ where: { id } });
  if (!branch) notFound();

  return (
    <div className="max-w-xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/admin/branches" className="hover:underline">Branches</Link>
        <span>/</span>
        <span className="text-slate-900">{branch.name}</span>
      </div>
      <div className="card p-6">
        <h2 className="mb-4 text-base font-semibold text-slate-900">Edit Branch</h2>
        <form action={updateBranch} className="space-y-4">
          <input type="hidden" name="id" value={branch.id} />
          <div>
            <label className="label" htmlFor="name">Branch Name</label>
            <input className="input" id="name" name="name" defaultValue={branch.name} required />
          </div>
          <div>
            <label className="label" htmlFor="code">Branch Code</label>
            <input className="input" id="code" name="code" defaultValue={branch.code ?? ""} placeholder="e.g. ILO-01" />
          </div>
          <div>
            <label className="label" htmlFor="address">Address</label>
            <input className="input" id="address" name="address" defaultValue={branch.address} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="contactPerson">Contact Person</label>
              <input className="input" id="contactPerson" name="contactPerson" defaultValue={branch.contactPerson ?? ""} />
            </div>
            <div>
              <label className="label" htmlFor="contactPhone">Contact Phone</label>
              <input className="input" id="contactPhone" name="contactPhone" defaultValue={branch.contactPhone ?? ""} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="status">Status</label>
            <select className="input" id="status" name="status" defaultValue={branch.status}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" className="btn-primary">Save Changes</button>
            <Link href="/admin/branches" className="btn-secondary">Cancel</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
