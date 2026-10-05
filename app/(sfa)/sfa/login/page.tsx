import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { setUser } from "@/app/actions/session-actions";
import { LogIn } from "lucide-react";

export default async function MockLoginPage() {
  const { userId } = await getSession();
  const rep = userId ? await prisma.user.findUnique({ where: { id: userId }, include: { branch: true } }) : null;

  return (
    <div className="flex h-full flex-col items-center justify-center space-y-6 px-2 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-2xl font-bold text-white">CF</div>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Company F and B Field Sales</h2>
        <p className="mt-1 text-sm text-slate-500">Secure sign-in (simulated — the role switcher above is the real session control in this prototype)</p>
      </div>
      {rep && (
        <div className="card w-full max-w-xs p-4">
          <p className="text-sm font-medium text-slate-900">{rep.name}</p>
          <p className="text-xs text-slate-500">{rep.branch?.name}</p>
          <form action={setUser.bind(null, rep.id)} className="mt-3">
            <button type="submit" className="btn-primary flex w-full items-center justify-center gap-2">
              <LogIn size={16} /> Continue as {rep.name.split(" ")[0]}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
