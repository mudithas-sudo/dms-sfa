import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ROLES } from "@/lib/constants";

export default async function Home() {
  const { role } = await getSession();
  const roleDef = ROLES.find((r) => r.id === role) ?? ROLES[0];
  redirect(roleDef.homePath);
}
