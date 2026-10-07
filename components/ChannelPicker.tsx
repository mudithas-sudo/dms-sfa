"use client";

import { useState } from "react";

export interface ChannelOption {
  id: string;
  name: string;
  status: string;
  subChannels: { id: string; name: string; status: string }[];
}

// Channel + sub-channel as linked drop-downs: every outlet belongs to one channel and
// one sub-channel of that channel, and inactive entries cannot be assigned.
export default function ChannelPicker({
  channels,
  channelId,
  subChannel,
  channelName = "channelId",
  subName = "subChannel",
}: {
  channels: ChannelOption[];
  channelId?: string;
  subChannel?: string;
  channelName?: string;
  subName?: string;
}) {
  const usable = channels.filter((c) => c.status === "active" || c.id === channelId);
  const [cid, setCid] = useState(channelId && usable.some((c) => c.id === channelId) ? channelId : usable[0]?.id ?? "");
  const subs = (channels.find((c) => c.id === cid)?.subChannels ?? []).filter((s) => s.status === "active" || s.name === subChannel);
  const [sub, setSub] = useState(subChannel ?? "");
  const effectiveSub = subs.some((s) => s.name === sub) ? sub : subs[0]?.name ?? "";

  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="label" htmlFor={channelName}>Channel</label>
        <select className="input" id={channelName} name={channelName} value={cid} onChange={(e) => setCid(e.target.value)} required>
          {usable.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor={subName}>Sub-channel</label>
        <select className="input" id={subName} name={subName} value={effectiveSub} onChange={(e) => setSub(e.target.value)} required>
          {subs.length === 0 && <option value="">No sub-channels — add one first</option>}
          {subs.map((s) => (
            <option key={s.id} value={s.name}>{s.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
