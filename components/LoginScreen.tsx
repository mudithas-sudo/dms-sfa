"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Boxes, LogIn, Users, Route, Smartphone, KeyRound } from "lucide-react";
import { signIn } from "@/app/actions/auth-actions";

export interface DemoAccount {
  name: string;
  email: string;
  roleLabel: string;
  branch: string | null;
  initials: string;
  does?: string;
  note?: string;
}

const TILE = ["bg-blue-600", "bg-blue-800", "bg-slate-800", "bg-slate-600", "bg-blue-500"];

// The sign-in page: a form on the left, the demo accounts on the right. "Use this account" fills the form.
export default function LoginScreen({
  main,
  others,
  password,
  error,
  email: initialEmail,
  next,
}: {
  main: DemoAccount[];
  others: DemoAccount[];
  password: string;
  error?: string;
  email?: string;
  next?: string;
}) {
  const [email, setEmail] = useState(initialEmail ?? "");
  const [pw, setPw] = useState("");
  const [showHint, setShowHint] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const use = (a: DemoAccount) => {
    setEmail(a.email);
    setPw(password);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    emailRef.current?.focus();
  };

  return (
    <div className="min-h-screen px-4 py-5 sm:px-8 sm:py-6">
      <header className="mx-auto flex max-w-6xl items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white">
          <Boxes size={20} />
        </span>
        <span className="text-base font-bold uppercase tracking-tight text-slate-900">Company F&amp;B</span>
        <span className="rounded-md bg-slate-200/70 px-2 py-0.5 text-xs font-medium text-slate-600">Prototype</span>
      </header>

      <div className="mx-auto mt-6 grid max-w-6xl items-start gap-6 lg:mt-10 lg:grid-cols-[360px_minmax(0,1fr)] lg:gap-8">
        {/* sign-in */}
        <form ref={formRef} action={signIn} className="card p-6 lg:sticky lg:top-6">
          <h1 className="text-lg font-semibold text-slate-900">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Use one of the demo accounts to see the Distributor Management and Sales Force Automation platform as each person.</p>
          {error && (
            <p role="alert" className="mt-4 rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-800">
              {error}
            </p>
          )}
          <input type="hidden" name="next" value={next ?? ""} />
          <label className="label mt-5" htmlFor="email">Email</label>
          <input ref={emailRef} className="input" id="email" name="email" type="email" autoComplete="username" placeholder="name@companyfb.ph" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <div className="mt-4 flex items-center justify-between">
            <label className="label mb-0" htmlFor="password">Password</label>
            <button type="button" className="text-xs font-medium text-blue-700 hover:underline" onClick={() => setShowHint((v) => !v)}>
              Forgot password?
            </button>
          </div>
          <input className="input mt-1.5" id="password" name="password" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
          {showHint && (
            <p className="mt-2 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-600">
              This is a prototype: every demo account uses the password <code className="font-semibold text-slate-900">{password}</code>. In the live system, password resets go through your administrator.
            </p>
          )}
          <button type="submit" className="btn-primary mt-5 w-full py-2.5">
            <LogIn size={16} /> Sign in
          </button>
          <div className="mt-5 space-y-2.5 border-t border-slate-100 pt-4 text-sm">
            <Link href="/start" className="flex items-center gap-2 text-slate-700 hover:text-slate-900">
              <Route size={15} className="text-slate-500" /> Follow the end-to-end test scenarios
            </Link>
            <Link href="/sfa/login" className="flex items-center gap-2 text-slate-700 hover:text-slate-900">
              <Smartphone size={15} className="text-slate-500" /> Field app sign-in with a device PIN
            </Link>
          </div>
        </form>

        {/* demo accounts */}
        <section>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Users size={16} className="text-slate-500" /> Demo accounts
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Password for every account: <code className="rounded-md bg-slate-200/70 px-1.5 py-0.5 text-xs font-semibold text-slate-800">{password}</code>. Pick a card to fill the form.
          </p>
          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">Main demo</span>
            <span className="font-semibold text-slate-900">Cebu Branch</span>
            <span className="text-slate-500">Order → pick → invoice → deliver → collect</span>
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {main.map((a, i) => (
              <article key={a.email} className="card flex flex-col p-4">
                <div className="flex items-start gap-3">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold text-white ${TILE[i % TILE.length]}`}>{a.initials}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-blue-700">{a.roleLabel}</p>
                    <p className="truncate text-sm font-semibold text-slate-900">{a.name}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-slate-500">Company F and B{a.branch ? ` · ${a.branch}` : " · Head office"}</p>
                {a.does && <p className="mt-1.5 text-sm text-slate-700">{a.does}</p>}
                {a.note && <p className="mt-1.5 text-xs text-slate-500">{a.note}</p>}
                <p className="mt-3 truncate font-mono text-xs text-slate-600">{a.email}</p>
                <button type="button" className="btn-secondary mt-3 w-fit px-3 py-1.5 text-xs" onClick={() => use(a)}>
                  <LogIn size={14} /> Use this account
                </button>
              </article>
            ))}
          </div>

          {others.length > 0 && (
            <details className="card mt-3 group">
              <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-slate-900 [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-2"><KeyRound size={15} className="text-slate-500" /> More accounts — other representatives and branches ({others.length})</span>
                <span className="text-xs font-medium text-slate-500 group-open:hidden">Show</span>
              </summary>
              <ul className="divide-y divide-slate-100 border-t border-slate-100">
                {others.map((a) => (
                  <li key={a.email} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{a.name}</p>
                      <p className="truncate text-xs text-slate-500">{a.roleLabel} · {a.branch ?? "Head office"}</p>
                    </div>
                    <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => use(a)}>Use</button>
                  </li>
                ))}
              </ul>
              <p className="px-4 pb-3 text-xs text-slate-500">Testing with several people at once? Each person takes a different representative — a rep can have one visit open at a time.</p>
            </details>
          )}
        </section>
      </div>
    </div>
  );
}
