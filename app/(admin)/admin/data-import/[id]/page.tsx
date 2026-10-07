import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Banner from "@/components/Banner";
import StatusBadge from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";
import { DATASETS, reconcile, type Dataset, type RowResult } from "@/lib/import";
import { confirmImport, discardImport } from "@/app/actions/import-actions";

export default async function ImportBatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ show?: string; error?: string; notice?: string }> }) {
  const { id } = await params;
  const { show = "problems", error, notice } = await searchParams;
  const batch = await prisma.importBatch.findUnique({ where: { id } });
  if (!batch) notFound();
  const rows = JSON.parse(batch.rows) as RowResult[];
  const dataset = batch.dataset as Dataset;
  const rec = batch.status === "imported" ? await reconcile(dataset, rows) : null;
  const shown = rows.filter((r) => (show === "all" ? true : show === "valid" ? r.outcome === "valid" : r.outcome !== "valid"));
  const dups = rows.filter((r) => r.outcome === "duplicate").length;
  const bad = rows.filter((r) => r.outcome === "rejected").length;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm text-slate-500"><Link href="/admin/data-import" className="hover:underline">Data import</Link><span>/</span><span className="text-slate-900">{batch.filename}</span></div>
      <Banner error={error} notice={notice} />
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{DATASETS[dataset]?.label} — {batch.filename}</h2>
            <p className="text-xs text-slate-500">Validated {formatDateTime(batch.createdAt)} by {batch.createdBy}{batch.importedAt ? ` · loaded ${formatDateTime(batch.importedAt)}` : ""}</p>
          </div>
          <StatusBadge status={batch.status === "imported" ? "completed" : batch.status === "discarded" ? "cancelled" : "pending"} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div><p className="text-xs text-slate-500">Rows in file</p><p className="text-lg font-semibold text-slate-900">{batch.totalRows}</p></div>
          <div><p className="text-xs text-slate-500">Valid</p><p className="text-lg font-semibold text-emerald-600">{rows.filter((r) => r.outcome === "valid").length}</p></div>
          <div><p className="text-xs text-slate-500">Duplicates</p><p className="text-lg font-semibold text-amber-600">{dups}</p></div>
          <div><p className="text-xs text-slate-500">Rejected</p><p className="text-lg font-semibold text-rose-600">{bad}</p></div>
          <div><p className="text-xs text-slate-500">Loaded</p><p className="text-lg font-semibold text-slate-900">{batch.status === "imported" ? batch.imported : "—"}</p></div>
        </div>
        {batch.status === "validated" && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <form action={confirmImport}><input type="hidden" name="id" value={batch.id} /><button className="btn-primary" type="submit" disabled={batch.valid === 0}>Import the {batch.valid} valid row(s)</button></form>
            <form action={discardImport}><input type="hidden" name="id" value={batch.id} /><button className="btn-secondary" type="submit">Discard this batch</button></form>
            <p className="text-xs text-slate-500">Rejected and duplicate rows are skipped. Fix them in the file and upload it again.</p>
          </div>
        )}
      </div>

      {rec && (
        <div className={`card p-5 ${rec.expected === rec.present && batch.rejected === 0 ? "border-emerald-200" : "border-amber-200"}`}>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Reconciliation</h3>
          <table className="w-full max-w-lg text-sm">
            <tbody className="divide-y divide-slate-100">
              <tr><td className="py-1 text-slate-600">Rows in the source file</td><td className="py-1 text-right font-medium">{batch.totalRows}</td></tr>
              <tr><td className="py-1 text-slate-600">− rejected (errors) and duplicates, not loaded</td><td className="py-1 text-right font-medium">{batch.rejected}</td></tr>
              <tr><td className="py-1 text-slate-600">= rows loaded</td><td className="py-1 text-right font-medium">{batch.imported}</td></tr>
              <tr><td className="py-1 text-slate-600">Loaded rows found in the system now</td><td className="py-1 text-right font-medium">{rec.present} of {rec.expected}</td></tr>
              <tr><td className="py-1 text-slate-600">File rows accounted for</td><td className={`py-1 text-right font-semibold ${batch.imported + batch.rejected === batch.totalRows ? "text-emerald-600" : "text-rose-600"}`}>{batch.imported + batch.rejected} of {batch.totalRows} {batch.imported + batch.rejected === batch.totalRows ? "✓ reconciled" : "— difference"}</td></tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500"><a className="text-blue-600 underline" href={`/api/imports?batch=${batch.id}&part=all`}>Download the full line-by-line reconciliation</a> · <a className="text-blue-600 underline" href={`/api/imports?batch=${batch.id}&part=errors`}>Download the rejected rows only</a></p>
        </div>
      )}

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          {[["problems", "Problems"], ["valid", "Valid"], ["all", "All"]].map(([k, l]) => <Link key={k} href={`/admin/data-import/${batch.id}?show=${k}`} className={`rounded-full px-3 py-1 ${show === k ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>{l}</Link>)}
          <a className="ml-auto text-blue-600 underline" href={`/api/imports?batch=${batch.id}&part=errors`}>Download problems (.csv)</a>
        </div>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Line</th><th className="th">Record</th><th className="th">Result</th><th className="th">Detail</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {shown.slice(0, 300).map((r) => (
                <tr key={r.line}><td className="td text-xs">{r.line}</td><td className="td font-medium text-slate-900">{r.key}</td><td className="td"><StatusBadge status={r.outcome === "valid" ? "completed" : r.outcome === "duplicate" ? "pending" : "failed"} /></td><td className="td text-xs text-slate-600">{r.message}</td></tr>
              ))}
              {shown.length === 0 && <tr><td className="td text-slate-400" colSpan={4}>Nothing to show in this view.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
