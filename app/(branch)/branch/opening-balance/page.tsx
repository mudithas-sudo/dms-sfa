import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import StatusBadge from "@/components/StatusBadge";
import { formatDate, formatDateTime } from "@/lib/format";
import { submitOpeningBalance, decideOpeningBalance } from "@/app/actions/inventory-actions";

export default async function OpeningBalancePage({ searchParams }: { searchParams: Promise<{ batch?: string; error?: string; notice?: string }> }) {
  const { branchId } = await getSession();
  const { batch, error, notice } = await searchParams;
  const warehouses = await prisma.warehouse.findMany({ where: branchId ? { branchId, status: "active" } : { status: "active" }, orderBy: { name: "asc" } });
  const batches = await prisma.openingBalanceBatch.findMany({
    where: { warehouseId: { in: warehouses.map((w) => w.id) } },
    orderBy: { createdAt: "desc" },
    include: { lines: { orderBy: { lineNo: "asc" } } },
    take: 10,
  });
  const whName = new Map(warehouses.map((w) => [w.id, w.name]));
  const shown = batch ? batches.find((b) => b.id === batch) : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Opening Stock Balances</h2>
        <p className="mt-1 text-xs text-slate-500">
          Establish each warehouse&apos;s starting position at go-live. Upload or paste lines (SKU, category good|bad, lot, expiry, quantity, unit cost); every line is validated and
          rejected lines are reported so they can be corrected and resubmitted. Posting needs approval by the branch manager (not the uploader); after that the balance is
          <strong> locked</strong> — later changes go through stock adjustments.
        </p>
      </div>
      <Banner error={error} notice={notice} />

      <div className="card max-w-3xl p-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Upload opening balance</h3>
        <form action={submitOpeningBalance} className="space-y-3" encType="multipart/form-data">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="warehouseId">Warehouse</label>
              <select className="input" id="warehouseId" name="warehouseId" required>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="asOfDate">As-of (cut-over) date</label>
              <input className="input" id="asOfDate" name="asOfDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="csv">Lines — <span className="font-mono">SKU, good|bad, lot, expiry (YYYY-MM-DD), qty, unit cost</span></label>
            <textarea className="input font-mono text-xs" id="csv" name="csv" rows={5} placeholder={"SKU-1001, good, LOT-A1, 2027-03-31, 120, 18.50\nSKU-1002, bad, LOT-B7, 2026-12-31, 12, 9.00"} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="file">…or upload a CSV file</label>
              <input className="input" id="file" name="file" type="file" accept=".csv,text/csv,.txt" />
            </div>
            <p className="self-end text-xs text-slate-500">Whole units only; lot and expiry are mandatory for lot-tracked SKUs; quantities of zero or below are rejected.</p>
          </div>
          <button type="submit" className="btn-primary">Validate &amp; submit for approval</button>
        </form>
      </div>

      {shown && (
        <div className="card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">
              Batch result — {whName.get(shown.warehouseId)} <span className="ml-2"><StatusBadge status={shown.status} /></span>
            </h3>
            {shown.status === "pending" && (
              <form action={decideOpeningBalance} className="flex gap-2">
                <input type="hidden" name="id" value={shown.id} />
                <button className="btn-primary px-3 py-1 text-xs" type="submit" name="decision" value="approved">Approve &amp; post</button>
                <button className="btn-danger px-3 py-1 text-xs" type="submit" name="decision" value="rejected">Reject</button>
              </form>
            )}
          </div>
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">#</th>
                <th className="th">SKU</th>
                <th className="th">Category</th>
                <th className="th">Lot</th>
                <th className="th">Expiry</th>
                <th className="th">Qty</th>
                <th className="th">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.lines.map((l) => (
                <tr key={l.id} className={l.result === "error" ? "bg-rose-50/50" : ""}>
                  <td className="td">{l.lineNo}</td>
                  <td className="td font-mono text-xs">{l.sku}</td>
                  <td className="td capitalize">{l.category}</td>
                  <td className="td text-xs">{l.lotNumber ?? "—"}</td>
                  <td className="td text-xs">{l.expiryDate ? formatDate(l.expiryDate) : "—"}</td>
                  <td className="td">{l.qty}</td>
                  <td className="td text-xs">{l.result === "ok" ? <span className="text-emerald-700">Valid</span> : <span className="text-rose-700">{l.message}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Batches</h3>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Uploaded</th>
                <th className="th">Warehouse</th>
                <th className="th">By</th>
                <th className="th">File</th>
                <th className="th">Lines (valid / rejected)</th>
                <th className="th">Status</th>
                <th className="th">Approved by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {batches.map((b) => (
                <tr key={b.id}>
                  <td className="td text-xs">
                    <a className="text-blue-600 hover:underline" href={`/branch/opening-balance?batch=${b.id}`}>{formatDateTime(b.createdAt)}</a>
                  </td>
                  <td className="td">{whName.get(b.warehouseId)}</td>
                  <td className="td">{b.uploadedBy}</td>
                  <td className="td text-xs">{b.filename ?? "typed lines"}</td>
                  <td className="td">{b.lines.filter((l) => l.result === "ok").length} / {b.lines.filter((l) => l.result === "error").length}</td>
                  <td className="td"><StatusBadge status={b.status} /></td>
                  <td className="td text-xs">{b.approvedBy ?? "—"}</td>
                </tr>
              ))}
              {batches.length === 0 && (
                <tr>
                  <td className="td text-slate-400" colSpan={7}>No opening-balance batches yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
