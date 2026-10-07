import { prisma } from "@/lib/prisma";

export const VISIT_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export const PAYMENT_TERMS = [
  { id: "cash", label: "Cash on delivery" },
  { id: "credit_15", label: "Credit — 15 days" },
  { id: "credit_30", label: "Credit — 30 days" },
  { id: "credit_45", label: "Credit — 45 days" },
] as const;

export function termsLabel(id: string | null | undefined) {
  return PAYMENT_TERMS.find((t) => t.id === id)?.label ?? id ?? "—";
}

export function creditDays(terms: string | null | undefined) {
  if (terms === "cash") return 0;
  const m = /credit_(\d+)/.exec(terms ?? "");
  return m ? Number(m[1]) : 30;
}

export async function channelOptions() {
  const channels = await prisma.channel.findMany({
    orderBy: { name: "asc" },
    include: { subChannels: { orderBy: { name: "asc" } } },
  });
  return channels.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    subChannels: c.subChannels.map((s) => ({ id: s.id, name: s.name, status: s.status })),
  }));
}
