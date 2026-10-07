"use client";

import { useSearchParams } from "next/navigation";
import { enrolMfa } from "@/app/actions/platform-actions";

// A privileged role cannot be used until the second factor is enrolled.
export default function MfaGate({ userName, roleName, back }: { userName: string; roleName: string; back: string }) {
  const error = useSearchParams().get("error") ?? undefined;
  return (
    <div className="mx-auto mt-10 max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <h1 className="text-base font-semibold text-slate-900">Set up multi-factor authentication</h1>
      <p className="mt-2 text-sm text-slate-600">
        <strong>{roleName}</strong> is a privileged role, so {userName} must confirm a second factor before the session opens. Scan the QR code with an
        authenticator app, then enter the one-time code.
      </p>
      <div className="mx-auto my-4 grid h-28 w-28 grid-cols-6 gap-0.5 rounded-lg bg-slate-100 p-2" aria-hidden="true">
        {Array.from({ length: 36 }).map((_, i) => (
          <span key={i} className={((i * 7 + 3) % 5) % 2 === 0 ? "bg-slate-800" : "bg-white"} />
        ))}
      </div>
      {error && (
        <p role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </p>
      )}
      <form action={enrolMfa} className="space-y-3">
        <input type="hidden" name="back" value={back} />
        <input className="input text-center tracking-[0.4em]" name="code" inputMode="numeric" maxLength={6} placeholder="000000" required />
        <button className="btn-primary w-full" type="submit">Verify and continue</button>
      </form>
      <p className="mt-3 text-center text-xs text-slate-400">Prototype: the simulated authenticator code is 123456.</p>
    </div>
  );
}
