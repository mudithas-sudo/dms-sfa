"use client";

import { useState } from "react";
import { Wifi, WifiOff, RefreshCw } from "lucide-react";

// Purely a demo of the concept: a real offline-first mobile app would queue
// writes in IndexedDB and replay them against the server. Here the "queue" is
// just in-memory React state — reloading the page resets it, which is fine
// for showing the idea in a browser demo.
export default function SyncStatusWidget() {
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(0);
  const [flashSuccess, setFlashSuccess] = useState(false);

  const simulateAction = () => {
    if (offline) setPending((p) => p + 1);
  };

  const toggleOffline = () => {
    if (offline) {
      // Going back online: flush the queue.
      setOffline(false);
      if (pending > 0) {
        setFlashSuccess(true);
        setTimeout(() => setFlashSuccess(false), 2500);
      }
      setPending(0);
    } else {
      setOffline(true);
    }
  };

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {offline ? <WifiOff size={16} className="text-amber-600" /> : <Wifi size={16} className="text-emerald-600" />}
          <span className="text-sm font-medium text-slate-900">{offline ? "Offline" : "Synced"}</span>
          {pending > 0 && <span className="badge badge-amber">{pending} pending sync</span>}
        </div>
        <button type="button" onClick={toggleOffline} className="text-xs font-medium text-blue-600 hover:underline">
          {offline ? "Go Online" : "Go Offline (demo)"}
        </button>
      </div>
      {offline && (
        <button
          type="button"
          onClick={simulateAction}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 py-2 text-xs text-slate-500"
        >
          <RefreshCw size={14} /> Simulate an action while offline
        </button>
      )}
      {flashSuccess && <p className="mt-2 text-xs text-emerald-600">Queue flushed — all changes synced.</p>}
    </div>
  );
}
