import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import Banner from "@/components/Banner";
import BackendOrderForm from "@/components/BackendOrderForm";

export default async function NewBackendOrderPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { branchId } = await getSession();
  const [outlets, products] = await Promise.all([
    branchId ? prisma.outlet.findMany({ where: { branchId, status: "active", onboardingStatus: "approved" }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    prisma.product.findMany({ where: { status: "active" }, orderBy: [{ displayOrder: "asc" }, { name: "asc" }] }),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Link href="/supervisor/orders" className="hover:underline">Orders</Link>
        <span>/</span>
        <span className="text-slate-900">New backend order</span>
      </div>
      <div>
        <h2 className="text-base font-semibold text-slate-900">New Backend Order</h2>
        <p className="mt-1 text-sm text-slate-500">
          For phone, message or walk-in orders keyed in by branch staff. Prices and promotions are applied automatically with the same rules as the SFA app, and the order goes
          through the same validation engine. Drafts do not reserve stock; a submitted order that passes validation is confirmed and allocated (FEFO) at once.
        </p>
      </div>
      <Banner error={error} />
      {outlets.length === 0 ? (
        <p className="text-sm text-amber-700">No active customers in this branch — pick a branch user from the role switcher.</p>
      ) : (
        <BackendOrderForm
          outlets={outlets.map((o) => ({ id: o.id, name: o.name, code: o.code, address: o.address, paymentTerms: o.paymentTerms }))}
          products={products.map((p) => ({ id: p.id, name: p.name, sku: p.sku, unitPrice: p.unitPrice, category: p.category, minOrderQty: p.minOrderQty }))}
        />
      )}
    </div>
  );
}
