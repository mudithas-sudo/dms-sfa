import { prisma } from "@/lib/prisma";

interface NotifyInput {
  userId?: string | null;
  role?: string | null;
  branchId?: string | null;
  title: string;
  body: string;
  link?: string;
  kind?: "info" | "alert" | "approval";
}

// Writes an on-screen notification. Delivery by e-mail / push is a configuration
// matter agreed in detailed design; the notification centre is the system of record.
export async function notify(n: NotifyInput) {
  await prisma.notification.create({
    data: {
      userId: n.userId ?? null,
      role: n.role ?? null,
      branchId: n.branchId ?? null,
      title: n.title,
      body: n.body,
      link: n.link ?? null,
      kind: n.kind ?? "info",
    },
  });
}
