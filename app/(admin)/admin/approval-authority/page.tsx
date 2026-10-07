import Banner from "@/components/Banner";
import { prisma } from "@/lib/prisma";
import { getAllSettings } from "@/lib/settings";
import { APPROVAL_TYPES } from "@/lib/approval-types";
import { saveApprovalAuthority } from "@/app/actions/approval-config-actions";
import Link from "next/link";

export default async function ApprovalAuthorityPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  const s = await getAllSettings();
  const ho = ((await prisma.appSetting.findUnique({ where: { key: "approval.headOfficeTypes" } }))?.value ?? "").split(",").filter(Boolean);
  const pending = await prisma.approvalRequest.groupBy({ by: ["type"], where: { status: "pending" }, _count: true });
  const areas = [...new Set(APPROVAL_TYPES.map((t) => t.area))];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Approval Authority</h2>
        <p className="mt-1 text-sm text-slate-500">
          Who decides each kind of request. By default a supervisor approves within the value limit shown (limits are set in <Link className="text-blue-600 underline" href="/admin/settings">Platform Configuration</Link>) and anything larger,
          or any request a supervisor escalates, goes to head office. Tick <strong>Head office only</strong> to take a type away from supervisors entirely. The person who raised a request can never approve it (administrators excepted).
        </p>
      </div>
      <Banner error={error} notice={notice} />
      <form action={saveApprovalAuthority} className="space-y-4">
        {areas.map((a) => (
          <div key={a} className="card overflow-x-auto">
            <h3 className="border-b border-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{a}</h3>
            <table className="w-full">
              <thead><tr className="text-left"><th className="th">Request</th><th className="th">Supervisor limit</th><th className="th">Waiting</th><th className="th">Head office only</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {APPROVAL_TYPES.filter((t) => t.area === a).map((t) => (
                  <tr key={t.id}>
                    <td className="td font-medium text-slate-900">{t.label}</td>
                    <td className="td text-xs text-slate-600">{t.limit ? `${t.limit.label}: ${Number(s[t.limit.key]).toLocaleString("en-PH")}` : "No value limit — any supervisor"}</td>
                    <td className="td text-xs">{pending.find((p) => p.type === t.id)?._count ?? 0}</td>
                    <td className="td"><input type="checkbox" name={`ho_${t.id}`} defaultChecked={ho.includes(t.id)} className="h-4 w-4 rounded border-slate-300" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        <button type="submit" className="btn-primary">Save approval authority</button>
      </form>
    </div>
  );
}
