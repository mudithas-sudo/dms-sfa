import Link from "next/link";
import type { Product } from "@prisma/client";

// ERP-owned fields are read-only once the product exists; only local details can be edited.
export default function ProductForm({
  action,
  product,
  submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  product?: Product;
  submitLabel: string;
}) {
  const erpLocked = !!product;
  return (
    <form action={action} className="space-y-5">
      {product && <input type="hidden" name="id" value={product.id} />}

      <fieldset className="space-y-3">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Core definition {erpLocked ? "— received from the ERP (read-only)" : "— as received from the ERP"}
        </legend>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="sku">SKU code</label>
            <input className="input" id="sku" name="sku" defaultValue={product?.sku} required readOnly={erpLocked} />
          </div>
          <div>
            <label className="label" htmlFor="name">Product name</label>
            <input className="input" id="name" name="name" defaultValue={product?.name} required readOnly={erpLocked} />
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className="label" htmlFor="brand">Brand</label>
            <input className="input" id="brand" name="brand" defaultValue={product?.brand ?? ""} readOnly={erpLocked} />
          </div>
          <div>
            <label className="label" htmlFor="category">Category</label>
            <input className="input" id="category" name="category" defaultValue={product?.category} required readOnly={erpLocked} />
          </div>
          <div>
            <label className="label" htmlFor="uom">Base unit</label>
            <input className="input" id="uom" name="uom" defaultValue={product?.uom ?? "PC"} readOnly={erpLocked} />
          </div>
          <div>
            <label className="label" htmlFor="packSize">Pack size</label>
            <input className="input" id="packSize" name="packSize" defaultValue={product?.packSize ?? ""} readOnly={erpLocked} />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Local distribution details (editable in the DMS)</legend>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label" htmlFor="shortName">Short name (SFA screen)</label>
            <input className="input" id="shortName" name="shortName" defaultValue={product?.shortName ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="sellingUnits">Selling units</label>
            <input className="input" id="sellingUnits" name="sellingUnits" defaultValue={product?.sellingUnits ?? "PC,CS"} placeholder="PC,PK,CS" />
          </div>
          <div>
            <label className="label" htmlFor="unitsPerPack">Base units per pack / case</label>
            <input className="input" id="unitsPerPack" name="unitsPerPack" type="number" min={1} defaultValue={product?.unitsPerPack ?? 1} />
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className="label" htmlFor="unitPrice">Base price (₱)</label>
            <input className="input" id="unitPrice" name="unitPrice" type="number" step="0.01" defaultValue={product?.unitPrice ?? 0} />
          </div>
          <div>
            <label className="label" htmlFor="packMultiple">Order in multiples of</label>
            <input className="input" id="packMultiple" name="packMultiple" type="number" min={1} defaultValue={product?.packMultiple ?? 1} />
          </div>
          <div>
            <label className="label" htmlFor="minOrderQty">Minimum order qty</label>
            <input className="input" id="minOrderQty" name="minOrderQty" type="number" min={1} defaultValue={product?.minOrderQty ?? 1} />
          </div>
          <div>
            <label className="label" htmlFor="shelfLifeDays">Shelf life (days)</label>
            <input className="input" id="shelfLifeDays" name="shelfLifeDays" type="number" defaultValue={product?.shelfLifeDays ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="displayOrder">Display order</label>
            <input className="input" id="displayOrder" name="displayOrder" type="number" defaultValue={product?.displayOrder ?? ""} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="hasExpiry" defaultChecked={product?.hasExpiry ?? true} />
          Lot / batch and expiry tracking (batch + expiry mandatory at receiving, FEFO allocation)
        </label>
        {product && (
          <div className="max-w-xs">
            <label className="label" htmlFor="status">Status</label>
            <select className="input" id="status" name="status" defaultValue={product.status}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="discontinued">Discontinued</option>
            </select>
            <p className="mt-1 text-xs text-slate-500">Only Active products can be ordered. Discontinued products drop off the SFA catalog at the next sync.</p>
          </div>
        )}
      </fieldset>

      <div className="flex gap-2 pt-1">
        <button type="submit" className="btn-primary">{submitLabel}</button>
        <Link href="/admin/products" className="btn-secondary">Cancel</Link>
      </div>
    </form>
  );
}
