import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { recordCollection } from "@/app/actions/sfa-actions";
import { formatCurrency } from "@/lib/format";

export default async function NewCollectionPage({
  searchParams,
}: {
  searchParams: Promise<{ outlet?: string }>;
}) {
  const { branchId } = await getSession();
  const { outlet: outletIdParam } = await searchParams;

  const outlets = branchId
    ? await prisma.outlet.findMany({ where: { branchId, status: "active" }, orderBy: { name: "asc" } })
    : [];
  const selectedOutletId = outletIdParam ?? outlets[0]?.id;

  let outstanding = 0;
  if (selectedOutletId) {
    const invoices = await prisma.invoice.findMany({
      where: { outletId: selectedOutletId, status: { in: ["unpaid", "partially_paid", "overdue"] } },
      include: { arLedgerEntries: true },
    });
    outstanding = invoices.reduce((sum, inv) => {
      const paid = inv.arLedgerEntries.filter((e) => e.type === "payment").reduce((s, e) => s + e.amount, 0);
      return sum + (inv.amount - paid);
    }, 0);
  }

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">Collect Payment</h2>
      <form action={recordCollection} className="card space-y-4 p-4">
        <div>
          <label className="label" htmlFor="outletId">Outlet</label>
          <select className="input" id="outletId" name="outletId" defaultValue={selectedOutletId}>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          Outstanding Balance: <span className="font-semibold">{formatCurrency(outstanding)}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="method">Payment Method</label>
            <select className="input" id="method" name="method" defaultValue="cash">
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="amount">Amount (₱)</label>
            <input className="input" id="amount" name="amount" type="number" step="0.01" min={1} required />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="reference">Reference / OR Number</label>
          <input className="input" id="reference" name="reference" placeholder="Optional" />
        </div>
        <button type="submit" className="btn-primary w-full">Record Payment</button>
      </form>
    </div>
  );
}
