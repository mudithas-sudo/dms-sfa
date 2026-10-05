import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createOutlet } from "@/app/actions/admin-actions";

export default async function NewOutletPage() {
  const [branches, channels, routes] = await Promise.all([
    prisma.branch.findMany({ orderBy: { name: "asc" } }),
    prisma.channel.findMany({ orderBy: { name: "asc" } }),
    prisma.route.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="max-w-xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/admin/outlets" className="hover:underline">Outlets</Link>
        <span>/</span>
        <span className="text-slate-900">New</span>
      </div>
      <div className="card p-6">
        <h2 className="mb-4 text-base font-semibold text-slate-900">New Outlet</h2>
        <form action={createOutlet} className="space-y-4">
          <div>
            <label className="label" htmlFor="name">Outlet Name</label>
            <input className="input" id="name" name="name" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="branchId">Branch</label>
              <select className="input" id="branchId" name="branchId" required>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="channelId">Channel</label>
              <select className="input" id="channelId" name="channelId" required>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="subChannel">Sub-Channel</label>
              <input className="input" id="subChannel" name="subChannel" placeholder="e.g. Sari-Sari Store" required />
            </div>
            <div>
              <label className="label" htmlFor="routeId">Route</label>
              <select className="input" id="routeId" name="routeId">
                <option value="">Unassigned</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="address">Address</label>
            <input className="input" id="address" name="address" required />
          </div>
          <div>
            <label className="label" htmlFor="contactPerson">Contact Person</label>
            <input className="input" id="contactPerson" name="contactPerson" placeholder="Outlet owner / manager name" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label" htmlFor="creditLimit">Credit Limit (₱)</label>
              <input className="input" id="creditLimit" name="creditLimit" type="number" defaultValue={50000} />
            </div>
            <div>
              <label className="label" htmlFor="lat">Latitude</label>
              <input className="input" id="lat" name="lat" type="number" step="0.0001" defaultValue={14.5995} />
            </div>
            <div>
              <label className="label" htmlFor="lng">Longitude</label>
              <input className="input" id="lng" name="lng" type="number" step="0.0001" defaultValue={120.9842} />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" className="btn-primary">Create Outlet</button>
            <Link href="/admin/outlets" className="btn-secondary">Cancel</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
