import Link from "next/link";
import Banner from "@/components/Banner";
import type { Branch } from "@prisma/client";

export default function BranchForm({
  action,
  branch,
  error,
  openItems,
  submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  branch?: Branch;
  error?: string;
  openItems?: string[];
  submitLabel: string;
}) {
  return (
    <div className="card p-6">
      <h2 className="mb-4 text-base font-semibold text-slate-900">{branch ? "Edit Branch" : "New Branch"}</h2>
      <div className="mb-4 space-y-3">
        <Banner error={error} />
        {branch && openItems && openItems.length > 0 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            Open work blocks deactivation: {openItems.join(", ")}.
          </p>
        )}
      </div>
      <form action={action} className="space-y-4">
        {branch && <input type="hidden" name="id" value={branch.id} />}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="name">Branch name</label>
            <input className="input" id="name" name="name" defaultValue={branch?.name} required placeholder="e.g. Iloilo Branch" />
          </div>
          <div>
            <label className="label" htmlFor="code">Branch code (unique)</label>
            <input className="input" id="code" name="code" defaultValue={branch?.code ?? ""} placeholder="e.g. ILO-01" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="address">Address</label>
          <input className="input" id="address" name="address" defaultValue={branch?.address} required />
        </div>
        <div>
          <label className="label" htmlFor="region">Sales region</label>
          <input className="input" id="region" name="region" defaultValue={branch?.region ?? ""} placeholder="e.g. Visayas" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label" htmlFor="contactPerson">Branch manager</label>
            <input className="input" id="contactPerson" name="contactPerson" defaultValue={branch?.contactPerson ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="contactPhone">Telephone</label>
            <input className="input" id="contactPhone" name="contactPhone" defaultValue={branch?.contactPhone ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="contactEmail">Email</label>
            <input className="input" id="contactEmail" name="contactEmail" type="email" defaultValue={branch?.contactEmail ?? ""} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="status">Status</label>
          <select className="input" id="status" name="status" defaultValue={branch?.status ?? "active"}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Only an Active branch can create orders, receive stock or load vans. Deactivating keeps all history for reporting.
          </p>
        </div>
        {branch && (
          <p className="text-xs text-slate-500">
            Activated {branch.activatedAt ? branch.activatedAt.toLocaleDateString("en-PH") : "—"}
            {branch.deactivatedAt ? ` · Deactivated ${branch.deactivatedAt.toLocaleDateString("en-PH")}` : ""}
          </p>
        )}
        <div className="flex gap-2 pt-2">
          <button type="submit" className="btn-primary">{submitLabel}</button>
          <Link href="/admin/branches" className="btn-secondary">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
