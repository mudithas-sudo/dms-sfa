import { prisma } from "@/lib/prisma";
import { PAYMENT_TERMS } from "@/lib/masterdata";

// Reference data maintained by administrators: payment terms, banks and tax rates. Defaults apply until something
// is configured, so a fresh database still works.

export const DEFAULT_BANKS = ["BDO Unibank", "BPI", "Metrobank", "Land Bank of the Philippines", "Security Bank", "PNB", "UnionBank", "China Bank"];

export interface TermOption {
  id: string;
  label: string;
  days: number;
}

export async function paymentTermOptions(): Promise<TermOption[]> {
  const rows = await prisma.referenceItem.findMany({ where: { kind: "payment_term", status: "active" }, orderBy: { value: "asc" } });
  if (rows.length === 0) return PAYMENT_TERMS.map((t) => ({ id: t.id, label: t.label, days: t.id === "cash" ? 0 : Number(t.id.replace("credit_", "")) }));
  return rows.map((r) => ({ id: r.code, label: r.label, days: r.value ?? 0 }));
}

export async function termLabelOf(code: string | null | undefined) {
  const all = await prisma.referenceItem.findMany({ where: { kind: "payment_term" } });
  return all.find((t) => t.code === code)?.label ?? PAYMENT_TERMS.find((t) => t.id === code)?.label ?? code ?? "—";
}

export async function bankOptions(): Promise<string[]> {
  const rows = await prisma.referenceItem.findMany({ where: { kind: "bank", status: "active" }, orderBy: { label: "asc" } });
  return rows.length ? rows.map((r) => r.label) : DEFAULT_BANKS;
}

export async function taxRates() {
  return prisma.referenceItem.findMany({ where: { kind: "tax_rate" }, orderBy: [{ isDefault: "desc" }, { code: "asc" }] });
}

// The VAT rate (as a fraction) used on new invoices.
export async function currentVatRate(): Promise<number> {
  const def = await prisma.referenceItem.findFirst({ where: { kind: "tax_rate", status: "active", isDefault: true } });
  return def?.value != null ? def.value / 100 : 0.12;
}

// Saves the built-in lists as editable entries the first time an administrator changes a list.
export async function ensureReferenceDefaults() {
  if ((await prisma.referenceItem.count({ where: { kind: "payment_term" } })) === 0) {
    for (const t of PAYMENT_TERMS) await prisma.referenceItem.create({ data: { kind: "payment_term", code: t.id, label: t.label, value: t.id === "cash" ? 0 : Number(t.id.replace("credit_", "")) } });
  }
  if ((await prisma.referenceItem.count({ where: { kind: "bank" } })) === 0) {
    for (const b of DEFAULT_BANKS) await prisma.referenceItem.create({ data: { kind: "bank", code: b.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40), label: b } });
  }
  if ((await prisma.referenceItem.count({ where: { kind: "tax_rate" } })) === 0) {
    await prisma.referenceItem.create({ data: { kind: "tax_rate", code: "vat12", label: "Value-added tax", value: 12, isDefault: true } });
    await prisma.referenceItem.create({ data: { kind: "tax_rate", code: "vat0", label: "Zero-rated sales", value: 0 } });
  }
}
