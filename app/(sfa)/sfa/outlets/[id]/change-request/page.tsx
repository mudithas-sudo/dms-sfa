import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Banner from "@/components/Banner";
import PhotoCapture from "@/components/PhotoCapture";
import { submitChangeRequest } from "@/app/actions/sfa-misc-actions";

export default async function ChangeRequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error } = await searchParams;
  const outlet = await prisma.outlet.findUnique({ where: { id } });
  if (!outlet) notFound();
  const past = await prisma.customerChangeRequest.findMany({ where: { outletId: id }, orderBy: { createdAt: "desc" }, take: 5 });
  return (
    <div className="space-y-3">
      <Link href={`/sfa/outlets/${id}`} className="text-sm text-blue-600 hover:underline">← {outlet.name}</Link>
      <h2 className="text-base font-semibold text-slate-900">Request a customer change</h2>
      <p className="text-xs text-slate-500">The record changes only after your supervisor approves the request.</p>
      <Banner error={error} />
      <form action={submitChangeRequest} className="card space-y-3 p-4">
        <input type="hidden" name="outletId" value={id} />
        <div>
          <label className="label" htmlFor="field">What needs to change?</label>
          <select className="input" id="field" name="field" required>
            <option value="address">Address</option>
            <option value="contact_person">Contact person</option>
            <option value="phone">Phone number</option>
            <option value="visit_day">Visit day</option>
            <option value="closed">Outlet has closed</option>
            <option value="other">Something else</option>
          </select>
        </div>
        <input className="input" name="proposedValue" placeholder="New value / details *" required />
        <input className="input" name="reason" placeholder="Reason *" required />
        <PhotoCapture max={1} label="Add supporting photo" />
        <button className="btn-primary w-full" type="submit">Send request</button>
      </form>
      {past.length > 0 && (
        <div className="card p-3 text-xs">
          <p className="mb-1 font-semibold text-slate-900">Previous requests</p>
          {past.map((p) => (
            <p key={p.id} className="py-0.5 text-slate-600">{p.field.replace("_", " ")} → {p.proposedValue} · <span className="capitalize">{p.status}</span>{p.decisionNote ? ` (${p.decisionNote})` : ""}</p>
          ))}
        </div>
      )}
    </div>
  );
}
