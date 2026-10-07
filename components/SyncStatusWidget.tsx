"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { QUEUE_EVENT, isOffline, readQueue, setOffline } from "@/lib/offline-queue";

// Shows whether the device is working offline and how many captured transactions are waiting to sync. The
// queue itself is held on the device and replayed from the sync centre.
export default function SyncStatusWidget({ lastSync }: { lastSync?: string | null }) {
  const [offline, setOff] = useState(false);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);

  useEffect(() => {
    const refresh = () => {
      setOff(isOffline());
      const q = readQueue();
      setPending(q.filter((i) => i.status === "pending").length);
      setFailed(q.filter((i) => i.status === "failed").length);
    };
    refresh();
    window.addEventListener(QUEUE_EVENT, refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    return () => {
      window.removeEventListener(QUEUE_EVENT, refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
    };
  }, []);

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {offline ? <WifiOff size={16} className="text-amber-600" /> : <Wifi size={16} className="text-emerald-600" />}
          <span className="text-sm font-medium text-slate-900">{offline ? "Working offline" : "Online"}</span>
          {pending > 0 && <span className="badge badge-amber">{pending} waiting to sync</span>}
          {failed > 0 && <span className="badge badge-red">{failed} failed</span>}
        </div>
        <button type="button" onClick={() => setOffline(!offline)} className="text-xs font-medium text-blue-600 hover:underline">
          {offline ? "Go online" : "Work offline (demo)"}
        </button>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        {lastSync ? `Last synchronised ${lastSync}.` : "Not synchronised yet."} Orders captured offline are stored on the device and sent from the{" "}
        <Link href="/sfa/sync" className="text-blue-600 underline">sync centre</Link> — a resend never creates a duplicate.
      </p>
    </div>
  );
}
