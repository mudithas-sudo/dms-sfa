import Link from "next/link";
import { prisma } from "@/lib/prisma";
import Banner from "@/components/Banner";
import { getAllSettings } from "@/lib/settings";
import { saveMfaPolicy } from "@/app/actions/platform-actions";
import { ROLES } from "@/lib/constants";
import { verifyAuditChain } from "@/lib/audit";
import { formatDateTime } from "@/lib/format";
import { ShieldCheck, ShieldAlert } from "lucide-react";

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  const [settings, users, events, chain] = await Promise.all([
    getAllSettings(),
    prisma.user.findMany({ select: { id: true, name: true, role: true, mfaEnrolled: true, active: true } }),
    prisma.auditLog.findMany({ where: { entity: "Security" }, orderBy: { createdAt: "desc" }, take: 12, include: { user: true } }),
    verifyAuditChain(),
  ]);
  const privileged = settings["mfa.privilegedRoles"].split(",");
  const enrolled = users.filter((u) => privileged.includes(u.role) && u.mfaEnrolled).length;
  const needing = users.filter((u) => privileged.includes(u.role)).length;
  const breakGlass = users.filter((u) => u.role === "admin");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Identity, Access & Audit Integrity</h2>
        <p className="mt-1 text-sm text-slate-500">
          Enterprise single sign-on, multi-factor authentication for privileged users, and the tamper-evident audit trail. SSO is simulated in this prototype (the role
          switcher stands in for the corporate identity provider); MFA enrolment and the audit-chain verification below are live.
        </p>
      </div>
      <Banner error={error} notice={notice} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Enterprise single sign-on</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Identity provider</dt><dd className="text-slate-900">{settings["sso.provider"]}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Protocol</dt><dd className="text-slate-900">{settings["sso.protocol"]}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">User matching</dt><dd className="text-slate-900">Corporate e-mail or employee code</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Provisioning</dt><dd className="text-slate-900">Administrator creates the user; roles and branches are assigned here</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Mobile</dt><dd className="text-slate-900">SFA signs in through the same identity provider</dd></div>
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            A user known to the identity provider but holding no platform role cannot reach any data. Authentication is delegated; authorization stays here.
            Edit the provider settings under <Link className="text-blue-600 hover:underline" href="/admin/settings">Platform Configuration</Link>.
          </p>
          <div className="mt-3 rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-medium text-slate-700">Break-glass administrator accounts (used only if the identity provider is unavailable)</p>
            <ul className="mt-1 text-xs text-slate-600">
              {breakGlass.map((u) => (
                <li key={u.id}>
                  {u.name} · MFA {u.mfaEnrolled ? "enrolled" : "not enrolled"} · every use is logged
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="card p-5">
          <h3 className="mb-1 text-sm font-semibold text-slate-900">Multi-factor authentication</h3>
          <p className="mb-3 text-xs text-slate-500">
            Privileged roles confirm their identity with a one-time code or authenticator approval after sign-in. Where the corporate identity provider already enforces MFA,
            it is honoured and users are not challenged twice. {enrolled} of {needing} privileged users are enrolled.
          </p>
          <form action={saveMfaPolicy} className="space-y-2">
            {ROLES.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="roles" value={r.id} defaultChecked={privileged.includes(r.id)} /> {r.label} must use MFA
              </label>
            ))}
            <button className="btn-secondary mt-2" type="submit">Save MFA policy</button>
          </form>
          <p className="mt-3 text-xs text-slate-500">
            Enrolment happens at first sign-in; a privileged role cannot be used until it is complete. Resetting a second factor is a controlled action on the{" "}
            <Link className="text-blue-600 hover:underline" href="/admin/users">Users</Link> page and is audited.
          </p>
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          {chain.ok ? <ShieldCheck size={18} className="text-emerald-600" /> : <ShieldAlert size={18} className="text-rose-600" />}
          <h3 className="text-sm font-semibold text-slate-900">Tamper-evident audit chain</h3>
        </div>
        <p className="text-sm text-slate-700">
          {chain.ok
            ? `Verified: ${chain.checked} chained audit entries are intact — no entry has been altered, removed or inserted.`
            : `Integrity problem: ${chain.problems.length} issue(s) found in the audit chain.`}
          {chain.legacy > 0 && <span className="text-slate-500"> ({chain.legacy} earlier entries pre-date the checksum chain.)</span>}
        </p>
        {!chain.ok && (
          <ul className="mt-2 space-y-1 text-xs text-rose-700">
            {chain.problems.slice(0, 8).map((p) => (
              <li key={`${p.seq}-${p.problem}`}>Entry #{p.seq}: {p.problem}</li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Each audit record stores a checksum that chains it to the previous one and is verified on every visit to this page. Audit entries are append-only: no screen or
          API changes or removes them. <Link className="text-blue-600 hover:underline" href="/admin/audit-log">Open the audit log</Link>.
        </p>
      </div>

      <div className="card p-5">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Recent security events</h3>
        <ul className="space-y-1 text-xs text-slate-600">
          {events.map((e) => (
            <li key={e.id}>
              <span className="text-slate-400">{formatDateTime(e.createdAt)}</span> · {e.user.name} · {e.summary}
            </li>
          ))}
          {events.length === 0 && <li className="text-slate-400">No sign-in events recorded yet — switch role to generate some.</li>}
        </ul>
      </div>
    </div>
  );
}
