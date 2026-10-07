import { NextResponse } from "next/server";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { reportById } from "@/lib/reports";
import { currentScope, describeFilters, execute, filtersFromParams, labelMaps, toCsv, toExcelHtml, toPrintHtml } from "@/lib/report-runner";

// One export function for every report: same header block, same formats, logged with user, filters and row count.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const def = reportById(id);
  if (!def) return new NextResponse("Unknown report", { status: 404 });
  if (!(await can("reports", "view")) || !(await can(def.module, "view"))) return new NextResponse("You do not have access to this report.", { status: 403 });
  if (!(await can("export", "edit"))) return new NextResponse("Export is not enabled for your role.", { status: 403 });

  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "csv";
  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => (params[k] = v));
  const scope = await currentScope();
  const filters = filtersFromParams(def, params);
  const { result, ranAt } = await execute(def.id, filters, scope);
  const labels = await labelMaps(scope);
  const header = [
    `Report: ${def.title}`,
    `Filters: ${describeFilters(def, filters, labels)}`,
    `Branch scope: ${scope.branchIds ? scope.branchIds.map((b) => labels.branch[b] ?? b).join(", ") : filters.branch ? filters.branch.split(",").map((b) => labels.branch[b] ?? b).join(", ") : "All branches"}`,
    `Run: ${ranAt.toISOString().replace("T", " ").slice(0, 16)} UTC by ${scope.userName}`,
  ];

  await prisma.exportLog.create({ data: { userId: scope.userId ?? scope.userName, report: def.title, filters: JSON.stringify(filters), format, rowCount: result.rows.length } });
  await logAudit("Report", def.id, "export", `Exported "${def.title}" as ${format.toUpperCase()} — ${result.rows.length} rows`, { after: { filters, format, rows: result.rows.length } });

  const file = def.id + "-" + ranAt.toISOString().slice(0, 10);
  if (format === "excel") {
    return new NextResponse(toExcelHtml(result, def.title, header), { headers: { "content-type": "application/vnd.ms-excel; charset=utf-8", "content-disposition": `attachment; filename="${file}.xls"` } });
  }
  if (format === "pdf") {
    return new NextResponse(toPrintHtml(result, def.title, header), { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  return new NextResponse("\ufeff" + toCsv(result, header), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${file}.csv"` } });
}
