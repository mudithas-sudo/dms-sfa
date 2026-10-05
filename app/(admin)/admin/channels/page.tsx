import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import { createChannel, createSubChannel } from "@/app/actions/admin-actions";

export default async function ChannelsPage() {
  const channels = await prisma.channel.findMany({
    orderBy: { name: "asc" },
    include: { subChannels: { orderBy: { name: "asc" } }, _count: { select: { outlets: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">Channel & Sub-Channel Master</h2>
        <form action={createChannel} className="flex gap-2">
          <input className="input" name="name" placeholder="New channel name" required />
          <button type="submit" className="btn-primary shrink-0">Add channel</button>
        </form>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {channels.map((c) => (
          <div key={c.id} className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">{c.name}</h3>
              <span className="text-xs text-slate-500">{c._count.outlets} outlets</span>
            </div>
            <ul className="mb-4 space-y-1.5">
              {c.subChannels.map((sc) => (
                <li key={sc.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
                  <span className="text-slate-700">{sc.name}</span>
                  <StatusBadge status={sc.status} />
                </li>
              ))}
              {c.subChannels.length === 0 && <p className="text-xs text-slate-400">No sub-channels yet.</p>}
            </ul>
            <form action={createSubChannel} className="flex gap-2">
              <input type="hidden" name="channelId" value={c.id} />
              <input className="input" name="name" placeholder="New sub-channel name" required />
              <button type="submit" className="btn-secondary shrink-0">Add</button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
