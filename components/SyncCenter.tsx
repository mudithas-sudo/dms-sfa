"use client";

import { useEffect, useState, useTransition } from "react";
import { submitFieldOrder, type SubmitInput } from "@/app/actions/sfa-order-actions";
import { QUEUE_EVENT, markFailed, readQueue, removeFromQueue, isOffline, setOffline, type QueuedItem } from "@/lib/offline-queue";

// Replays what the device captured offline. Each item carries its client reference; the server answers a
// reference it has already processed with the original document, so syncing twice is harmless.
export default function SyncCenter() {
  const [items, setItems] = useState<QueuedItem[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [offline, setOff] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    const refresh = () => {
      setItems(readQueue());
      setOff(isOffline());
    };
    refresh();
    window.addEventListener(QUEUE_EVENT, refresh);
    return () => window.removeEventListener(QUEUE_EVENT, refresh);
  }, []);

  const syncOne = async (item: QueuedItem) => {
    try {
      const r = await submitFieldOrder(item.payload as SubmitInput);
      if (r.ok) {
        removeFromQueue(item.id);
        setLog((l) => [`✓ ${item.label}: ${r.message}`, ...l]);
      } else {
        markFailed(item.id, r.message);
        setLog((l) => [`✕ ${item.label}: ${r.message}`, ...l]);
      }
    } catch (e) {
      markFailed(item.id, e instanceof Error ? e.message : "Network error");
      setLog((l) => [`✕ ${item.label}: could not reach the server — will retry`, ...l]);
    }
  };
  const syncAll = () => start(async () => {
    if (isOffline()) return setLog((l) => ["You are working offline — go online first.", ...l]);
    for (const i of readQueue()) await syncOne(i);
  });

  return (
    <div className="space-y-3">
      <div className="card flex items-center justify-between p-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{offline ? "Working offline" : "Online"}</p>
          <p className="text-[11px] text-slate-500">{items.length} transaction(s) held on this device</p>
        </div>
        <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setOffline(!offline)}>{offline ? "Go online" : "Work offline (demo)"}</button>
      </div>
      <button type="button" className="btn-primary w-full" disabled={pending || items.length === 0} onClick={syncAll}>{pending ? "Syncing…" : `Sync ${items.length} item(s) now`}</button>
      <div className="card divide-y divide-slate-100">
        {items.map((i) => (
          <div key={i.id} className="flex items-center justify-between gap-2 p-3">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-slate-900">{i.label}</p>
              <p className="text-[10px] text-slate-500">Captured {new Date(i.createdAt).toLocaleString("en-PH")} · ref {i.id.slice(0, 8)}</p>
              {i.error && <p className="text-[10px] text-rose-600">{i.error}</p>}
            </div>
            <div className="flex items-center gap-2">
              <span className={`badge ${i.status === "failed" ? "badge-red" : "badge-amber"}`}>{i.status === "failed" ? "Failed" : "Pending"}</span>
              <button type="button" className="text-[11px] text-blue-600 underline" disabled={pending} onClick={() => start(() => syncOne(i))}>Retry</button>
              <button type="button" className="text-[11px] text-slate-400 underline" onClick={() => removeFromQueue(i.id)}>Discard</button>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="p-3 text-xs text-slate-400">Nothing is waiting — all captured work has been sent.</p>}
      </div>
      {log.length > 0 && (
        <div className="card space-y-1 p-3">
          <p className="text-xs font-semibold text-slate-900">Sync log</p>
          {log.map((l, i) => (
            <p key={i} className="text-[11px] text-slate-600">{l}</p>
          ))}
        </div>
      )}
    </div>
  );
}
