import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSession } from "@/lib/session";
import { ROLES, ROLE_COOKIE } from "@/lib/constants";

// Signed out, the site opens on the sign-in page; signed in, on that person's home.
export default async function Home() {
  if (!(await cookies()).get(ROLE_COOKIE)) redirect("/login");
  const { role } = await getSession();
  const roleDef = ROLES.find((r) => r.id === role) ?? ROLES[0];
  redirect(roleDef.homePath);
}
