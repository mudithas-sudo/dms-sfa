import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import FieldOrderForm from "@/components/FieldOrderForm";
import { promoSummary } from "@/lib/promotions";

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ outlet?: string; draft?: string }> }) {
  const { branchId, userId } = await getSession();
  const { outlet, draft } = await searchParams;
  const now = new Date();

  const [outlets, products, promos, draftOrder] = await Promise.all([
    branchId ? prisma.outlet.findMany({ where: { branchId, status: "active", onboardingStatus: "approved" }, orderBy: { name: "asc" }, select: { id: true, name: true, channelId: true } }) : Promise.resolve([]),
    prisma.product.findMany({ where: { status: "active" }, orderBy: [{ category: "asc" }, { name: "asc" }], select: { id: true, name: true, sku: true, brand: true, category: true, unitPrice: true, unitsPerPack: true, packMultiple: true, minOrderQty: true } }),
    prisma.promotion.findMany({ where: { status: "active", startDate: { lte: now }, endDate: { gte: now } } }),
    draft ? prisma.salesOrder.findFirst({ where: { id: draft, status: "draft", salespersonId: userId ?? "" }, include: { lines: true } }) : null,
  ]);

  // An offer is shown only to customers it applies to, so each label carries the channel it is limited to (if any).
  const labels: Record<string, { text: string; channelId: string | null }[]> = {};
  const add = (productId: string, text: string, channelId: string | null) => (labels[productId] ??= []).push({ text, channelId });
  const pname = (id: string) => products.find((p) => p.id === id)?.name ?? "";
  for (const p of promos) {
    const text = promoSummary(p, pname);
    if (p.productId) add(p.productId, text, p.channelId);
    else if (p.type === "bundle") for (const i of (JSON.parse(p.config ?? "{}") as { items?: { productId: string }[] }).items ?? []) add(i.productId, `${p.name}: ${text}`, p.channelId);
    else if (p.type === "qty_slab" || p.type === "volume_discount") products.forEach((x) => add(x.id, text, p.channelId));
  }

  return (
    <div>
      <h2 className="text-base font-semibold text-slate-900">{draftOrder ? `Amend draft ${draftOrder.orderNumber}` : "New Order"}</h2>
      <p className="mb-3 text-xs text-slate-400">Prices, promotions and stock come from the same engine the branch uses — what you see here is what is invoiced.</p>
      <FieldOrderForm
        outlets={outlets}
        products={products}
        promoLabels={labels}
        defaultOutletId={outlet}
        draft={draftOrder ? { id: draftOrder.id, outletId: draftOrder.outletId, orderType: draftOrder.orderType, items: draftOrder.lines.map((l) => ({ productId: l.productId, qty: l.qty })), remarks: draftOrder.remarks, clientRef: draftOrder.clientRef } : null}
      />
    </div>
  );
}
