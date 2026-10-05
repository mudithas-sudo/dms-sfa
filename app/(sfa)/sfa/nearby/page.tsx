import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { MapPin } from "lucide-react";

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default async function NearbyOutletsPage() {
  const { userId, branchId } = await getSession();
  if (!userId || !branchId) return <p className="text-sm text-slate-500">No rep selected.</p>;

  const [lastVisit, branch, outlets] = await Promise.all([
    prisma.fieldVisit.findFirst({ where: { salespersonId: userId }, orderBy: { checkinAt: "desc" } }),
    prisma.branch.findUnique({ where: { id: branchId } }),
    prisma.outlet.findMany({ where: { branchId, status: "active" } }),
  ]);

  // Simulated current location: last check-in point, falling back to the branch itself.
  const currentLat = lastVisit?.checkinLat ?? 14.5995;
  const currentLng = lastVisit?.checkinLng ?? 120.9842;

  const sorted = outlets
    .map((o) => ({ ...o, distanceKm: haversineKm(currentLat, currentLng, o.lat, o.lng) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 15);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Nearby Outlets</h2>
        <p className="text-xs text-slate-500">
          Sorted by distance from your last check-in{lastVisit ? "" : ` (no check-ins yet — showing distance from ${branch?.name})`}.
        </p>
      </div>

      <div className="card divide-y divide-slate-100 p-2">
        {sorted.map((o) => (
          <Link key={o.id} href={`/sfa/outlets/${o.id}`} className="flex items-center justify-between px-2 py-3">
            <div className="flex items-center gap-3">
              <MapPin size={16} className="text-slate-300" />
              <div>
                <p className="text-sm font-medium text-slate-900">{o.name}</p>
                <p className="text-xs text-slate-500">{o.subChannel}</p>
              </div>
            </div>
            <span className="text-xs font-medium text-slate-500">{o.distanceKm.toFixed(1)} km</span>
          </Link>
        ))}
        {sorted.length === 0 && <p className="px-2 py-4 text-sm text-slate-400">No outlets found.</p>}
      </div>
    </div>
  );
}
