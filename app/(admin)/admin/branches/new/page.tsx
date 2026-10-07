import Link from "next/link";
import { createBranch } from "@/app/actions/admin-actions";
import BranchForm from "../BranchForm";

export default async function NewBranchPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/admin/branches" className="hover:underline">Branches</Link>
        <span>/</span>
        <span className="text-slate-900">New</span>
      </div>
      <BranchForm action={createBranch} error={error} submitLabel="Create Branch" />
    </div>
  );
}
