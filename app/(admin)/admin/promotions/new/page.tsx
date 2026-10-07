import Link from "next/link";
import { prisma } from "@/lib/prisma";
import Banner from "@/components/Banner";
import PromotionForm from "@/components/admin/PromotionForm";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus30 = () => {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d;
};

// `?from=<id>` starts a new version of an existing promotion with its settings pre-filled.
export default async function NewPromotionPage({ searchParams }: { searchParams: Promise<{ from?: string; error?: string }> }) {
  const { from, error } = await searchParams;
  const [products, channels, branches, source] = await Promise.all([
    prisma.product.findMany({ where: { status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.channel.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.branch.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    from ? prisma.promotion.findUnique({ where: { id: from } }) : null,
  ]);
  const values = source
    ? { ...source, id: undefined, parentId: source.parentId ?? source.id, code: null, startDate: iso(new Date()), endDate: iso(source.endDate > new Date() ? source.endDate : plus30()) }
    : {};

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/admin/promotions" className="hover:underline">Promotions</Link>
        <span>/</span>
        <span className="text-slate-900">{source ? `New version of ${source.name}` : "New"}</span>
      </div>
      <Banner error={error} />
      <div className="card p-6">
        <h2 className="mb-1 text-base font-semibold text-slate-900">{source ? `New version of "${source.name}"` : "New promotion"}</h2>
        <p className="mb-4 text-xs text-slate-500">The promotion is saved as a draft. It must be approved, then activated, before it applies to any order.</p>
        <PromotionForm values={values} products={products} channels={channels} branches={branches} />
      </div>
    </div>
  );
}
