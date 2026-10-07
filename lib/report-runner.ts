import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { can } from "@/lib/rbac";
import { REPORTS, reportById, type Filters, type ReportDef, type ReportResult, type Scope, type Cell, type Column } from "@/lib/reports";

// Resolves who is running a report and which branches that person may read.
export async function currentScope(): Promise<Scope & { userId: string | null }> {
  const { role, branchId, userId } = await getSession();
  const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
  let branchIds: string[] | null = null;
  if (role !== "admin" && role !== "management" && branchId) {
    branchIds = [branchId, ...(user?.branchScope ? user.branchScope.split(",").filter(Boolean) : [])];
  }
  return { branchIds, role, userName: user?.name ?? "User", userId };
}

export async function scopeForUser(userId: string): Promise<Scope> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const all = !user || user.role === "admin" || user.role === "management" || !user.branchId;
  return { branchIds: all ? null : [user!.branchId!, ...(user!.branchScope ? user!.branchScope.split(",").filter(Boolean) : [])], role: user?.role ?? "admin", userName: user?.name ?? "System" };
}

// Reports the current role may open — each report is unlocked by the matching module permission.
export async function visibleReports(): Promise<ReportDef[]> {
  const out: ReportDef[] = [];
  for (const r of REPORTS) if (await can("reports", "view") && (await can(r.module, "view"))) out.push(r);
  return out;
}

export function filtersFromParams(def: ReportDef, params: Record<string, string | string[] | undefined>): Filters {
  const f: Filters = {};
  for (const fd of def.filters) {
    const raw = params[fd.key];
    const v = Array.isArray(raw) ? raw.join(",") : raw;
    if (v) f[fd.key] = v;
    else if (fd.default) f[fd.key] = fd.default;
  }
  return f;
}

export async function execute(id: string, filters: Filters, scope: Scope): Promise<{ def: ReportDef; result: ReportResult; ranAt: Date }> {
  const def = reportById(id);
  if (!def) throw new Error("Unknown report");
  const result = await def.run(filters, scope);
  return { def, result, ranAt: new Date() };
}

export function fmtCell(v: Cell | undefined, c: Column): string {
  if (v === null || v === undefined || v === "") return "";
  if (c.type === "money") return `₱${Number(v).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (c.type === "int") return Number(v).toLocaleString("en-PH");
  if (c.type === "pct") return `${v}%`;
  return String(v);
}

export function describeFilters(def: ReportDef, f: Filters, labels: Record<string, Record<string, string>>): string {
  const parts = def.filters
    .filter((fd) => f[fd.key])
    .map((fd) => {
      const raw = f[fd.key];
      const shown = raw.split(",").map((x) => labels[fd.type]?.[x] ?? labels[fd.key]?.[x] ?? x).join(", ");
      return `${fd.label}: ${shown}`;
    });
  return parts.length ? parts.join(" · ") : "No filters (defaults)";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function toCsv(result: ReportResult, header: string[]): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = header.map((h) => q(h));
  lines.push("");
  lines.push(result.columns.map((c) => q(c.label)).join(","));
  for (const r of result.rows) lines.push(result.columns.map((c) => q(r[c.key] === null || r[c.key] === undefined ? "" : String(r[c.key]))).join(","));
  if (result.totals) lines.push(result.columns.map((c) => q(result.totals![c.key] === undefined ? "" : String(result.totals![c.key]))).join(","));
  return lines.join("\r\n");
}

// Excel opens an HTML table saved as .xls, keeping headings, totals and the header block.
export function toExcelHtml(result: ReportResult, title: string, header: string[]): string {
  const head = result.columns.map((c) => `<th style="background:#e2e8f0;border:1px solid #94a3b8">${esc(c.label)}</th>`).join("");
  const body = result.rows.map((r) => `<tr>${result.columns.map((c) => `<td style="border:1px solid #cbd5e1">${esc(fmtCell(r[c.key], c))}</td>`).join("")}</tr>`).join("");
  const tot = result.totals ? `<tr>${result.columns.map((c) => `<td style="font-weight:bold;border:1px solid #94a3b8">${esc(result.totals![c.key] === undefined ? "" : fmtCell(result.totals![c.key], c))}</td>`).join("")}</tr>` : "";
  return `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><title>${esc(title)}</title></head><body><h3>${esc(title)}</h3>${header.map((h) => `<div>${esc(h)}</div>`).join("")}<br/><table border="1"><tr>${head}</tr>${body}${tot}</table></body></html>`;
}

// Formatted, printable page — the browser's "Save as PDF" produces the PDF.
export function toPrintHtml(result: ReportResult, title: string, header: string[]): string {
  const head = result.columns.map((c) => `<th>${esc(c.label)}</th>`).join("");
  const align = (c: Column) => (c.type === "money" || c.type === "int" || c.type === "pct" ? ' class="r"' : "");
  const body = result.rows.map((r) => `<tr>${result.columns.map((c) => `<td${align(c)}>${esc(fmtCell(r[c.key], c))}</td>`).join("")}</tr>`).join("");
  const tot = result.totals ? `<tr class="t">${result.columns.map((c) => `<td${align(c)}>${esc(result.totals![c.key] === undefined ? "" : fmtCell(result.totals![c.key], c))}</td>`).join("")}</tr>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:Arial,sans-serif;font-size:11px;margin:24px;color:#0f172a}h1{font-size:16px;margin:0 0 4px}.h{color:#475569;margin:2px 0}table{border-collapse:collapse;width:100%;margin-top:14px}th,td{border:1px solid #cbd5e1;padding:4px 6px;text-align:left}th{background:#f1f5f9}.r{text-align:right}.t td{font-weight:bold;background:#f8fafc}@media print{.np{display:none}}</style></head><body><div class="np" style="margin-bottom:12px"><button onclick="window.print()">Print / Save as PDF</button></div><h1>${esc(title)}</h1>${header.map((h) => `<div class="h">${esc(h)}</div>`).join("")}<table><tr>${head}</tr>${body}${tot}</table><script>setTimeout(function(){window.print()},400)</script></body></html>`;
}

export async function labelMaps(scope: Scope) {
  const { filterOptions } = await import("@/lib/reports");
  const o = await filterOptions(scope);
  const m = (arr: { value: string; label: string }[]) => Object.fromEntries(arr.map((x) => [x.value, x.label]));
  return { branch: m(o.branch), channel: m(o.channel), route: m(o.route), rep: m(o.rep), product: m(o.product), warehouse: m(o.warehouse), customer: m(o.customer), promotion: m(o.promotion) };
}
