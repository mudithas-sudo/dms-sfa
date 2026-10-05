import { prisma } from "@/lib/prisma";
import { registerFieldCustomer } from "@/app/actions/sfa-actions";

export default async function NewFieldCustomerPage() {
  const channels = await prisma.channel.findMany({ orderBy: { name: "asc" }, include: { subChannels: true } });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">New Customer Registration</h2>
        <p className="text-xs text-slate-500">Submits to the Central Administrator&apos;s onboarding queue for approval.</p>
      </div>

      <form action={registerFieldCustomer} className="card space-y-4 p-4">
        <div>
          <label className="label" htmlFor="name">Business Name</label>
          <input className="input" id="name" name="name" required />
        </div>
        <div>
          <label className="label" htmlFor="channelId">Channel</label>
          <select className="input" id="channelId" name="channelId" required>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="subChannel">Sub-Channel</label>
          <input className="input" id="subChannel" name="subChannel" placeholder="e.g. Sari-Sari Store" required />
        </div>
        <div>
          <label className="label" htmlFor="address">Address</label>
          <input className="input" id="address" name="address" required />
        </div>
        <div>
          <label className="label" htmlFor="contactPerson">Contact Person</label>
          <input className="input" id="contactPerson" name="contactPerson" placeholder="Owner / manager name" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="lat">Latitude</label>
            <input className="input" id="lat" name="lat" type="number" step="0.0001" defaultValue={14.5995} />
          </div>
          <div>
            <label className="label" htmlFor="lng">Longitude</label>
            <input className="input" id="lng" name="lng" type="number" step="0.0001" defaultValue={120.9842} />
          </div>
        </div>
        <p className="text-xs text-slate-400">Coordinates default to a simulated GPS reading at your current location.</p>
        <button type="submit" className="btn-primary w-full">Submit for Approval</button>
      </form>
    </div>
  );
}
