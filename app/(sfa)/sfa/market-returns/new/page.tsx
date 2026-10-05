import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { captureMarketReturn } from "@/app/actions/sfa-actions";
import { Camera } from "lucide-react";

export default async function NewMarketReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ outlet?: string }>;
}) {
  const { branchId } = await getSession();
  const { outlet } = await searchParams;

  const [outlets, products] = await Promise.all([
    branchId ? prisma.outlet.findMany({ where: { branchId, status: "active" }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    prisma.product.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">Market Return</h2>
      <form action={captureMarketReturn} className="card space-y-4 p-4">
        <div>
          <label className="label" htmlFor="outletId">Outlet</label>
          <select className="input" id="outletId" name="outletId" defaultValue={outlet} required>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="productId">Product</label>
            <select className="input" id="productId" name="productId" required>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="qty">Quantity</label>
            <input className="input" id="qty" name="qty" type="number" min={1} required />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="reason">Reason</label>
          <input className="input" id="reason" name="reason" placeholder="e.g. Damaged, near-expiry, wrong item" required />
        </div>
        <button type="button" className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 py-6 text-sm text-slate-400">
          <Camera size={18} /> Tap to attach photo (placeholder)
        </button>
        <p className="text-xs text-slate-500">Your supervisor will review this and issue a credit note if approved.</p>
        <button type="submit" className="btn-primary w-full">Submit Return</button>
      </form>
    </div>
  );
}
