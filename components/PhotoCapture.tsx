"use client";

import { useRef, useState } from "react";

// In-app camera capture: the image is taken with the device camera (no gallery picking), compressed on the
// device to keep storage and data use low, and sent with the form. The capture stamp (user, outlet, time,
// GPS) is recorded by the server when the form is saved and cannot be edited.
export default function PhotoCapture({
  name = "photoData",
  label = "Take photo",
  required = false,
  max = 3,
}: {
  name?: string;
  label?: string;
  required?: boolean;
  max?: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<{ data: string; status: "pending" | "uploaded" | "failed" }[]>([]);
  const [busy, setBusy] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 720 / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/jpeg", 0.6);
      setPhotos((p) => [...p, { data, status: "pending" as const }].slice(0, max));
    } catch {
      setPhotos((p) => [...p, { data: "", status: "failed" as const }].slice(0, max));
    }
    setBusy(false);
  }

  const good = photos.filter((p) => p.data);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => input.current?.click()} disabled={busy || good.length >= max}>
          📷 {label} {required && <span className="text-rose-600">*</span>}
        </button>
        <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPick} />
        {good.map((p, i) => (
          <span key={i} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.data} alt="Captured" className="h-12 w-12 rounded-md object-cover ring-1 ring-slate-300" />
            <span className="absolute -bottom-1 left-0 right-0 rounded bg-slate-900/70 px-0.5 text-center text-[8px] text-white">{p.status === "pending" ? "queued" : p.status}</span>
            <button type="button" onClick={() => setPhotos((x) => x.filter((_, j) => j !== photos.indexOf(p)))} className="absolute -right-1 -top-1 rounded-full bg-rose-600 px-1 text-[9px] text-white">×</button>
          </span>
        ))}
        {photos.some((p) => p.status === "failed") && <span className="text-xs text-rose-600">Capture failed — try again</span>}
      </div>
      <p className="mt-1 text-[10px] text-slate-400">Camera only — gallery images are not accepted as evidence. Up to {max} photos; they upload after the data so they never delay a sale.</p>
      {good.map((p, i) => (
        <input key={i} type="hidden" name={i === 0 ? name : `${name}_${i}`} value={p.data} />
      ))}
    </div>
  );
}
