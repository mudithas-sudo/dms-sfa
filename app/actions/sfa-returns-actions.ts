"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { getAllSettings, num } from "@/lib/settings";
import { savePhotos, hasPhoto } from "@/lib/photos";
import { RETURN_REASON_LABELS } from "@/lib/field-constants";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function go(path: string, kind: "error" | "notice", message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
}

// A market return needs a reason from the list, the customer's signature, a photo for damage / quality claims,
// and sits inside the return period — otherwise it is raised as an exception for the supervisor to approve.
export async function submitMarketReturn(formData: FormData) {
  const { userId, branchId } = await getSession();
  const outletId = str(formData, "outletId");
  const back = `/sfa/market-returns/new?outlet=${outletId}`;
  const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
  if (!user) go(back, "error", "No active session.");
  const [invoiceId, productId] = (str(formData, "line") || ":").split(":");
  const productChoice = productId || str(formData, "productId");
  const qty = Math.floor(Number(str(formData, "qty")));
  const reason = str(formData, "reason");
  if (!outletId || !productChoice || !(qty > 0)) go(back, "error", "Choose the product and a quantity above zero.");
  if (!RETURN_REASON_LABELS[reason]) go(back, "error", "Choose a return reason from the list.");
  if (["damaged", "quality_complaint"].includes(reason) && !hasPhoto(formData)) go(back, "error", "A photo is required for damaged or quality-complaint returns.");
  const signatory = str(formData, "signatoryName");
  const signature = str(formData, "signatureDataUrl");
  if (!signatory || !signature.startsWith("data:image")) go(back, "error", "The customer's name and signature are required on a return.");

  const s = await getAllSettings();
  let outside = false;
  let why = "";
  if (invoiceId) {
    const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { lines: true } });
    if (!inv || inv.outletId !== outletId) go(back, "error", "That invoice does not belong to this customer.");
    const line = inv.lines.find((l) => l.productId === productChoice);
    if (!line) go(back, "error", "That product is not on the invoice.");
    const already = await prisma.marketReturn.aggregate({ where: { invoiceId, productId: productChoice, status: { not: "rejected" } }, _sum: { qty: true } });
    if (qty + (already._sum.qty ?? 0) > line.qty) go(back, "error", `Only ${line.qty - (already._sum.qty ?? 0)} unit(s) of this product are still returnable on ${inv.invoiceNumber}.`);
    const age = Math.floor((Date.now() - inv.invoiceDate.getTime()) / 86400000);
    if (age > num(s, "return.periodDays")) {
      outside = true;
      why = `invoice is ${age} days old (return period ${num(s, "return.periodDays")} days)`;
    }
  } else {
    outside = true;
    why = "no invoice reference";
  }

  const mr = await prisma.marketReturn.create({
    data: {
      outletId, productId: productChoice, qty, reason, invoiceId: invoiceId || null, lotNumber: str(formData, "lotNumber") || null,
      signatoryName: signatory, signatureDataUrl: signature, outsidePolicy: outside, capturedBy: user.name, photoPlaceholder: hasPhoto(formData),
    },
  });
  await savePhotos(formData, { linkedType: "return", linkedId: mr.id, outletId, photoType: "damaged_stock", uploadedBy: user.name });
  await logAudit("MarketReturn", mr.id, "capture", `${user.name} captured a return of ${qty} unit(s) — ${RETURN_REASON_LABELS[reason]}${outside ? ` (outside policy: ${why})` : ""}`, undefined, { userId: user.id });
  if (outside) {
    await prisma.approvalRequest.create({
      data: { type: "return_outside_policy", refId: mr.id, requestedBy: user.name, amount: 0, branchId, outletId, reason: `Return of ${qty} unit(s) (${RETURN_REASON_LABELS[reason]}) is outside policy — ${why}.` },
    });
    await notify({ role: "supervisor", branchId, title: "Return outside policy", body: `${user.name}: ${why}`, link: "/supervisor/approvals", kind: "approval" });
  } else {
    await notify({ role: "supervisor", branchId, title: "Market return to review", body: `${user.name} captured ${qty} unit(s) returned`, link: "/supervisor/market-returns", kind: "action" });
  }
  go(`/sfa/outlets/${outletId}`, "notice", outside ? `Return captured but it is outside policy (${why}) — your supervisor must approve it first.` : "Return captured — your supervisor will issue a credit note.");
}
