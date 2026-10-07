import { prisma } from "@/lib/prisma";
import { getAllSettings, num } from "@/lib/settings";

// Photos taken in the app arrive as compressed data URLs in photoData, photoData_1, ... Each is stored with who took
// it, where, when and what it belongs to; the capture stamp cannot be edited afterwards.
export async function savePhotos(
  formData: FormData,
  ctx: { linkedType: string; linkedId?: string | null; outletId?: string | null; photoType?: string; uploadedBy: string; lat?: number | null; lng?: number | null },
): Promise<number> {
  const max = num(await getAllSettings(), "photo.maxPerForm");
  let saved = 0;
  for (const key of ["photoData", "photoData_1", "photoData_2", "photoData_3", "photoData_4"]) {
    const v = formData.get(key);
    if (typeof v !== "string" || !v.startsWith("data:image") || saved >= max) continue;
    await prisma.photo.create({
      data: {
        linkedType: ctx.linkedType, linkedId: ctx.linkedId ?? null, outletId: ctx.outletId ?? null, photoType: ctx.photoType ?? "other",
        dataUrl: v, uploadedBy: ctx.uploadedBy, lat: ctx.lat ?? null, lng: ctx.lng ?? null, uploadStatus: "uploaded",
      },
    });
    saved++;
  }
  return saved;
}

export function hasPhoto(formData: FormData): boolean {
  const v = formData.get("photoData");
  return typeof v === "string" && v.startsWith("data:image");
}
