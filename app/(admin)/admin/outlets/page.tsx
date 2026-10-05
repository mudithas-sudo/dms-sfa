import Link from "next/link";
import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import { formatCurrency } from "@/lib/format";
import { Plus } from "lucide-react";

export default async function OutletsPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; channel?: string }>;
}) {
  const { branch, channel } = await searchParams;
  const [outlets, branches, channels] = await Promise.all([
    prisma.outlet.findMany({
      where: { ...(branch ? { branchId: branch } : {}), ...(channel ? { channelId: channel } : {}) },
      include: { branch: true, channel: true, route: true },
      orderBy: { name: "asc" },
    }),
    prisma.branch.findMany({ orderBy: { name: "asc" } }),
    prisma.channel.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">Outlets</h2>
        <Link href="/admin/outlets/new" className="btn-primary">
          <Plus size={16} /> New Outlet
        </Link>
      </div>

      <form className="card flex flex-wrap gap-3 p-4" method="get">
        <select name="branch" defaultValue={branch ?? ""} className="input max-w-xs">
          <option value="">All Branches</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <select name="channel" defaultValue={channel ?? ""} className="input max-w-xs">
          <option value="">All Channels</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button type="submit" className="btn-secondary">Filter</button>
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Name</th>
              <th className="th">Branch</th>
              <th className="th">Channel</th>
              <th className="th">Sub-Channel</th>
              <th className="th">Route</th>
              <th className="th">Credit Limit</th>
              <th className="th">Status</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {outlets.map((o) => (
              <tr key={o.id} className="hover:bg-slate-50">
                <td className="td font-medium text-slate-900">{o.name}</td>
                <td className="td">{o.branch.name}</td>
                <td className="td">{o.channel.name}</td>
                <td className="td">{o.subChannel}</td>
                <td className="td">{o.route?.name ?? "—"}</td>
                <td className="td">{formatCurrency(o.creditLimit)}</td>
                <td className="td"><StatusBadge status={o.status} /></td>
                <td className="td text-right">
                  <Link href={`/admin/outlets/${o.id}`} className="text-blue-600 hover:underline">Edit</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
