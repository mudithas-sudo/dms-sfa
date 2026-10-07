import Link from "next/link";
import { getSession } from "@/lib/session";
import { ROLES } from "@/lib/constants";
import Forbidden from "@/components/Forbidden";
import { PERMISSION_MODULES } from "@/lib/rbac";

export default async function ForbiddenPage({ searchParams }: { searchParams: Promise<{ module?: string; need?: string }> }) {
  const { module, need } = await searchParams;
  const { role } = await getSession();
  const home = ROLES.find((r) => r.id === role)?.homePath ?? "/";
  const label = PERMISSION_MODULES.find((m) => m.id === module)?.label ?? "this action";
  return (
    <div className="p-6">
      <Forbidden role={role} area={`${label}${need ? ` (${need} permission)` : ""}`} />
      <p className="mt-4 text-center text-sm">
        <Link href={home} className="text-blue-600 hover:underline">Back to my home</Link>
      </p>
    </div>
  );
}
