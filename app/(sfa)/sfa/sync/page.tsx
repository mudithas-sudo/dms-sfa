import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import SyncCenter from "@/components/SyncCenter";
import { formatDateTime } from "@/lib/format";

export default async function SyncPage() {
  const { userId } = await getSession();
  const device = userId ? await prisma.deviceRegistration.findUnique({ where: { userId } }) : null;
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Sync Centre</h2>
        <p className="text-xs text-slate-500">Work captured without a signal is kept safely on the device and sent here. Reference data (customers, prices, promotions, stock) is refreshed at each sync.</p>
      </div>
      {device && (
        <div className="card p-3 text-xs text-slate-600">
          <p><strong className="text-slate-900">{device.deviceModel}</strong> · {device.deviceId} · {device.status}</p>
          <p>Last synchronised {device.lastSyncAt ? formatDateTime(device.lastSyncAt) : "never"} · server-side pending {device.pendingItems} · errors {device.errorItems}</p>
          {device.lastError && <p className="text-rose-600">{device.lastError}</p>}
        </div>
      )}
      <SyncCenter />
    </div>
  );
}
