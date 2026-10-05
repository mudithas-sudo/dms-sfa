import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import OrderCart from "@/components/OrderCart";
import { suggestedOrderQty } from "@/app/actions/sfa-actions";
import { LAST_SYNC_LABEL } from "@/lib/constants";

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ outlet?: string }>;
}) {
  const { branchId } = await getSession();
  const { outlet } = await searchParams;

  const [outlets, products, promos] = await Promise.all([
    branchId ? prisma.outlet.findMany({ where: { branchId, status: "active" }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    prisma.product.findMany({ where: { status: "active" }, orderBy: { category: "asc" } }),
    prisma.promotion.findMany({ where: { status: "active", startDate: { lte: new Date() }, endDate: { gte: new Date() } } }),
  ]);

  const promoLabelByProduct: Record<string, string> = {};
  for (const promo of promos) {
    if (!promo.productId) continue;
    const atQty = promo.minQty ? ` at ${promo.minQty}+` : "";
    promoLabelByProduct[promo.productId] =
      promo.type === "free_good"
        ? `Buy ${promo.minQty ?? 1}, get ${promo.freeQty ?? 1} free`
        : `Promo -${promo.discountValue}%${atQty}`;
  }

  const defaultOutletId = outlet ?? outlets[0]?.id;
  const suggestedQtyByProduct: Record<string, number> = {};
  if (defaultOutletId) {
    await Promise.all(
      products.map(async (p) => {
        suggestedQtyByProduct[p.id] = await suggestedOrderQty(defaultOutletId, p.id);
      }),
    );
  }

  return (
    <div>
      <h2 className="text-base font-semibold text-slate-900">New Order</h2>
      <p className="mb-3 text-xs text-slate-400">
        Catalog, pricing and promotions available offline — {LAST_SYNC_LABEL.toLowerCase()}.
      </p>
      <OrderCart
        outlets={outlets}
        products={products}
        promoLabelByProduct={promoLabelByProduct}
        suggestedQtyByProduct={suggestedQtyByProduct}
        defaultOutletId={outlet}
      />
    </div>
  );
}
