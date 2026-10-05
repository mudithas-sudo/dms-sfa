"use client";

import { useTransition } from "react";
import { ROLES, type RoleId } from "@/lib/constants";
import { setRole, setBranch, setUser } from "@/app/actions/session-actions";

interface BranchOption {
  id: string;
  name: string;
}
interface UserOption {
  id: string;
  name: string;
  branchId: string | null;
  role: string;
}

export default function RoleSwitcher({
  currentRole,
  currentBranchId,
  currentUserId,
  branches,
  users,
}: {
  currentRole: RoleId;
  currentBranchId: string | null;
  currentUserId: string | null;
  branches: BranchOption[];
  users: UserOption[];
}) {
  const [isPending, startTransition] = useTransition();
  const branchScoped = currentRole !== "admin" && currentRole !== "management";

  const usersForBranch = users.filter(
    (u) => u.role === currentRole && (!branchScoped || u.branchId === currentBranchId),
  );

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select
        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none"
        value={currentRole}
        disabled={isPending}
        onChange={(e) => startTransition(() => void setRole(e.target.value as RoleId))}
      >
        {ROLES.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>

      {branchScoped && (
        <select
          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none"
          value={currentBranchId ?? ""}
          disabled={isPending}
          onChange={(e) => startTransition(() => void setBranch(e.target.value))}
        >
          {!currentBranchId && <option value="">Select branch…</option>}
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}

      {usersForBranch.length > 0 && (
        <select
          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none"
          value={currentUserId ?? ""}
          disabled={isPending}
          onChange={(e) => startTransition(() => void setUser(e.target.value))}
        >
          {(!currentUserId || !usersForBranch.some((u) => u.id === currentUserId)) && (
            <option value="">Select user…</option>
          )}
          {usersForBranch.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
