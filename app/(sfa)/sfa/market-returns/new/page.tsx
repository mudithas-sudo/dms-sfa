import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import PhotoCapture from "@/components/PhotoCapture";
import ReturnSignature from "@/components/ReturnSignature";
import { submitMarketReturn } from "@/app/actions/sfa-returns-actions";
import { RETURN_REASON_LABELS } from "@/lib/field-constants";
import { getAllSettings, num } from "@/lib/settings";
import { daysAgo, formatDate } from "@/lib/format";

export default async function NewMarketReturnPage({ searchParams }: { searchParams: Promise<{ outlet?: string; error?: string }> }) {
  const { branchId } = await getSession();
  const { outlet, error } = await searchParams;
  const s = await getAllSettings();
  const outlets = branchId ? await prisma.outlet.findMany({ where: { branchId, status: "active" }, orderBy: { name: "asc" } }) : [];
  const outletId = outlet ?? outlets[0]?.id;
  const invoices = outletId
    ? await prisma.invoice.findMany({ where: { outletId, status: { not: "voided" }, invoiceDate: { gte: daysAgo(90) } }, include: { lines: { include: { product: true } } }, orderBy: { invoiceDate: "desc" }, take: 8 })
    : [];
  const products = await prisma.product.findMany({ where: { status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true } });

  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold text-slate-900">Market Return</h2>
      <Banner error={error} />
      <form method="get" className="card flex items-end gap-2 p-3">
        <div className="flex-1">
          <label className="label" htmlFor="outlet">Customer</label>
          <select className="input" id="outlet" name="outlet" defaultValue={outletId}>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        </div>
        <button className="btn-secondary" type="submit">Load invoices</button>
      </form>
      <form action={submitMarketReturn} className="card space-y-3 p-4" key={outletId}>
        <input type="hidden" name="outletId" value={outletId} />
        <div>
          <label className="label" htmlFor="line">Returned item (from an invoice)</label>
          <select className="input" id="line" name="line" defaultValue="">
            <option value="">No invoice reference (outside policy)</option>
            {invoices.map((i) => i.lines.map((l) => <option key={`${i.id}:${l.productId}`} value={`${i.id}:${l.productId}`}>{i.invoiceNumber} · {formatDate(i.invoiceDate)} · {l.product.name} (invoiced {l.qty})</option>))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="productId">…or choose the product (when there is no invoice)</label>
          <select className="input" id="productId" name="productId" defaultValue=""><option value="">—</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label" htmlFor="qty">Quantity</label><input className="input" id="qty" name="qty" type="number" min={1} required /></div>
          <div><label className="label" htmlFor="lotNumber">Lot (if known)</label><input className="input" id="lotNumber" name="lotNumber" /></div>
        </div>
        <div>
          <label className="label" htmlFor="reason">Reason *</label>
          <select className="input" id="reason" name="reason" required defaultValue="">
            <option value="" disabled>— choose —</option>
            {Object.entries(RETURN_REASON_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <PhotoCapture max={2} label="Photo of the goods" />
        <p className="text-[10px] text-slate-400">A photo is mandatory for damaged and quality-complaint returns.</p>
        <ReturnSignature />
        <p className="text-[11px] text-slate-500">Returns are accepted within {num(s, "return.periodDays")} days of the invoice. Later returns, or ones without an invoice, go to your supervisor as an exception. A credit note is issued once the return is approved.</p>
        <button type="submit" className="btn-primary w-full">Submit return</button>
      </form>
    </div>
  );
}
