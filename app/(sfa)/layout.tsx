import MobileShell from "@/components/MobileShell";
import { getSession } from "@/lib/session";

export default async function SfaLayout({ children }: { children: React.ReactNode }) {
  const { role, branchId, userId } = await getSession();
  return (
    <MobileShell role={role} branchId={branchId} userId={userId} title="Field Sales">
      {children}
    </MobileShell>
  );
}
