import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import { decideDevice, addApprovedHardware, retireHardware, resolveDeviceErrors } from "@/app/actions/platform-actions";
import { getNumberSetting } from "@/lib/settings";
import { formatDateTime } from "@/lib/format";
import { Smartphone, Printer } from "lucide-react";

// Admin / supervisor view of the synchronization state of every field device.
function syncStatus(d: { status: string; lastSyncAt: Date | null; pendingItems: number; errorItems: number }, staleHours: number) {
  if (d.status !== "approved") return d.status === "pending" ? "pending_approval" : "revoked";
  if (!d.lastSyncAt) return "never_synced";
  if (d.errorItems > 0) return "errors";
  if (Date.now() - d.lastSyncAt.getTime() > staleHours * 3600000) return "stale";
  if (d.pendingItems > 0) return "pending_items";
  return "up_to_date";
}

const LABEL: Record<string, string> = {
  up_to_date: "Up to date",
  pending_items: "Pending items",
  errors: "Errors",
  stale: "Stale",
  never_synced: "Never synced",
  pending_approval: "Awaiting approval",
  revoked: "Revoked",
};
const TONE: Record<string, string> = {
  up_to_date: "badge-green",
  pending_items: "badge-amber",
  errors: "badge-red",
  stale: "badge-red",
  never_synced: "badge-slate",
  pending_approval: "badge-amber",
  revoked: "badge-red",
};

export default async function DevicesPage() {
  const [devices, users, hardware, staleHours] = await Promise.all([
    prisma.deviceRegistration.findMany({ orderBy: { registeredAt: "asc" } }),
    prisma.user.findMany({ select: { id: true, name: true, branch: { select: { name: true } } } }),
    prisma.approvedHardware.findMany({ orderBy: [{ kind: "asc" }, { model: "asc" }] }),
    getNumberSetting("sync.staleHours"),
  ]);
  const userOf = new Map(users.map((u) => [u.id, u]));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900"><Smartphone size={18} className="text-slate-500" /> Devices, Sync Status & Printers</h2>
        <p className="mt-1 text-sm text-slate-500">
          A user signs in only on an approved device. The SFA app is deployed and updated under the company&apos;s mobile-device-management policy; administrators keep
          the list of approved Android models and portable Bluetooth printers the platform is verified against. The table shows each device&apos;s synchronization state,
          so a representative whose device has fallen behind can be followed up. A device is Stale after {staleHours}h without a successful sync.
        </p>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">User</th>
              <th className="th">Device / printer</th>
              <th className="th">Last sync</th>
              <th className="th">Pending</th>
              <th className="th">Errors</th>
              <th className="th">Sync state</th>
              <th className="th">Registration</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {devices.map((d) => {
              const state = syncStatus(d, staleHours);
              const u = userOf.get(d.userId);
              return (
                <tr key={d.id}>
                  <td className="td font-medium text-slate-900">
                    {u?.name ?? "—"}
                    <div className="text-xs font-normal text-slate-400">{u?.branch?.name}</div>
                  </td>
                  <td className="td text-xs">
                    {d.deviceModel}
                    <div className="text-slate-400">{d.printerModel ? `Printer: ${d.printerModel}` : "No printer paired"}</div>
                  </td>
                  <td className="td text-xs">{d.lastSyncAt ? formatDateTime(d.lastSyncAt) : "—"}</td>
                  <td className="td">
                    {d.pendingItems}
                    {d.oldestPendingAt && <div className="text-[11px] text-slate-400">oldest {formatDateTime(d.oldestPendingAt)}</div>}
                  </td>
                  <td className="td">
                    {d.errorItems}
                    {d.lastError && <div className="max-w-[200px] text-[11px] text-rose-600">{d.lastError}</div>}
                  </td>
                  <td className="td">
                    <span className={`badge ${TONE[state]}`}>{LABEL[state]}</span>
                  </td>
                  <td className="td">
                    <StatusBadge status={d.status === "approved" ? "active" : d.status === "pending" ? "pending" : "inactive"} />
                  </td>
                  <td className="td text-right text-xs">
                    <div className="flex flex-col items-end gap-1">
                      {d.errorItems > 0 && (
                        <form action={resolveDeviceErrors}>
                          <input type="hidden" name="id" value={d.id} />
                          <button className="text-blue-600 hover:underline" type="submit">Mark resolved</button>
                        </form>
                      )}
                      {d.status !== "approved" && (
                        <form action={decideDevice}>
                          <input type="hidden" name="id" value={d.id} />
                          <input type="hidden" name="status" value="approved" />
                          <button className="text-emerald-700 hover:underline" type="submit">Approve</button>
                        </form>
                      )}
                      {d.status === "approved" && (
                        <form action={decideDevice}>
                          <input type="hidden" name="id" value={d.id} />
                          <input type="hidden" name="status" value="revoked" />
                          <button className="text-rose-600 hover:underline" type="submit">Revoke</button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {(["device", "printer"] as const).map((kind) => (
          <div key={kind} className="card p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
              {kind === "device" ? <Smartphone size={16} /> : <Printer size={16} />} Approved {kind === "device" ? "Android device models" : "Bluetooth printers"}
            </h3>
            <ul className="mb-3 space-y-1.5">
              {hardware.filter((h) => h.kind === kind).map((h) => (
                <li key={h.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
                  <span className={h.status === "retired" ? "text-slate-400 line-through" : "text-slate-700"}>{h.model}</span>
                  <form action={retireHardware}>
                    <input type="hidden" name="id" value={h.id} />
                    <input type="hidden" name="status" value={h.status === "approved" ? "retired" : "approved"} />
                    <button className="text-xs text-blue-600 hover:underline" type="submit">{h.status === "approved" ? "Retire" : "Restore"}</button>
                  </form>
                </li>
              ))}
            </ul>
            <form action={addApprovedHardware} className="flex gap-2">
              <input type="hidden" name="kind" value={kind} />
              <input className="input" name="model" placeholder={kind === "device" ? "e.g. Samsung Galaxy A15" : "e.g. Zebra ZQ320"} required />
              <button className="btn-secondary shrink-0" type="submit">Add</button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
