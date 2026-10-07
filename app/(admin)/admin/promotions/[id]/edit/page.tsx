import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Banner from "@/components/Banner";
import PromotionForm from "@/components/admin/PromotionForm";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function EditPromotionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error } = await searchParams;
  const [p, products, channels, branches] = await Promise.all([
    prisma.promotion.findUnique({ where: { id } }),
    prisma.product.findMany({ where: { status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.channel.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.branch.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  if (!p) notFound();
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/admin/promotions" className="hover:underline">Promotions</Link>
        <span>/</span>
        <Link href={`/admin/promotions/${p.id}`} className="hover:underline">{p.name}</Link>
        <span>/</span>
        <span className="text-slate-900">Edit draft</span>
      </div>
      <Banner error={error} />
      <div className="card p-6">
        {p.status !== "draft" ? (
          <p className="text-sm text-slate-600">Only a draft can be edited. <Link className="text-blue-600 underline" href={`/admin/promotions/new?from=${p.id}`}>Start a new version</Link> instead.</p>
        ) : (
          <PromotionForm values={{ ...p, parentId: undefined, startDate: iso(p.startDate), endDate: iso(p.endDate) }} products={products} channels={channels} branches={branches} />
        )}
      </div>
    </div>
  );
}
