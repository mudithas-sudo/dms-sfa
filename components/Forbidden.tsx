import { roleLabel } from "@/lib/constants";

export default function Forbidden({ role, area }: { role: string; area: string }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-xl">🔒</div>
      <h1 className="text-base font-semibold text-slate-900">Access restricted</h1>
      <p className="mt-2 text-sm text-slate-600">
        The <strong>{area}</strong> area is not available to the <strong>{roleLabel(role)}</strong> role. Each user sees only
        the modules their role allows.
      </p>
      <p className="mt-4 text-xs text-slate-500">Use the role switcher in the header to continue as a different role.</p>
    </div>
  );
}
