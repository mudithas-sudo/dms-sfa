import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { ROLES } from "@/lib/constants";
import LoginScreen, { type DemoAccount } from "@/components/LoginScreen";

export const metadata = { title: "Sign in — Company F and B DMS & SFA" };
export const dynamic = "force-dynamic"; // accounts are read live, so a reseed never shows stale people

// The people of the main demo (one branch, every role), in the order a story is told.
const MAIN = [
  { role: "sales_rep", prefer: "Josephine Tan", does: "Visits customers, takes orders and payments on the phone app.", note: "Opens the field app — on a computer it shows in a phone-sized frame." },
  { role: "supervisor", does: "Approves held orders, issues invoices, controls credit and reconciles payments." },
  { role: "branch_ops", does: "Runs the branch warehouse: picking, deliveries, vans and stock." },
  { role: "admin", does: "Head office: every branch's sales, receivables, returns and the master data." },
  { role: "management", does: "Read-only dashboards and reports across all branches." },
] as const;

const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; email?: string; next?: string }> }) {
  const { error, email, next } = await searchParams;
  const [users, password] = await Promise.all([
    prisma.user.findMany({ where: { active: true, email: { not: null } }, include: { branch: true }, orderBy: { name: "asc" } }),
    getSetting("demo.password"),
  ]);
  const branch = users.find((u) => u.branch?.name.includes("Cebu"))?.branch ?? users.find((u) => u.branch)?.branch;
  const label = (role: string) => ROLES.find((r) => r.id === role)?.label ?? role;
  const toAccount = (u: (typeof users)[number], extra?: { does?: string; note?: string }): DemoAccount => ({
    name: u.name, email: u.email!, roleLabel: label(u.role), branch: u.branch?.name ?? null, initials: initialsOf(u.name), ...extra,
  });

  const main: DemoAccount[] = [];
  for (const m of MAIN) {
    const pool = users.filter((u) => u.role === m.role && (m.role === "admin" || m.role === "management" || u.branchId === branch?.id));
    const u = ("prefer" in m && pool.find((x) => x.name === m.prefer)) || pool[0];
    if (u) main.push(toAccount(u, { does: m.does, note: "note" in m ? m.note : undefined }));
  }
  const taken = new Set(main.map((a) => a.email));
  const order = ["sales_rep", "supervisor", "branch_ops", "admin", "management"];
  const others = users
    .filter((u) => !taken.has(u.email!))
    .sort((a, b) => Number(b.branchId === branch?.id) - Number(a.branchId === branch?.id) || (a.branch?.name ?? "").localeCompare(b.branch?.name ?? "") || order.indexOf(a.role) - order.indexOf(b.role))
    .map((u) => toAccount(u));

  return <LoginScreen main={main} others={others} password={password || "demo1234"} error={error} email={email} next={next} />;
}
