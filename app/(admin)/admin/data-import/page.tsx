import Link from "next/link";
import { prisma } from "@/lib/prisma";
import Banner from "@/components/Banner";
import StatusBadge from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";
import { DATASETS, type Dataset } from "@/lib/import";
import { validateImport } from "@/app/actions/import-actions";

export default async function DataImportPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  const batches = await prisma.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 20, select: { id: true, dataset: true, filename: true, totalRows: true, valid: true, rejected: true, imported: true, status: true, createdBy: true, createdAt: true } });
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Data Import &amp; Migration</h2>
        <p className="mt-1 text-sm text-slate-500">
          Load customers, products and base prices from a CSV file. Every row is checked first — unknown branches or channels, duplicates, bad numbers and missing fields are reported line by line — and nothing is saved until you confirm.
          After the load, a reconciliation compares the file with what is now in the system. Opening stock is loaded separately under Branch → Opening Balance.
        </p>
      </div>
      <Banner error={error} notice={notice} />

      <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">1. Upload and validate</h3>
          <form action={validateImport} className="space-y-3">
            <div>
              <label className="label" htmlFor="dataset">What are you importing?</label>
              <select className="input" id="dataset" name="dataset" defaultValue="customers">
                {(Object.keys(DATASETS) as Dataset[]).map((d) => <option key={d} value={d}>{DATASETS[d].label}</option>)}
              </select>
            </div>
            <div><label className="label" htmlFor="file">CSV file</label><input className="input" id="file" name="file" type="file" accept=".csv,text/csv" required /></div>
            <button className="btn-primary" type="submit">Validate file</button>
          </form>
          <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
            <p className="mb-1 font-medium text-slate-700">Templates</p>
            <ul className="space-y-1">
              {(Object.keys(DATASETS) as Dataset[]).map((d) => (
                <li key={d}><a className="text-blue-600 hover:underline" href={`/api/imports?dataset=${d}`}>{DATASETS[d].label} template (.csv)</a> — {DATASETS[d].help}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="card overflow-x-auto">
          <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Import batches</h3>
          <table className="w-full">
            <thead className="bg-slate-50"><tr><th className="th">When</th><th className="th">File</th><th className="th">Data</th><th className="th text-right">Rows</th><th className="th text-right">Valid</th><th className="th text-right">Rejected</th><th className="th text-right">Loaded</th><th className="th">Status</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {batches.map((b) => (
                <tr key={b.id}>
                  <td className="td text-xs">{formatDateTime(b.createdAt)}<p className="text-slate-400">{b.createdBy}</p></td>
                  <td className="td"><Link className="text-blue-700 hover:underline" href={`/admin/data-import/${b.id}`}>{b.filename}</Link></td>
                  <td className="td text-xs">{DATASETS[b.dataset as Dataset]?.label ?? b.dataset}</td>
                  <td className="td text-right">{b.totalRows}</td><td className="td text-right">{b.valid}</td><td className="td text-right">{b.rejected || "—"}</td><td className="td text-right">{b.status === "imported" ? b.imported : "—"}</td>
                  <td className="td"><StatusBadge status={b.status === "imported" ? "completed" : b.status === "discarded" ? "cancelled" : "pending"} /></td>
                </tr>
              ))}
              {batches.length === 0 && <tr><td className="td text-slate-400" colSpan={8}>No files imported yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
