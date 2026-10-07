import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { ROLES } from "@/lib/constants";
import { markAllNotificationsRead } from "@/app/actions/platform-actions";
import { formatDateTime } from "@/lib/format";

export default async function NotificationsPage() {
  const { role, userId } = await getSession();
  const home = ROLES.find((r) => r.id === role)?.homePath ?? "/";
  const items = await prisma.notification.findMany({
    where: { OR: [...(userId ? [{ userId }] : []), { role, userId: null }] },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Notifications</h1>
        <div className="flex gap-2">
          <form action={markAllNotificationsRead}><button className="btn-secondary" type="submit">Mark all read</button></form>
          <Link href={home} className="btn-secondary">Back</Link>
        </div>
      </div>
      <div className="card divide-y divide-slate-100">
        {items.map((n) => (
          <div key={n.id} className={`px-4 py-3 ${n.readAt ? "" : "bg-blue-50/40"}`}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-900">{n.title}</p>
              <span className="text-xs text-slate-400">{formatDateTime(n.createdAt)}</span>
            </div>
            <p className="text-sm text-slate-600">{n.body}</p>
            {n.link && <Link href={n.link} className="text-xs text-blue-600 hover:underline">Open</Link>}
          </div>
        ))}
        {items.length === 0 && <p className="p-6 text-center text-sm text-slate-400">No notifications.</p>}
      </div>
    </div>
  );
}
