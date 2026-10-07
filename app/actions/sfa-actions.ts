"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { postPayment } from "@/lib/finance";
import { getSession } from "@/lib/session";

// Suggested van-stock replenishment quantity: average of the rep's last 5 sales-order line quantities for this
// product, across all their customers — a simple rule (not forecasting) giving a starting point for the request.
export async function suggestedVanQty(vanId: string, productId: string): Promise<number> {
  const van = await prisma.van.findUnique({ where: { id: vanId } });
  if (!van) return 0;
  const rep = van.assignedUserId
    ? await prisma.user.findUnique({ where: { id: van.assignedUserId } })
    : await prisma.user.findFirst({ where: { branchId: van.branchId, role: "sales_rep", name: van.driverName } });
  if (!rep) return 0;
  const lastLines = await prisma.salesOrderLine.findMany({
    where: { productId, salesOrder: { salespersonId: rep.id, status: { notIn: ["voided", "cancelled"] } } },
    orderBy: { salesOrder: { orderDate: "desc" } },
    take: 5,
  });
  if (lastLines.length === 0) return 0;
  return Math.round(lastLines.reduce((s, l) => s + l.qty, 0) / lastLines.length);
}

// Collection from the mobile app: cash, cheque (bank, branch, date; post-dated held pending), bank transfer or other.
export async function recordCollection(formData: FormData) {
  const outletId = String(formData.get("outletId"));
  const method = String(formData.get("method"));
  const back = `/sfa/collections/new?outlet=${outletId}`;
  const { userId } = await getSession();
  const field = (k: string) => String(formData.get(k) ?? "").trim();
  let result;
  try {
    result = await postPayment({
      outletId,
      method,
      amount: Number(formData.get("amount")),
      reference: field("reference"),
      cheque: method === "cheque" ? { number: field("chequeNumber"), bank: field("chequeBank"), branch: field("chequeBranch"), date: new Date(field("chequeDate")) } : undefined,
      collectedBy: userId ?? undefined,
      clientRef: field("clientRef") || undefined,
    });
  } catch (e) {
    redirect(`${back}&error=${encodeURIComponent(e instanceof Error ? e.message : "Could not record the payment")}`);
  }
  revalidatePath(`/sfa/outlets/${outletId}`);
  redirect(`/sfa/receipt/${encodeURIComponent(result.reference)}?outlet=${outletId}`);
}
