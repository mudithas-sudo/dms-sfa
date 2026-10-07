import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { DATASETS, type Dataset, type RowResult } from "@/lib/import";
import { toCsvText } from "@/lib/csv";

// ?dataset=customers  → the CSV template with one sample row
// ?batch=<id>&part=errors|all → the line-by-line result of a validated / imported batch
export async function GET(req: Request) {
  if (!(await can("master_data", "view"))) return new NextResponse("Not allowed", { status: 403 });
  const url = new URL(req.url);
  const dataset = url.searchParams.get("dataset") as Dataset | null;
  if (dataset && DATASETS[dataset]) {
    const spec = DATASETS[dataset];
    return new NextResponse(toCsvText([spec.columns, ...spec.sample]), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${dataset}-template.csv"` } });
  }
  const id = url.searchParams.get("batch");
  if (id) {
    const batch = await prisma.importBatch.findUnique({ where: { id } });
    if (!batch) return new NextResponse("Not found", { status: 404 });
    const rows = JSON.parse(batch.rows) as RowResult[];
    const part = url.searchParams.get("part") === "all" ? rows : rows.filter((r) => r.outcome !== "valid");
    const csv = toCsvText([["line", "key", "outcome", "message"], ...part.map((r) => [r.line, r.key, r.outcome, r.message])]);
    return new NextResponse(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${batch.dataset}-${url.searchParams.get("part") === "all" ? "reconciliation" : "errors"}.csv"` } });
  }
  return new NextResponse("Specify a dataset or a batch", { status: 400 });
}
