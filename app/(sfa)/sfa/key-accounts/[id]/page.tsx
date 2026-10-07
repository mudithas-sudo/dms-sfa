import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Banner from "@/components/Banner";
import StatusBadge from "@/components/StatusBadge";
import { daysAgo, formatCurrency, formatDate } from "@/lib/format";
import { KA_ACTIVITY_TYPES } from "@/lib/key-accounts";
import { invoiceBalance, outletBalance } from "@/lib/finance";
import { logKeyAccountActivity, completeKeyAccountAction } from "@/app/actions/key-account-actions";

const SALE = ["confirmed", "picked", "invoiced", "delivered", "partially_delivered"];

export default async function KeyAccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { id } = await params;
  const { error, notice } = await searchParams;
  const o = await prisma.outlet.findUnique({ where: { id }, include: { channel: true } });
  if (!o) notFound();
  const since = daysAgo(180);
  const now = new Date();
  const [orders, invoices, acts, users, fixed, tasks, promos, balance, lines] = await Promise.all([
    prisma.salesOrder.findMany({ where: { outletId: id, orderDate: { gte: since }, status: { in: SALE } }, select: { orderDate: true, total: true } }),
    prisma.invoice.findMany({ where: { outletId: id, status: { in: ["unpaid", "partially_paid", "overdue"] } }, include: { arLedgerEntries: true }, orderBy: { dueDate: "asc" } }),
    prisma.keyAccountActivity.findMany({ where: { outletId: id }, orderBy: { createdAt: "desc" }, take: 15 }),
    prisma.user.findMany({ select: { id: true, name: true } }),
    prisma.pricingRule.findMany({ where: { outletId: id, status: "active" }, include: { product: true } }),
    prisma.task.findMany({ where: { outletId: id, status: { in: ["pending", "acknowledged", "in_progress"] } }, orderBy: { dueDate: "asc" } }),
    prisma.promotion.findMany({ where: { status: "active", startDate: { lte: now }, endDate: { gte: now }, OR: [{ channelId: null }, { channelId: o.channelId }] } }),
    outletBalance(id),
    prisma.salesOrderLine.groupBy({ by: ["productId"], where: { salesOrder: { outletId: id, status: { in: SALE }, orderDate: { gte: since } } }, _sum: { qty: true, lineTotal: true }, orderBy: { _sum: { lineTotal: "desc" } }, take: 5 }),
  ]);
  const names = new Map(users.map((u) => [u.id, u.name]));
  const prodNames = new Map((await prisma.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const months: { m: string; v: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push({ m: key, v: orders.filter((x) => x.orderDate.getFullYear() === d.getFullYear() && x.orderDate.getMonth() === d.getMonth()).reduce((s, x) => s + x.total, 0) });
  }
  const max = Math.max(1, ...months.map((x) => x.v));
  const overdue = invoices.map((i) => ({ i, b: invoiceBalance(i) })).filter((x) => x.b > 0 && x.i.dueDate < now);

  return (
    <div className="space-y-4">
      <Link href="/sfa/key-accounts" className="text-sm text-blue-600 hover:underline">← Key accounts</Link>
      <Banner error={error} notice={notice} />
      <div className="card p-4">
        <div className="flex items-start justify-between"><div><h2 className="text-base font-semibold text-slate-900">{o.name}</h2><p className="text-xs text-slate-500">{o.code} · {o.channel.name} · {o.subChannel}</p><p className="text-xs text-slate-500">{o.address}</p></div><StatusBadge status={o.creditStatus} /></div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-slate-50 p-2"><p className="text-[10px] text-slate-500">Credit limit</p><p className="text-xs font-semibold">{formatCurrency(o.creditLimit)}</p></div>
          <div className="rounded-lg bg-slate-50 p-2"><p className="text-[10px] text-slate-500">Owes</p><p className="text-xs font-semibold">{formatCurrency(Math.max(0, balance))}</p></div>
          <div className="rounded-lg bg-slate-50 p-2"><p className="text-[10px] text-slate-500">Overdue</p><p className={`text-xs font-semibold ${overdue.length ? "text-rose-600" : ""}`}>{formatCurrency(overdue.reduce((s, x) => s + x.b, 0))}</p></div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs">
          <Link className="btn-primary" href={`/sfa/order/new?outlet=${o.id}`}>New order</Link>
          <Link className="btn-secondary" href={`/sfa/collections/new?outlet=${o.id}`}>Collect payment</Link>
          <Link className="btn-secondary" href={`/sfa/field-notes/new?outlet=${o.id}`}>Execution check</Link>
          <Link className="btn-secondary" href={`/sfa/outlets/${o.id}/change-request`}>Change request</Link>
        </div>
      </div>

      <div className="card p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Sales, last 6 months</h3>
        <ul className="space-y-1">{months.map((m) => <li key={m.m} className="flex items-center gap-2 text-xs"><span className="w-14 text-slate-500">{m.m}</span><span className="h-2 rounded-full bg-blue-500" style={{ width: `${Math.max(2, (m.v / max) * 60)}%` }} /><span className="text-slate-700">{formatCurrency(m.v)}</span></li>)}</ul>
        {lines.length > 0 && <p className="mt-2 text-[11px] text-slate-500">Top products: {lines.map((l) => `${prodNames.get(l.productId) ?? "?"} (${formatCurrency(l._sum.lineTotal ?? 0)})`).join(", ")}</p>}
      </div>

      <div className="card p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Agreed terms &amp; programmes</h3>
        <ul className="space-y-1 text-xs text-slate-600">
          <li>Payment terms: <strong>{o.paymentTerms.replace("_", " ")}</strong> · credit limit {formatCurrency(o.creditLimit)}</li>
          {fixed.map((f) => <li key={f.id}>{f.kind === "fixed_discount" ? "Standing discount" : "Price rule"}: {f.name} — {f.priceType === "fixed_price" ? formatCurrency(f.value) : `${f.value}%`}{f.product ? ` on ${f.product.name}` : ""} ({f.approvalStatus.replace("_", " ")}, from {formatDate(f.startDate)})</li>)}
          {promos.slice(0, 5).map((p) => <li key={p.id}>Promotion available: {p.name}</li>)}
          {fixed.length === 0 && promos.length === 0 && <li className="text-slate-400">No special terms on record.</li>}
        </ul>
      </div>

      {tasks.length > 0 && <div className="card p-4 text-xs"><h3 className="mb-1 text-sm font-semibold text-slate-900">Open tasks at this account</h3>{tasks.map((t) => <p key={t.id} className="text-slate-600">{t.title}{t.dueDate ? ` — due ${formatDate(t.dueDate)}` : ""}</p>)}</div>}

      <div className="card p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Log an activity</h3>
        <form action={logKeyAccountActivity} className="space-y-2">
          <input type="hidden" name="outletId" value={o.id} />
          <select className="input" name="type" defaultValue="business_review">{Object.entries(KA_ACTIVITY_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <textarea className="input" name="summary" rows={2} placeholder="What was discussed or done *" required />
          <input className="input" name="outcome" placeholder="Outcome / agreement (optional)" />
          <div className="grid grid-cols-[1fr_130px] gap-2"><input className="input" name="nextAction" placeholder="Next action (optional)" /><input className="input" type="date" name="nextDue" /></div>
          <button className="btn-primary w-full" type="submit">Save activity</button>
        </form>
      </div>

      <div className="card p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Activity history</h3>
        <ul className="divide-y divide-slate-100">
          {acts.map((a) => (
            <li key={a.id} className="py-2 text-xs">
              <p className="font-medium text-slate-900">{KA_ACTIVITY_TYPES[a.type] ?? a.type} <span className="font-normal text-slate-400">· {names.get(a.userId)} · {formatDate(a.createdAt)}</span></p>
              <p className="text-slate-600">{a.summary}{a.outcome ? ` → ${a.outcome}` : ""}</p>
              {a.nextAction && (
                <p className={a.status === "done" ? "text-slate-400 line-through" : a.nextDue && a.nextDue < now ? "text-rose-600" : "text-amber-700"}>
                  Next: {a.nextAction}{a.nextDue ? ` (${formatDate(a.nextDue)})` : ""}
                  {a.status === "open" && <form action={completeKeyAccountAction} className="ml-2 inline"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="back" value={`/sfa/key-accounts/${o.id}`} /><button className="text-blue-600 underline" type="submit">Mark done</button></form>}
                </p>
              )}
            </li>
          ))}
          {acts.length === 0 && <p className="py-2 text-slate-400">No activity logged yet.</p>}
        </ul>
      </div>
    </div>
  );
}
