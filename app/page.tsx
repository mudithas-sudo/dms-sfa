import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSession } from "@/lib/session";
import { ROLES, ROLE_COOKIE } from "@/lib/constants";

// A first visit (no role chosen yet) lands on the "Start here" page; after that, on the chosen role's home.
export default async function Home() {
  if (!(await cookies()).get(ROLE_COOKIE)) redirect("/start");
  const { role } = await getSession();
  const roleDef = ROLES.find((r) => r.id === role) ?? ROLES[0];
  redirect(roleDef.homePath);
}
