import Link from "next/link";
import { Boxes, ArrowRight, Building2, Warehouse, ShieldCheck, Smartphone, BarChart3, type LucideIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { switchPersona } from "@/app/actions/session-actions";
import { ROLES, type RoleId } from "@/lib/constants";

export const metadata = { title: "Start here — Company F and B DMS & SFA" };

// The front door for people trying the prototype: pick a person in one click, then follow an end-to-end scenario.
// Each step button signs in as the right person and opens the right screen.

type Who = "rep" | "sup" | "ops" | "admin" | "mgmt";
const WHO: Record<Who, { role: RoleId; icon: LucideIcon; does: string }> = {
  rep: { role: "sales_rep", icon: Smartphone, does: "Takes orders, collects payments and visits customers on the phone app." },
  sup: { role: "supervisor", icon: ShieldCheck, does: "Approves held orders, invoices, controls credit and reconciles payments." },
  ops: { role: "branch_ops", icon: Warehouse, does: "Runs the branch warehouse: picking, delivery, vans and stock." },
  admin: { role: "admin", icon: Building2, does: "Head office: every branch's sales, receivables, returns and master data." },
  mgmt: { role: "management", icon: BarChart3, does: "Read-only dashboards and reports across all branches." },
};

const SCENARIOS: { title: string; why: string; steps: { who: Who; href: string; text: string }[] }[] = [
  {
    title: "1. Order to cash",
    why: "One order from the customer's shop to money in the bank, through every team.",
    steps: [
      { who: "rep", href: "/sfa/attendance", text: "Start the day — attendance is GPS-stamped." },
      { who: "rep", href: "/sfa/visit/new", text: "Check in at a customer (leave the location as “Demo: at the outlet”)." },
      { who: "rep", href: "/sfa/order/new", text: "Take a pre-sales order: add products, pick a delivery date, submit. Note the order number. An order over the credit limit or short of stock is held for approval." },
      { who: "sup", href: "/supervisor/approvals", text: "If the order was held, approve it." },
      { who: "ops", href: "/branch/picklists", text: "Tick the order, generate the picklist, then Record picks." },
      { who: "sup", href: "/supervisor/orders", text: "Open the order and press Issue invoice & dispatch stock." },
      { who: "ops", href: "/branch/deliveries", text: "Mark it out for delivery, then Record delivery: what the customer accepted, the receiver's name and a signature. Deliver less than invoiced to see an undelivered balance." },
      { who: "rep", href: "/sfa/collections/new", text: "Collect a payment from the customer." },
      { who: "sup", href: "/supervisor/payment-reconciliation", text: "See the collection to reconcile; AR Aging shows the new balance." },
      { who: "admin", href: "/admin", text: "Head office sees the order, the receivable and the collection." },
    ],
  },
  {
    title: "2. Van sale",
    why: "Sell and deliver from the van in one visit.",
    steps: [
      { who: "rep", href: "/sfa/van-stock", text: "See what is on the van." },
      { who: "rep", href: "/sfa/order/new", text: "Choose Van sale, add products, take the customer's signature and submit — the invoice is issued at once and can be printed." },
    ],
  },
  {
    title: "3. New customer",
    why: "A rep signs up a shop; the supervisor approves it before anyone can sell to it.",
    steps: [
      { who: "rep", href: "/sfa/customers/new", text: "Register a new customer with a photo of the shop front." },
      { who: "sup", href: "/supervisor/onboarding", text: "Approve it, setting the route and credit terms." },
      { who: "admin", href: "/admin/outlets", text: "The customer is now in the master list." },
    ],
  },
  {
    title: "4. Market return",
    why: "Goods come back from a customer and become a credit note.",
    steps: [
      { who: "rep", href: "/sfa/market-returns/new", text: "Record a return against an invoice, with the reason, a photo and a signature." },
      { who: "sup", href: "/supervisor/market-returns", text: "Approve it — a credit note reduces what the customer owes." },
      { who: "admin", href: "/admin/returns", text: "Head office sees returns by branch." },
    ],
  },
  {
    title: "5. Restock the van",
    why: "The rep asks for stock, the warehouse loads it, the rep confirms.",
    steps: [
      { who: "rep", href: "/sfa/van-stock", text: "Open Request stock and ask for products." },
      { who: "ops", href: "/branch/replenishment-requests", text: "Approve the request (in full or reduced)." },
      { who: "ops", href: "/branch/van-loading", text: "Load the van." },
      { who: "rep", href: "/sfa/van-stock", text: "Confirm what was received." },
    ],
  },
  {
    title: "6. Close the day",
    why: "Count the van and hand over cash; differences go to the supervisor.",
    steps: [
      { who: "rep", href: "/sfa/eod", text: "Count the van and declare the cash." },
      { who: "ops", href: "/branch/eod-reconciliation", text: "The branch confirms the reconciliation." },
      { who: "rep", href: "/sfa/attendance", text: "End the day." },
    ],
  },
];

export default async function StartPage() {
  const branch = (await prisma.branch.findFirst({ where: { name: { contains: "Cebu" } } })) ?? (await prisma.branch.findFirst({ orderBy: { name: "asc" } }));
  const users = await prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, include: { branch: true } });
  const pick = (role: RoleId, prefer?: string) => {
    const pool = users.filter((u) => u.role === role && (role === "admin" || role === "management" || u.branchId === branch?.id));
    return pool.find((u) => prefer && u.name === prefer) ?? pool[0];
  };
  const people: Record<Who, (typeof users)[number] | undefined> = {
    rep: pick("sales_rep", "Josephine Tan"),
    sup: pick("supervisor"),
    ops: pick("branch_ops"),
    admin: pick("admin"),
    mgmt: pick("management"),
  };
  const otherReps = users.filter((u) => u.role === "sales_rep" && u.branchId === branch?.id && u.id !== people.rep?.id);
  const label = (w: Who) => ROLES.find((r) => r.id === WHO[w].role)?.label ?? w;

  const Go = ({ who, href, children, className }: { who: Who; href: string; children: React.ReactNode; className: string }) => (
    <form action={switchPersona}>
      <input type="hidden" name="role" value={WHO[who].role} />
      <input type="hidden" name="userId" value={people[who]?.id ?? ""} />
      <input type="hidden" name="next" value={href} />
      <button type="submit" className={className}>{children}</button>
    </form>
  );

  return (
    <div className="p-2.5 sm:p-5">
      <div className="mx-auto max-w-6xl rounded-[28px] border border-slate-200 bg-white p-6 sm:p-10">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white"><Boxes size={22} /></div>
          <div>
            <p className="text-lg font-bold uppercase tracking-tight text-slate-900">Company F&amp;B</p>
            <p className="text-xs text-slate-500">Distributor Management &amp; Sales Force Automation — prototype</p>
          </div>
        </div>

        <h1 className="mt-8 text-3xl font-semibold text-slate-900">Start here</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">
          Everyone uses the same sample data{branch ? ` for ${branch.name}` : ""}. Choose a person to look around, or follow a scenario below: each step opens the right screen as the right person.
          You can switch person at any time from the menu at the top right (in the phone app: “Demo: switch role or user”), and come back here from that menu.
        </p>

        <h2 className="mt-8 text-base font-semibold text-slate-900">Who do you want to be?</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {(Object.keys(WHO) as Who[]).map((w) => {
            const Icon = WHO[w].icon;
            return (
              <Go key={w} who={w} href={ROLES.find((r) => r.id === WHO[w].role)!.homePath} className="flex h-full w-full flex-col items-start gap-2 rounded-2xl border border-slate-200 p-4 text-left transition hover:border-blue-600">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Icon size={20} /></span>
                <span className="text-sm font-semibold text-slate-900">{label(w)}</span>
                <span className="text-xs text-slate-500">{people[w]?.name ?? "—"}{people[w]?.branch ? ` · ${people[w]!.branch!.name}` : ""}</span>
                <span className="text-xs text-slate-500">{WHO[w].does}</span>
                <span className="mt-auto inline-flex items-center gap-1 pt-1 text-xs font-semibold text-blue-700">Open <ArrowRight size={13} /></span>
              </Go>
            );
          })}
        </div>
        {otherReps.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>Testing with several people at once? Each takes a different representative:</span>
            {otherReps.map((u) => (
              <form key={u.id} action={switchPersona}>
                <input type="hidden" name="role" value="sales_rep" />
                <input type="hidden" name="userId" value={u.id} />
                <input type="hidden" name="next" value="/sfa" />
                <button type="submit" className="rounded-lg border border-slate-200 px-2.5 py-1 font-semibold text-slate-700 hover:border-blue-600">{u.name}</button>
              </form>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">The field app is a phone app; on a computer it opens in a phone-sized frame. Its sign-in PIN, if asked, is 1234.</p>

        <h2 className="mt-10 text-base font-semibold text-slate-900">End-to-end scenarios</h2>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          {SCENARIOS.map((sc) => (
            <section key={sc.title} className="rounded-2xl border border-slate-200 p-5">
              <h3 className="text-base font-semibold text-slate-900">{sc.title}</h3>
              <p className="text-sm text-slate-500">{sc.why}</p>
              <ol className="mt-4 space-y-3">
                {sc.steps.map((s, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-700">{s.text}</p>
                      <Go who={s.who} href={s.href} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline">
                        Open as {label(s.who)}{people[s.who] ? ` (${people[s.who]!.name})` : ""} <ArrowRight size={12} />
                      </Go>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
        <p className="mt-8 text-xs text-slate-400">Prototype build with sample data — not for production use. <Link className="underline" href="/admin">Skip to head office</Link></p>
      </div>
    </div>
  );
}
