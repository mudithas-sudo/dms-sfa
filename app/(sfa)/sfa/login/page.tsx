import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import { pinSignIn } from "@/app/actions/sfa-auth-actions";
import { KeyRound } from "lucide-react";

export default async function SfaLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { userId } = await getSession();
  const { error } = await searchParams;
  const reps = await prisma.user.findMany({ where: { role: "sales_rep", active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, branch: { select: { name: true } } } });
  const devices = await prisma.deviceRegistration.findMany({ where: { userId: { in: reps.map((r) => r.id) } } });
  const pin = (await prisma.appSetting.findUnique({ where: { key: "sfa.demoPin" } }))?.value ?? "1234";

  return (
    <div className="space-y-4 px-1">
      <div className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-xl font-bold text-white">CF</div>
        <h2 className="mt-2 text-base font-semibold text-slate-900">Company F and B Field Sales</h2>
        <p className="text-xs text-slate-500">Sign in with your PIN on your registered device</p>
      </div>
      <Banner error={error} />
      <form action={pinSignIn} className="card space-y-3 p-4">
        <div>
          <label className="label" htmlFor="userId">Representative</label>
          <select className="input" id="userId" name="userId" defaultValue={userId ?? ""}>
            {reps.map((r) => {
              const d = devices.find((x) => x.userId === r.id);
              return <option key={r.id} value={r.id}>{r.name} · {r.branch?.name}{d ? ` · ${d.status}` : " · no device"}</option>;
            })}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="pin">PIN</label>
          <input className="input" id="pin" name="pin" type="password" inputMode="numeric" autoComplete="off" required />
        </div>
        <button className="btn-primary flex w-full items-center justify-center gap-2" type="submit"><KeyRound size={16} /> Sign in</button>
        <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-slate-500">
          <li>The device must be registered and approved for you.</li>
          <li>Five wrong PINs lock the account for 15 minutes; a supervisor or administrator can unlock it.</li>
          <li>Demo PIN for every representative: <strong>{pin}</strong></li>
        </ul>
      </form>
    </div>
  );
}
