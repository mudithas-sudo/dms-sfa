import Link from "next/link";

interface Pin {
  id: string;
  name: string;
  lat: number;
  lng: number;
  state?: "visited" | "skipped" | "planned" | "other";
  label?: string;
}

const COLOR: Record<string, string> = { visited: "#059669", skipped: "#d97706", planned: "#2563eb", other: "#64748b" };

// A lightweight map: outlets are plotted as pins scaled to their bounding box around the representative's position.
export default function OutletMap({ pins, me }: { pins: Pin[]; me?: { lat: number; lng: number } }) {
  const pts = [...pins, ...(me ? [{ id: "me", name: "You", lat: me.lat, lng: me.lng }] : [])];
  if (pts.length === 0) return <p className="text-xs text-slate-400">Nothing to plot.</p>;
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const w = 340, h = 240, pad = 22;
  const x = (lng: number) => pad + ((lng - minLng) / Math.max(1e-6, maxLng - minLng)) * (w - pad * 2);
  const y = (lat: number) => h - pad - ((lat - minLat) / Math.max(1e-6, maxLat - minLat)) * (h - pad * 2);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full rounded-lg border border-slate-200 bg-slate-100">
      {[0.25, 0.5, 0.75].map((f) => (
        <g key={f} stroke="#e2e8f0" strokeWidth="1">
          <line x1={w * f} y1="0" x2={w * f} y2={h} />
          <line x1="0" y1={h * f} x2={w} y2={h * f} />
        </g>
      ))}
      {pins.map((p, i) => (
        <Link key={p.id} href={`/sfa/outlets/${p.id}`}>
          <g>
            <circle cx={x(p.lng)} cy={y(p.lat)} r="8" fill={COLOR[p.state ?? "other"]} stroke="white" strokeWidth="2" />
            <text x={x(p.lng)} y={y(p.lat) + 3} textAnchor="middle" fontSize="8" fill="white" fontWeight="bold">{p.label ?? i + 1}</text>
            <title>{p.name}</title>
          </g>
        </Link>
      ))}
      {me && (
        <g>
          <circle cx={x(me.lng)} cy={y(me.lat)} r="6" fill="#0f172a" stroke="white" strokeWidth="2" />
          <text x={x(me.lng) + 9} y={y(me.lat) + 3} fontSize="9" fill="#0f172a">You</text>
        </g>
      )}
    </svg>
  );
}
