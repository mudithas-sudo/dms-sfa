import { createBranch } from "@/app/actions/admin-actions";
import Link from "next/link";

export default function NewBranchPage() {
  return (
    <div className="max-w-xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/admin/branches" className="hover:underline">Branches</Link>
        <span>/</span>
        <span className="text-slate-900">New</span>
      </div>
      <div className="card p-6">
        <h2 className="mb-4 text-base font-semibold text-slate-900">New Branch</h2>
        <form action={createBranch} className="space-y-4">
          <div>
            <label className="label" htmlFor="name">Branch Name</label>
            <input className="input" id="name" name="name" required placeholder="e.g. Iloilo Branch" />
          </div>
          <div>
            <label className="label" htmlFor="code">Branch Code</label>
            <input className="input" id="code" name="code" placeholder="e.g. ILO-01" />
          </div>
          <div>
            <label className="label" htmlFor="address">Address</label>
            <input className="input" id="address" name="address" required placeholder="Street, City, Province" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="contactPerson">Contact Person</label>
              <input className="input" id="contactPerson" name="contactPerson" placeholder="Branch manager name" />
            </div>
            <div>
              <label className="label" htmlFor="contactPhone">Contact Phone</label>
              <input className="input" id="contactPhone" name="contactPhone" placeholder="e.g. 0917-123-4567" />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" className="btn-primary">Create Branch</button>
            <Link href="/admin/branches" className="btn-secondary">Cancel</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
