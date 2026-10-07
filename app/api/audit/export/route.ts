import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { getSession } from "@/lib/session";
import { logAudit, verifyAuditChain } from "@/lib/audit";
import { currentScope } from "@/lib/report-runner";

// Audit trail export: same filters as the screen, branch-scoped for branch users, logged like any other export,
// with the chain-verification result in the header so an auditor knows the file is complete and untampered.
export async function GET(req: Request) {
  const { role } = await getSession();
  if (!["admin", "supervisor", "management"].includes(role) || !(await can("export", "edit"))) return new NextResponse("Audit export is not enabled for your role.", { status: 403 });
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity") || undefined;
  const userId = url.searchParams.get("userId") || undefined;
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const format = url.searchParams.get("format") ?? "csv";
  const scope = await currentScope();

  const logs = await prisma.auditLog.findMany({
    where: {
      ...(entity ? { entity } : {}), ...(userId ? { userId } : {}),
      ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59`) } : {}) } } : {}),
    },
    orderBy: { seq: "asc" },
    include: { user: true },
    take: 20000,
  });
  const chain = await verifyAuditChain();
  const header = [
    "Audit trail export",
    `Filters: entity=${entity ?? "all"} user=${userId ?? "all"} from=${from ?? "-"} to=${to ?? "-"}`,
    `Scope: ${scope.branchIds ? "own branch" : "all branches"} · exported by ${scope.userName} at ${new Date().toISOString()}`,
    `Chain verification: ${chain.ok ? "OK" : "PROBLEMS FOUND"} (${chain.checked} chained entries, ${chain.legacy} legacy)`,
  ];
  const cols = ["seq", "when", "user", "role", "entity", "entity id", "action", "summary", "before", "after", "hash"];
  const rows = logs.map((l) => [l.seq, l.createdAt.toISOString(), l.user?.name ?? "", l.role ?? "", l.entity, l.entityId, l.action, l.summary, l.beforeData ?? "", l.afterData ?? "", l.hash ?? ""]);
  await prisma.exportLog.create({ data: { userId: scope.userId ?? scope.userName, report: "Audit trail", filters: JSON.stringify({ entity, userId, from, to }), format, rowCount: rows.length } });
  await logAudit("Report", "audit-trail", "export", `Exported the audit trail as ${format.toUpperCase()} — ${rows.length} entries`, { after: { entity, userId, from, to } });

  const q = (v: unknown) => {
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  if (format === "excel") {
    const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = `<html><head><meta charset="utf-8"></head><body>${header.map((h) => `<div>${esc(h)}</div>`).join("")}<br/><table border="1"><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table></body></html>`;
    return new NextResponse(html, { headers: { "content-type": "application/vnd.ms-excel; charset=utf-8", "content-disposition": 'attachment; filename="audit-trail.xls"' } });
  }
  const csv = [...header.map(q), "", cols.map(q).join(","), ...rows.map((r) => r.map(q).join(","))].join("\r\n");
  return new NextResponse("﻿" + csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="audit-trail.csv"' } });
}
