import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import CsvExportButton from "@/components/CsvExportButton";
import PrintButton from "@/components/PrintButton";
import { formatCurrency, formatDate } from "@/lib/format";

export default async function BranchDrilldownPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ repId?: string; routeId?: string; outletId?: string; from?: string; to?: string }>;
}) {
  const { id } = await params;
  const { repId, routeId, outletId, from, to } = await searchParams;
  const branch = await prisma.branch.findUnique({ where: { id } });
  if (!branch) notFound();

  const [reps, routes, branchOutlets] = await Promise.all([
    prisma.user.findMany({ where: { branchId: id, role: "sales_rep" }, orderBy: { name: "asc" } }),
    prisma.route.findMany({ where: { reps: { some: { branchId: id } } }, orderBy: { name: "asc" } }),
    prisma.outlet.findMany({ where: { branchId: id }, orderBy: { name: "asc" } }),
  ]);

  const orderWhere = {
    branchId: id,
    ...(repId ? { salespersonId: repId } : {}),
    ...(routeId ? { outlet: { routeId } } : {}),
    ...(outletId ? { outletId } : {}),
    ...(from || to
      ? {
          orderDate: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {}),
  };

  const [orders, invoices, claims] = await Promise.all([
    prisma.salesOrder.findMany({ where: orderWhere, orderBy: { orderDate: "desc" }, take: 40, include: { outlet: true, salesperson: true } }),
    prisma.invoice.findMany({ where: { branchId: id }, orderBy: { invoiceDate: "desc" }, take: 20, include: { outlet: true } }),
    prisma.claim.findMany({ where: { submittedBy: { branchId: id } }, orderBy: { submittedAt: "desc" }, take: 10, include: { promotion: true } }),
  ]);

  const orderRows = orders.map((o) => ({
    "Order #": o.orderNumber,
    Outlet: o.outlet.name,
    Rep: o.salesperson.name,
    Date: formatDate(o.orderDate),
    Total: o.total,
    Status: o.status,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Link href="/management" className="hover:underline">Cross-Branch Dashboard</Link>
          <span>/</span>
          <span className="text-slate-900">{branch.name}</span>
        </div>
        <div className="no-print flex gap-2">
          <CsvExportButton filename={`${branch.name}-orders`} rows={orderRows} />
          <PrintButton />
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold text-slate-900">Recent Sales Orders</h2>
        <form className="no-print card mb-3 flex flex-wrap items-end gap-3 p-4" method="get">
          <div>
            <label className="label" htmlFor="repId">Salesperson</label>
            <select className="input py-1.5 text-sm" id="repId" name="repId" defaultValue={repId ?? ""}>
              <option value="">All</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="routeId">Route</label>
            <select className="input py-1.5 text-sm" id="routeId" name="routeId" defaultValue={routeId ?? ""}>
              <option value="">All</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="outletId">Customer</label>
            <select className="input py-1.5 text-sm" id="outletId" name="outletId" defaultValue={outletId ?? ""}>
              <option value="">All</option>
              {branchOutlets.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="from">From</label>
            <input className="input py-1.5 text-sm" id="from" name="from" type="date" defaultValue={from ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="to">To</label>
            <input className="input py-1.5 text-sm" id="to" name="to" type="date" defaultValue={to ?? ""} />
          </div>
          <button type="submit" className="btn-secondary">Filter</button>
        </form>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Order #</th>
                <th className="th">Outlet</th>
                <th className="th">Rep</th>
                <th className="th">Date</th>
                <th className="th">Total</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="td font-medium text-slate-900">{o.orderNumber}</td>
                  <td className="td">{o.outlet.name}</td>
                  <td className="td">{o.salesperson.name}</td>
                  <td className="td">{formatDate(o.orderDate)}</td>
                  <td className="td">{formatCurrency(o.total)}</td>
                  <td className="td"><StatusBadge status={o.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold text-slate-900">Recent Invoices</h2>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Invoice #</th>
                <th className="th">Outlet</th>
                <th className="th">Date</th>
                <th className="th">Amount</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td className="td font-medium text-slate-900">{i.invoiceNumber}</td>
                  <td className="td">{i.outlet.name}</td>
                  <td className="td">{formatDate(i.invoiceDate)}</td>
                  <td className="td">{formatCurrency(i.amount)}</td>
                  <td className="td"><StatusBadge status={i.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold text-slate-900">Claims</h2>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Claim #</th>
                <th className="th">Promotion</th>
                <th className="th">Amount</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {claims.map((c) => (
                <tr key={c.id}>
                  <td className="td font-medium text-slate-900">{c.claimNumber}</td>
                  <td className="td">{c.promotion.name}</td>
                  <td className="td">{formatCurrency(c.amount)}</td>
                  <td className="td"><StatusBadge status={c.status} /></td>
                </tr>
              ))}
              {claims.length === 0 && <tr><td className="td text-slate-400" colSpan={4}>No claims for this branch.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
