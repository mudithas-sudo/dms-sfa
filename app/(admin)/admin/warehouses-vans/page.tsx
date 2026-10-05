import { prisma } from "@/lib/prisma";
import { createWarehouse, updateWarehouse, createVan, updateVan } from "@/app/actions/admin-actions";

export default async function WarehousesVansPage() {
  const [warehouses, vans, branches, reps] = await Promise.all([
    prisma.warehouse.findMany({ orderBy: { name: "asc" }, include: { branch: true, _count: { select: { stockBalances: true } } } }),
    prisma.van.findMany({ orderBy: { code: "asc" }, include: { branch: true, assignedUser: true } }),
    prisma.branch.findMany({ orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { role: "sales_rep" }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Warehouse & Van Master</h2>
        <p className="mt-1 text-sm text-slate-500">
          Every branch warehouse and every van is registered here as a distinct, identifiable inventory location.
        </p>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Warehouses</h3>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Name</th>
                <th className="th">Branch</th>
                <th className="th">Stock Lots</th>
                <th className="th">Reassign Branch</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {warehouses.map((w) => (
                <tr key={w.id}>
                  <td className="td font-medium text-slate-900">{w.name}</td>
                  <td className="td">{w.branch.name}</td>
                  <td className="td">{w._count.stockBalances}</td>
                  <td className="td">
                    <form action={updateWarehouse} className="flex gap-1.5">
                      <input type="hidden" name="id" value={w.id} />
                      <input type="hidden" name="name" value={w.name} />
                      <select name="branchId" defaultValue={w.branchId} className="input py-1 text-xs">
                        {branches.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                      <button type="submit" className="btn-secondary px-2 py-1 text-xs">Save</button>
                    </form>
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
                <th className="th">Assigned Rep</th>
                <th className="th">Reassign</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vans.map((v) => (
                <tr key={v.id}>
                  <td className="td font-medium text-slate-900">{v.code}</td>
                  <td className="td">{v.plateNo}</td>
                  <td className="td">{v.branch.name}</td>
                  <td className="td">{v.assignedUser?.name ?? "Unassigned"}</td>
                  <td className="td">
                    <form action={updateVan} className="flex flex-wrap gap-1.5">
                      <input type="hidden" name="id" value={v.id} />
                      <input type="hidden" name="code" value={v.code} />
                      <input type="hidden" name="plateNo" value={v.plateNo} />
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
                      <button type="submit" className="btn-secondary px-2 py-1 text-xs">Save</button>
                    </form>
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
