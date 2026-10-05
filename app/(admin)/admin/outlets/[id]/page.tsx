import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { updateOutlet } from "@/app/actions/admin-actions";

export default async function EditOutletPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [outlet, branches, channels, routes] = await Promise.all([
    prisma.outlet.findUnique({ where: { id } }),
    prisma.branch.findMany({ orderBy: { name: "asc" } }),
    prisma.channel.findMany({ orderBy: { name: "asc" } }),
    prisma.route.findMany({ orderBy: { name: "asc" } }),
  ]);
  if (!outlet) notFound();

  return (
    <div className="max-w-xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/admin/outlets" className="hover:underline">Outlets</Link>
        <span>/</span>
        <span className="text-slate-900">{outlet.name}</span>
      </div>
      <div className="card p-6">
        <h2 className="mb-4 text-base font-semibold text-slate-900">Edit Outlet</h2>
        <form action={updateOutlet} className="space-y-4">
          <input type="hidden" name="id" value={outlet.id} />
          <div>
            <label className="label" htmlFor="name">Outlet Name</label>
            <input className="input" id="name" name="name" defaultValue={outlet.name} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="branchId">Branch</label>
              <select className="input" id="branchId" name="branchId" defaultValue={outlet.branchId} required>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="channelId">Channel</label>
              <select className="input" id="channelId" name="channelId" defaultValue={outlet.channelId} required>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="subChannel">Sub-Channel</label>
              <input className="input" id="subChannel" name="subChannel" defaultValue={outlet.subChannel} required />
            </div>
            <div>
              <label className="label" htmlFor="routeId">Route</label>
              <select className="input" id="routeId" name="routeId" defaultValue={outlet.routeId ?? ""}>
                <option value="">Unassigned</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="address">Address</label>
            <input className="input" id="address" name="address" defaultValue={outlet.address} required />
          </div>
          <div>
            <label className="label" htmlFor="contactPerson">Contact Person</label>
            <input className="input" id="contactPerson" name="contactPerson" defaultValue={outlet.contactPerson ?? ""} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label" htmlFor="creditLimit">Credit Limit (₱)</label>
              <input className="input" id="creditLimit" name="creditLimit" type="number" defaultValue={outlet.creditLimit} />
            </div>
            <div>
              <label className="label" htmlFor="lat">Latitude</label>
              <input className="input" id="lat" name="lat" type="number" step="0.0001" defaultValue={outlet.lat} />
            </div>
            <div>
              <label className="label" htmlFor="lng">Longitude</label>
              <input className="input" id="lng" name="lng" type="number" step="0.0001" defaultValue={outlet.lng} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="status">Status</label>
            <select className="input" id="status" name="status" defaultValue={outlet.status}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" className="btn-primary">Save Changes</button>
            <Link href="/admin/outlets" className="btn-secondary">Cancel</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
