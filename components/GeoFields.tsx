"use client";

import { useState } from "react";

// Captures the position stamped on a check-in / check-out. In the demo the source can be simulated so the
// location rules (tolerance, override, mock-location detection) can be exercised without moving.
export default function GeoFields({ lat, lng, withMock = true }: { lat: number; lng: number; withMock?: boolean }) {
  const [src, setSrc] = useState("at_outlet");
  const [dev, setDev] = useState<{ lat: number; lng: number } | null>(null);
  const [err, setErr] = useState("");

  const drift = src === "far" ? 0.0042 : 0.0001; // ~470 m vs ~11 m
  const pos = src === "device" && dev ? dev : { lat: lat + drift, lng: lng + (src === "far" ? 0.0021 : 0) };

  const requestDevice = () => {
    setSrc("device");
    if (!navigator.geolocation) return setErr("This device has no GPS — use a simulated source.");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setDev({ lat: p.coords.latitude, lng: p.coords.longitude });
        setErr("");
      },
      () => setErr("Location permission was denied — use a simulated source."),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  return (
    <div className="space-y-1">
      <label className="label">Location source</label>
      <select className="input py-1 text-xs" value={src} onChange={(e) => (e.target.value === "device" ? requestDevice() : setSrc(e.target.value))}>
        <option value="at_outlet">Demo: at the outlet</option>
        <option value="far">Demo: about 470 m away</option>
        {withMock && <option value="mock">Demo: mock-location app detected</option>}
        <option value="device">Device GPS</option>
      </select>
      <input type="hidden" name="lat" value={pos.lat} />
      <input type="hidden" name="lng" value={pos.lng} />
      <input type="hidden" name="mock" value={src === "mock" ? "1" : "0"} />
      <p className="text-[10px] text-slate-400">{pos.lat.toFixed(5)}, {pos.lng.toFixed(5)}{err ? ` · ${err}` : ""}</p>
    </div>
  );
}
