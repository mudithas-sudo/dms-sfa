import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import Banner from "@/components/Banner";
import { createChannel, createSubChannel, setChannelStatus } from "@/app/actions/admin-actions";

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  const channels = await prisma.channel.findMany({
    orderBy: { name: "asc" },
    include: { subChannels: { orderBy: { name: "asc" } }, _count: { select: { outlets: true, pricingRules: true, promotions: true } } },
  });
  const subUse = await prisma.outlet.groupBy({ by: ["channelId", "subChannel"], _count: { _all: true } });
  const countFor = (channelId: string, name: string) => subUse.find((u) => u.channelId === channelId && u.subChannel === name)?._count._all ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Channel & Sub-Channel Master</h2>
          <p className="mt-1 text-xs text-slate-500">
            Outlets are classified into a channel and a sub-channel of that channel. The classification drives pricing, promotion eligibility and channel-level reporting.
            A channel in use can be made inactive but not deleted.
          </p>
        </div>
        <form action={createChannel} className="flex gap-2">
          <input className="input w-40" name="name" placeholder="New channel name" required />
          <input className="input w-24" name="code" placeholder="Code" />
          <button type="submit" className="btn-primary shrink-0">Add channel</button>
        </form>
      </div>
      <Banner error={error} notice={notice} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {channels.map((c) => (
          <div key={c.id} className="card p-5">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  {c.name} {c.code && <span className="font-mono text-xs font-normal text-slate-400">{c.code}</span>}
                </h3>
                <p className="text-xs text-slate-500">
                  {c._count.outlets} outlets · used by {c._count.pricingRules} pricing rule(s) and {c._count.promotions} promotion(s)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={c.status} />
                <form action={setChannelStatus}>
                  <input type="hidden" name="kind" value="channel" />
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="status" value={c.status === "active" ? "inactive" : "active"} />
                  <button className="text-xs text-blue-600 hover:underline" type="submit">{c.status === "active" ? "Deactivate" : "Activate"}</button>
                </form>
              </div>
            </div>
            <ul className="mb-4 space-y-1.5">
              {c.subChannels.map((sc) => (
                <li key={sc.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
                  <span className="text-slate-700">
                    {sc.name} {sc.code && <span className="font-mono text-xs text-slate-400">{sc.code}</span>}
                    <span className="ml-2 text-xs text-slate-400">{countFor(c.id, sc.name)} outlets</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <StatusBadge status={sc.status} />
                    <form action={setChannelStatus}>
                      <input type="hidden" name="kind" value="subChannel" />
                      <input type="hidden" name="id" value={sc.id} />
                      <input type="hidden" name="status" value={sc.status === "active" ? "inactive" : "active"} />
                      <button className="text-xs text-blue-600 hover:underline" type="submit">{sc.status === "active" ? "Deactivate" : "Activate"}</button>
                    </form>
                  </span>
                </li>
              ))}
              {c.subChannels.length === 0 && <p className="text-xs text-slate-400">No sub-channels yet.</p>}
            </ul>
            <form action={createSubChannel} className="flex gap-2">
              <input type="hidden" name="channelId" value={c.id} />
              <input className="input" name="name" placeholder="New sub-channel name" required />
              <input className="input w-24" name="code" placeholder="Code" />
              <button type="submit" className="btn-secondary shrink-0">Add</button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
