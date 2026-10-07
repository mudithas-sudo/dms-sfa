import Link from "next/link";
import { prisma } from "@/lib/prisma";
import Banner from "@/components/Banner";
import StatusBadge from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";
import { runMerchandisingExchange } from "@/app/actions/merch-actions";

const EXCHANGES = [
  { kind: "near_expiry", dir: "Out", title: "Near-expiry signals", text: "Lots within the near-expiry window, so merchandisers can push or re-display them." },
  { kind: "returns", dir: "Out", title: "Approved returns", text: "Market returns with an approved credit note and returns to the central warehouse." },
  { kind: "suggested", dir: "Out", title: "Suggested order quantities", text: "Per outlet and SKU, from each outlet's recent orders — the same rule the field app uses." },
  { kind: "observations", dir: "In", title: "Physical inventory observations", text: "What the merchandiser counted on the shelf. Shelf gaps raise an alert to the supervisor." },
];

export default async function MerchandisingPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  const [messages, obs, outlets, products] = await Promise.all([
    prisma.integrationMessage.findMany({ where: { connector: "merchandising" }, orderBy: { createdAt: "desc" }, take: 15 }),
    prisma.merchandisingObservation.findMany({ orderBy: { observedAt: "desc" }, take: 20 }),
    prisma.outlet.findMany({ select: { id: true, name: true } }),
    prisma.product.findMany({ select: { id: true, name: true } }),
  ]);
  const oname = new Map(outlets.map((o) => [o.id, o.name]));
  const pname = new Map(products.map((p) => [p.id, p.name]));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Merchandising Application Interface</h2>
        <p className="mt-1 text-sm text-slate-500">
          The DMS and the merchandising application exchange physical inventory observations, approved returns, near-expiry signals and suggested order quantities over the API. Each exchange is logged on the gateway,
          so a failed one waits in the <Link className="text-blue-600 underline" href="/admin/integrations">error queue</Link> until it is corrected and resent.
        </p>
      </div>
      <Banner error={error} notice={notice} />
      <div className="grid gap-3 sm:grid-cols-2">
        {EXCHANGES.map((e) => (
          <div key={e.kind} className="card flex items-start justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-semibold text-slate-900">{e.title} <span className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${e.dir === "In" ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"}`}>{e.dir === "In" ? "inbound" : "outbound"}</span></p>
              <p className="mt-1 text-xs text-slate-500">{e.text}</p>
            </div>
            <form action={runMerchandisingExchange}><input type="hidden" name="kind" value={e.kind} /><button className="btn-secondary whitespace-nowrap" type="submit">{e.dir === "In" ? "Receive now" : "Send now"}</button></form>
          </div>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Latest exchanges</h3>
        <table className="w-full">
          <thead className="bg-slate-50"><tr><th className="th">When</th><th className="th">Direction</th><th className="th">Content</th><th className="th">Reference</th><th className="th">Status</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {messages.map((m) => (
              <tr key={m.id}><td className="td text-xs">{formatDateTime(m.createdAt)}</td><td className="td text-xs capitalize">{m.direction}</td><td className="td text-xs">{m.docType.replace(/_/g, " ")}</td><td className="td text-xs text-slate-500">{m.reference}</td><td className="td"><StatusBadge status={m.status === "ok" ? "completed" : "failed"} />{m.error && <span className="ml-2 text-[11px] text-rose-600">{m.error}</span>}</td></tr>
            ))}
            {messages.length === 0 && <tr><td className="td text-slate-400" colSpan={5}>Nothing exchanged yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto">
        <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Shelf observations received</h3>
        <table className="w-full">
          <thead className="bg-slate-50"><tr><th className="th">Observed</th><th className="th">Outlet</th><th className="th">Product</th><th className="th text-right">On shelf</th><th className="th text-right">Facings</th><th className="th text-right">Shelf share</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {obs.map((o) => (
              <tr key={o.id}><td className="td text-xs">{formatDateTime(o.observedAt)}</td><td className="td">{oname.get(o.outletId)}</td><td className="td">{pname.get(o.productId)}</td><td className={`td text-right ${o.observedQty < 3 ? "font-medium text-rose-600" : ""}`}>{o.observedQty}</td><td className="td text-right">{o.facings ?? "—"}</td><td className="td text-right">{o.shelfShare != null ? `${o.shelfShare}%` : "—"}</td></tr>
            ))}
            {obs.length === 0 && <tr><td className="td text-slate-400" colSpan={6}>No observations received yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
