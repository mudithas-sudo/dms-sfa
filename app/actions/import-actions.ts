"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { assertCan } from "@/lib/rbac";
import { applyRows, DATASETS, validateFile, type Dataset, type RowResult } from "@/lib/import";

const PAGE = "/admin/data-import";

async function who() {
  const { userId } = await getSession();
  return userId ? (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? "Administrator" : "Administrator";
}

// Step 1: read the file and check every row. Nothing is saved yet.
export async function validateImport(formData: FormData) {
  await assertCan("master_data", "edit");
  const dataset = String(formData.get("dataset")) as Dataset;
  const file = formData.get("file");
  if (!DATASETS[dataset]) redirect(`${PAGE}?error=${encodeURIComponent("Choose what you are importing.")}`);
  if (!(file instanceof File) || file.size === 0) redirect(`${PAGE}?error=${encodeURIComponent("Choose a CSV file to upload.")}`);
  if (file.size > 2_000_000) redirect(`${PAGE}?error=${encodeURIComponent("The file is larger than 2 MB — split it into smaller files.")}`);
  const text = await file.text();
  const { results, missingColumns } = await validateFile(dataset, text);
  if (missingColumns.length) redirect(`${PAGE}?error=${encodeURIComponent(`The file is missing the required column(s): ${missingColumns.join(", ")}. Download the template for the exact layout.`)}`);
  if (results.length === 0) redirect(`${PAGE}?error=${encodeURIComponent("The file has no data rows.")}`);
  if (results.length > 2000) redirect(`${PAGE}?error=${encodeURIComponent("A batch can hold up to 2,000 rows — split the file.")}`);
  const batch = await prisma.importBatch.create({
    data: { dataset, filename: file.name, totalRows: results.length, valid: results.filter((r) => r.outcome === "valid").length, rejected: results.filter((r) => r.outcome !== "valid").length, rows: JSON.stringify(results), createdBy: await who() },
  });
  await logAudit("ImportBatch", batch.id, "validate", `Validated ${file.name} (${DATASETS[dataset].label}): ${batch.valid} valid, ${batch.rejected} rejected of ${batch.totalRows}`);
  redirect(`${PAGE}/${batch.id}`);
}

// Step 2: load the rows that passed.
export async function confirmImport(formData: FormData) {
  await assertCan("master_data", "approve");
  const id = String(formData.get("id"));
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id } });
  if (batch.status !== "validated") redirect(`${PAGE}/${id}?error=${encodeURIComponent("This batch was already processed.")}`);
  const rows = JSON.parse(batch.rows) as RowResult[];
  const valid = rows.filter((r) => r.outcome === "valid");
  if (valid.length === 0) redirect(`${PAGE}/${id}?error=${encodeURIComponent("There is nothing valid to import.")}`);
  const by = await who();
  const { imported, failed } = await applyRows(batch.dataset as Dataset, valid, by);
  // rows that failed on save are recorded as rejected so the reconciliation stays truthful
  const failedLines = new Map(failed.map((f) => [f.line, f.message]));
  const updated = rows.map((r) => (failedLines.has(r.line) ? { ...r, outcome: "rejected" as const, message: `Save failed: ${failedLines.get(r.line)}` } : r));
  await prisma.importBatch.update({ where: { id }, data: { status: "imported", imported, rejected: updated.filter((r) => r.outcome !== "valid").length, rows: JSON.stringify(updated), importedAt: new Date() } });
  await logAudit("ImportBatch", id, "import", `Imported ${imported} ${DATASETS[batch.dataset as Dataset].label.toLowerCase()} row(s) from ${batch.filename}${failed.length ? `; ${failed.length} failed on save` : ""}`);
  revalidatePath(PAGE);
  redirect(`${PAGE}/${id}?notice=${encodeURIComponent(`${imported} row(s) imported${failed.length ? `, ${failed.length} could not be saved` : ""}. Check the reconciliation below.`)}`);
}

export async function discardImport(formData: FormData) {
  await assertCan("master_data", "edit");
  const id = String(formData.get("id"));
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id } });
  if (batch.status !== "validated") redirect(`${PAGE}/${id}?error=${encodeURIComponent("Only a batch that has not been imported can be discarded.")}`);
  await prisma.importBatch.update({ where: { id }, data: { status: "discarded" } });
  await logAudit("ImportBatch", id, "discard", `Discarded ${batch.filename}`);
  redirect(`${PAGE}?notice=${encodeURIComponent("The batch was discarded — nothing was loaded.")}`);
}
