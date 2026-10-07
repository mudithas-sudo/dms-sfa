import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import Banner from "@/components/Banner";
import { createWarehouse, updateWarehouse, createVan, updateVan } from "@/app/actions/admin-actions";

const TYPE_LABEL: Record<string, string> = { saleable: "Saleable", damaged: "Damaged", quarantine: "Quarantine" };

export default async function WarehousesVansPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  const [warehouses, vans, branches, reps, balances] = await Promise.all([
    prisma.warehouse.findMany({ orderBy: { name: "asc" }, include: { branch: true } }),
    prisma.van.findMany({ orderBy: { code: "asc" }, include: { branch: true, assignedUser: true } }),
    prisma.branch.findMany({ orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { role: "sales_rep" }, orderBy: { name: "asc" } }),
    prisma.stockBalance.groupBy({ by: ["warehouseId", "vanId"], _sum: { qtyGood: true, qtyDamaged: true, qtyQuarantine: true } }),
  ]);
  const unitsOf = (key: "warehouseId" | "vanId", id: string) => {
    const r = balances.find((b) => b[key] === id);
    return (r?._sum.qtyGood ?? 0) + (r?._sum.qtyDamaged ?? 0) + (r?._sum.qtyQuarantine ?? 0);
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Warehouse & Van Master</h2>
        <p className="mt-1 text-sm text-slate-500">
          Every branch warehouse and every van is a distinct stock location with its own code, balance and movement history. A location can be deactivated
          only when its stock balance is zero, and a user can have one active van at a time.
        </p>
      </div>
      <Banner error={error} notice={notice} />

      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Warehouses</h3>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Code</th>
                <th className="th">Name</th>
                <th className="th">Type</th>
                <th className="th">Branch</th>
                <th className="th">Units held</th>
                <th className="th">Status</th>
                <th className="th">Edit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {warehouses.map((w) => (
                <tr key={w.id}>
                  <td className="td font-mono text-xs">{w.code ?? "—"}</td>
                  <td className="td font-medium text-slate-900">
                    {w.name}
                    {w.address && <div className="text-xs font-normal text-slate-400">{w.address}</div>}
                  </td>
                  <td className="td">{TYPE_LABEL[w.type] ?? w.type}</td>
                  <td className="td">{w.branch.name}</td>
                  <td className="td">{unitsOf("warehouseId", w.id).toLocaleString()}</td>
                  <td className="td">
                    <StatusBadge status={w.status} />
                  </td>
                  <td className="td">
                    <details>
                      <summary className="cursor-pointer text-xs text-blue-600">Edit</summary>
                      <form action={updateWarehouse} className="mt-2 grid w-64 gap-1.5">
                        <input type="hidden" name="id" value={w.id} />
                        <input className="input py-1 text-xs" name="name" defaultValue={w.name} required />
                        <input className="input py-1 text-xs" name="code" defaultValue={w.code ?? ""} placeholder="Location code" />
                        <input className="input py-1 text-xs" name="address" defaultValue={w.address ?? ""} placeholder="Address" />
                        <select name="type" defaultValue={w.type} className="input py-1 text-xs">
                          <option value="saleable">Saleable</option>
                          <option value="damaged">Damaged</option>
                          <option value="quarantine">Quarantine</option>
                        </select>
                        <select name="branchId" defaultValue={w.branchId} className="input py-1 text-xs">
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                        </select>
                        <select name="status" defaultValue={w.status} className="input py-1 text-xs">
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                        <button type="submit" className="btn-secondary px-2 py-1 text-xs">Save</button>
                      </form>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card mt-3 max-w-md p-6">
          <h4 className="mb-3 text-sm font-semibold text-slate-900">New Warehouse</h4>
          <form action={createWarehouse} className="space-y-3">
            <input className="input" name="name" placeholder="e.g. Iloilo Branch Central Warehouse" required />
            <div className="grid grid-cols-2 gap-3">
              <input className="input" name="code" placeholder="Code (unique)" />
              <select className="input" name="type" defaultValue="saleable">
                <option value="saleable">Saleable</option>
                <option value="damaged">Damaged</option>
                <option value="quarantine">Quarantine</option>
              </select>
            </div>
            <input className="input" name="address" placeholder="Address" />
            <select className="input" name="branchId" defaultValue="" required>
              <option value="" disabled>Select branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <button type="submit" className="btn-primary w-full">Create</button>
          </form>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Vans</h3>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Code</th>
                <th className="th">Plate No.</th>
                <th className="th">Branch</th>
                <th className="th">Assigned rep</th>
                <th className="th">Units carried</th>
                <th className="th">Status</th>
                <th className="th">Edit / reassign</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vans.map((v) => (
                <tr key={v.id}>
                  <td className="td font-medium text-slate-900">{v.code}</td>
                  <td className="td">{v.plateNo}</td>
                  <td className="td">{v.branch.name}</td>
                  <td className="td">{v.assignedUser?.name ?? "Unassigned"}</td>
                  <td className="td">{unitsOf("vanId", v.id).toLocaleString()}</td>
                  <td className="td">
                    <StatusBadge status={v.status} />
                  </td>
                  <td className="td">
                    <details>
                      <summary className="cursor-pointer text-xs text-blue-600">Edit</summary>
                      <form action={updateVan} className="mt-2 grid w-64 gap-1.5">
                        <input type="hidden" name="id" value={v.id} />
                        <input className="input py-1 text-xs" name="code" defaultValue={v.code} required />
                        <input className="input py-1 text-xs" name="plateNo" defaultValue={v.plateNo} required />
                        <select name="branchId" defaultValue={v.branchId} className="input py-1 text-xs">
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                        </select>
                        <select name="assignedUserId" defaultValue={v.assignedUserId ?? ""} className="input py-1 text-xs">
                          <option value="">Unassigned</option>
                          {reps.map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                        <select name="status" defaultValue={v.status} className="input py-1 text-xs">
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                        <button type="submit" className="btn-secondary px-2 py-1 text-xs">Save</button>
                      </form>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card mt-3 max-w-md p-6">
          <h4 className="mb-3 text-sm font-semibold text-slate-900">New Van</h4>
          <form action={createVan} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input className="input" name="code" placeholder="e.g. VAN-ILO-1" required />
              <input className="input" name="plateNo" placeholder="Plate number" required />
            </div>
            <select className="input" name="branchId" defaultValue="" required>
              <option value="" disabled>Select branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <select className="input" name="assignedUserId" defaultValue="">
              <option value="">Unassigned</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <button type="submit" className="btn-primary w-full">Create</button>
          </form>
        </div>
      </div>
    </div>
  );
}
