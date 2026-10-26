import Link from "next/link";

interface Pin {
  id: string;
  name: string;
  lat: number;
  lng: number;
  state?: "visited" | "skipped" | "planned" | "other";
  color?: string;
  label?: string;
}

const COLOR: Record<string, string> = { visited: "#1d3280", skipped: "#8f98b0", planned: "#3558f0", other: "#b3bacd" };

// A lightweight map: outlets are plotted as pins scaled to their bounding box around the representative's position.
// With `route`, the pins are joined in order by a dashed line, like a planned run. `linkTo` makes each pin open a page;
// leave it out for a map that is only for looking at.
export default function OutletMap({
  pins,
  me,
  route = false,
  linkTo = (id: string) => `/sfa/outlets/${id}`,
  height = 240,
}: {
  pins: Pin[];
  me?: { lat: number; lng: number };
  route?: boolean;
  linkTo?: ((id: string) => string) | null;
  height?: number;
}) {
  const pts = [...pins, ...(me ? [{ id: "me", name: "You", lat: me.lat, lng: me.lng }] : [])];
  if (pts.length === 0) return <p className="text-xs text-slate-400">Nothing to plot.</p>;
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const w = 340, h = height, pad = 28;
  const x = (lng: number) => pad + ((lng - minLng) / Math.max(1e-6, maxLng - minLng)) * (w - pad * 2);
  const y = (lat: number) => h - pad - ((lat - minLat) / Math.max(1e-6, maxLat - minLat)) * (h - pad * 2);
  const line = pins.map((p) => `${x(p.lng).toFixed(1)},${y(p.lat).toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full rounded-2xl bg-[#e9eef8] shadow-xs" role="img" aria-label="Map of outlets">
      {/* parks and water */}
      <rect x={w * 0.08} y={h * 0.62} width={w * 0.22} height={h * 0.26} rx="14" fill="#dbeadf" />
      <rect x={w * 0.66} y={h * 0.1} width={w * 0.24} height={h * 0.2} rx="14" fill="#d6e4f5" />
      {/* streets */}
      <g stroke="#ffffff" strokeLinecap="round" fill="none">
        <path d={`M0 ${h * 0.3} C ${w * 0.3} ${h * 0.22}, ${w * 0.6} ${h * 0.42}, ${w} ${h * 0.34}`} strokeWidth="9" />
        <path d={`M${w * 0.28} 0 C ${w * 0.34} ${h * 0.4}, ${w * 0.22} ${h * 0.7}, ${w * 0.3} ${h}`} strokeWidth="7" />
        <path d={`M${w * 0.7} 0 C ${w * 0.66} ${h * 0.5}, ${w * 0.78} ${h * 0.75}, ${w * 0.72} ${h}`} strokeWidth="7" />
        <path d={`M0 ${h * 0.78} L ${w} ${h * 0.7}`} strokeWidth="5" />
      </g>
      {route && pins.length > 1 && (
        <polyline points={line} fill="none" stroke="#3558f0" strokeWidth="3" strokeDasharray="2 7" strokeLinecap="round" strokeLinejoin="round" opacity="0.65" />
      )}
      {pins.map((p, i) => {
        const pin = (
          <g>
            <circle cx={x(p.lng)} cy={y(p.lat) + 2} r="12" fill="#141828" opacity="0.12" />
            <circle cx={x(p.lng)} cy={y(p.lat)} r="12" fill={p.color ?? COLOR[p.state ?? "other"]} stroke="white" strokeWidth="3" />
            <text x={x(p.lng)} y={y(p.lat) + 4} textAnchor="middle" fontSize="11" fill="white" fontWeight="700">{p.label ?? i + 1}</text>
            <title>{p.name}</title>
          </g>
        );
        return linkTo ? <Link key={p.id} href={linkTo(p.id)}>{pin}</Link> : <g key={p.id}>{pin}</g>;
      })}
      {me && (
        <g>
          <circle cx={x(me.lng)} cy={y(me.lat)} r="17" fill="#3558f0" opacity="0.18" />
          <circle cx={x(me.lng)} cy={y(me.lat)} r="7" fill="#3558f0" stroke="white" strokeWidth="3" />
          <text x={x(me.lng) + 12} y={y(me.lat) - 12} fontSize="10" fontWeight="700" fill="#2845cf">You</text>
        </g>
      )}
    </svg>
  );
}
