// Device-side durable queue (browser storage standing in for the device database). Transactions captured while
// offline wait here with a client reference; the sync centre replays them, and the server answers a repeated
// reference with the original document so a retry can never duplicate it.

export interface QueuedItem {
  id: string; // same as the clientRef
  kind: "order";
  label: string;
  payload: unknown;
  createdAt: string;
  status: "pending" | "failed";
  error?: string;
}

const KEY = "sfa.queue";
const OFFLINE_KEY = "sfa.offline";
export const QUEUE_EVENT = "sfa-queue-changed";

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function readQueue(): QueuedItem[] {
  return safe(() => JSON.parse(localStorage.getItem(KEY) ?? "[]") as QueuedItem[], []);
}

function write(items: QueuedItem[]) {
  safe(() => localStorage.setItem(KEY, JSON.stringify(items)), undefined);
  safe(() => window.dispatchEvent(new Event(QUEUE_EVENT)), undefined);
}

export function enqueue(item: Omit<QueuedItem, "createdAt" | "status">) {
  const items = readQueue().filter((i) => i.id !== item.id);
  items.push({ ...item, createdAt: new Date().toISOString(), status: "pending" });
  write(items);
}

export function markFailed(id: string, error: string) {
  write(readQueue().map((i) => (i.id === id ? { ...i, status: "failed", error } : i)));
}

export function removeFromQueue(id: string) {
  write(readQueue().filter((i) => i.id !== id));
}

// A fresh client reference for one transaction (idempotency key).
export function newRef(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `ref-${Math.random().toString(36).slice(2)}${new Date().getTime().toString(36)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isOffline(): boolean {
  return safe(() => localStorage.getItem(OFFLINE_KEY) === "1" || !navigator.onLine, false);
}

export function setOffline(v: boolean) {
  safe(() => localStorage.setItem(OFFLINE_KEY, v ? "1" : "0"), undefined);
  safe(() => window.dispatchEvent(new Event(QUEUE_EVENT)), undefined);
}
