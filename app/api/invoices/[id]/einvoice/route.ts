import { NextResponse } from "next/server";
import { can } from "@/lib/rbac";
import { buildEInvoice, toXml } from "@/lib/einvoice";
import { logAudit } from "@/lib/audit";

// Download the electronic invoice document (JSON or XML) for one invoice.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await can("finance", "view"))) return new NextResponse("You do not have access to e-invoices.", { status: 403 });
  const { id } = await ctx.params;
  const e = await buildEInvoice(id);
  if (!e) return new NextResponse("Invoice not found", { status: 404 });
  const format = new URL(req.url).searchParams.get("format") ?? "json";
  await logAudit("Invoice", id, "einvoice_download", `Downloaded the e-invoice ${e.invoiceNumber} as ${format.toUpperCase()}`);
  if (format === "xml") return new NextResponse(toXml(e), { headers: { "content-type": "application/xml; charset=utf-8", "content-disposition": `attachment; filename="${e.invoiceNumber}.xml"` } });
  return new NextResponse(JSON.stringify(e, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${e.invoiceNumber}.json"` } });
}
