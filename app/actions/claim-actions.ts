"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { assertCan } from "@/lib/rbac";
import { getAllSettings, num } from "@/lib/settings";
import { sendMessage } from "@/lib/integration";
import { nextDocNumber } from "@/lib/finance";
import { qualifyingOrders } from "@/lib/claims";

function go(path: string, kind: "error" | "notice", message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function actor() {
  const { userId } = await getSession();
  const u = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
  return { id: u?.id ?? "", name: u?.name ?? "User" };
}

async function history(claimId: string, status: string, by: string, reason?: string) {
  await prisma.claimStatusHistory.create({ data: { claimId, status, changedBy: by, reason: reason || null } });
}

async function documentsFrom(formData: FormData, existing: string[] = []): Promise<string[]> {
  const docs = [...existing];
  for (const f of formData.getAll("docs")) {
    if (f instanceof File && f.size > 0 && f.name) docs.push(`${f.name} (${Math.max(1, Math.round(f.size / 1024))} KB)`);
  }
  for (const d of formData.getAll("docType").map(String)) if (d && !docs.includes(d)) docs.push(d);
  return docs;
}

// A claim is raised from the orders that actually earned the promotion — never typed in as a free amount.
export async function createClaim(formData: FormData) {
  await assertCan("promotions", "edit");
  const promotionId = str(formData, "promotionId");
  const back = `/supervisor/claims/new?promotion=${promotionId}&from=${str(formData, "periodStart")}&to=${str(formData, "periodEnd")}`;
  const promo = await prisma.promotion.findUniqueOrThrow({ where: { id: promotionId } });
  if (["draft", "discarded"].includes(promo.status)) go(back, "error", "That promotion was never active, so nothing can be claimed against it.");
  const s = await getAllSettings();
  const windowEnd = new Date(promo.endDate.getTime() + num(s, "claim.submitWindowDays") * 86400000);
  const intent = str(formData, "intent") || "submit";
  if (intent === "submit" && new Date() > windowEnd) go(back, "error", `The claim window closed on ${windowEnd.toLocaleDateString("en-PH")} (${num(s, "claim.submitWindowDays")} days after the promotion ended).`);

  const { branchId } = await getSession();
  const start = new Date(str(formData, "periodStart"));
  const end = new Date(str(formData, "periodEnd"));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) go(back, "error", "Choose a valid claim period.");
  const qualifying = await qualifyingOrders(promotionId, branchId, start, end);
  const picked = new Set(formData.getAll("orderId").map(String));
  const chosen = qualifying.filter((q) => picked.has(q.orderId));
  if (chosen.length === 0) go(back, "error", "Select at least one qualifying order.");
  const eligible = chosen.reduce((sum, q) => sum + q.eligible, 0);

  const claimedRaw = str(formData, "amount");
  const claimed = claimedRaw === "" ? eligible : Number(claimedRaw);
  if (!Number.isFinite(claimed) || claimed <= 0) go(back, "error", "Enter the amount being claimed.");
  const tol = num(s, "claim.tolerancePct");
  const over = claimed > eligible * (1 + tol / 100) + 0.005;
  const justification = str(formData, "justification");
  if (over && !justification) go(back, "error", `₱${claimed.toLocaleString()} is more than the eligible ₱${eligible.toLocaleString()}. Claim the eligible amount, or explain the difference to ask for an exception.`);

  const docs = await documentsFrom(formData);
  if (intent === "submit" && docs.length === 0) go(back, "error", "Attach at least one supporting document (or tick a document type) before submitting.");

  const me = await actor();
  const status = intent === "draft" || over ? "draft" : "submitted";
  const claim = await prisma.claim.create({
    data: {
      claimNumber: await nextDocNumber("CLM", "claim"),
      promotionId,
      submittedById: me.id,
      amount: claimed,
      eligibleAmount: eligible,
      status,
      notes: str(formData, "notes") || null,
      branchId,
      periodStart: start,
      periodEnd: end,
      documents: docs.length ? JSON.stringify(docs) : null,
      lines: { create: chosen.map((q) => ({ salesOrderId: q.orderId, orderNumber: q.orderNumber, amount: q.eligible })) },
    },
  });
  await history(claim.id, status, me.name, over ? `Exceeds eligible amount — exception requested: ${justification}` : intent === "draft" ? "Saved as draft" : "Submitted");
  await logAudit("Claim", claim.id, "create", `Created claim ${claim.claimNumber} for "${promo.name}" — claimed ₱${claimed.toLocaleString()} of ₱${eligible.toLocaleString()} eligible (${chosen.length} orders)`, { after: { claimed, eligible, orders: chosen.length } });

  if (over) {
    await prisma.approvalRequest.create({
      data: { type: "claim_exception", refId: claim.id, requestedBy: me.name, amount: claimed - eligible, reason: `${claim.claimNumber}: claim of ₱${claimed.toLocaleString()} exceeds eligible ₱${eligible.toLocaleString()} — ${justification}`, branchId },
    });
    await notify({ role: "supervisor", branchId, title: "Claim exception awaiting approval", body: `${claim.claimNumber} exceeds the eligible amount by ₱${(claimed - eligible).toLocaleString()}`, link: "/supervisor/approvals", kind: "approval" });
  } else if (status === "submitted") {
    await sendMessage({ connector: "trade_promotion", direction: "outbound", docType: "Claim", reference: claim.claimNumber, payload: { promotion: promo.name, amount: claimed, orders: chosen.length } });
    await notify({ role: "supervisor", branchId, title: "New promotion claim", body: `${claim.claimNumber} · ${promo.name} · ₱${claimed.toLocaleString()}`, link: `/supervisor/claims/${claim.id}`, kind: "action" });
  }
  revalidatePath("/supervisor/claims");
  go(`/supervisor/claims/${claim.id}`, "notice", over ? "Saved as a draft — it goes to review once the exception is approved." : status === "draft" ? "Saved as a draft." : "Claim submitted for review.");
}

// Submit a draft, or resubmit a claim that was returned for correction (documents / notes can be added).
export async function submitClaim(formData: FormData) {
  await assertCan("promotions", "edit");
  const id = str(formData, "id");
  const back = `/supervisor/claims/${id}`;
  const claim = await prisma.claim.findUniqueOrThrow({ where: { id }, include: { promotion: true } });
  if (!["draft", "returned"].includes(claim.status)) go(back, "error", "This claim has already been submitted.");
  const pendingException = await prisma.approvalRequest.count({ where: { type: "claim_exception", refId: id, status: "pending" } });
  if (pendingException) go(back, "error", "The exception request on this claim is still waiting for approval.");
  if (claim.amount > (claim.eligibleAmount ?? claim.amount) * (1 + num(await getAllSettings(), "claim.tolerancePct") / 100) + 0.005 && !claim.exceptionApproved) go(back, "error", "The claim is above the eligible amount and has no approved exception.");
  const existing: string[] = claim.documents ? JSON.parse(claim.documents) : [];
  const docs = await documentsFrom(formData, existing);
  if (docs.length === 0) go(back, "error", "Attach at least one supporting document before submitting.");
  const me = await actor();
  const note = str(formData, "reason");
  await prisma.claim.update({ where: { id }, data: { status: "submitted", documents: JSON.stringify(docs), notes: note ? `${claim.notes ? claim.notes + " | " : ""}${note}` : claim.notes } });
  await history(id, "submitted", me.name, claim.status === "returned" ? `Resubmitted${note ? `: ${note}` : ""}` : "Submitted");
  await logAudit("Claim", id, "submit", `${claim.status === "returned" ? "Resubmitted" : "Submitted"} claim ${claim.claimNumber}`);
  await sendMessage({ connector: "trade_promotion", direction: "outbound", docType: "Claim", reference: claim.claimNumber, payload: { promotion: claim.promotion.name, amount: claim.amount } });
  await notify({ role: "supervisor", branchId: claim.branchId, title: "Claim awaiting review", body: `${claim.claimNumber} · ${claim.promotion.name}`, link: back, kind: "action" });
  revalidatePath("/supervisor/claims");
  go(back, "notice", "Claim submitted for review.");
}

const FLOW: Record<string, string[]> = {
  submitted: ["under_review"],
  under_review: ["approved", "returned", "rejected"],
  approved: ["settlement_pending"],
  settlement_pending: ["settled"],
  reviewed: ["approved", "returned", "rejected"], // legacy status
};

export async function decideClaim(formData: FormData) {
  await assertCan("promotions", "approve");
  const id = str(formData, "id");
  const decision = str(formData, "decision");
  const reason = str(formData, "reason");
  const reference = str(formData, "reference");
  const back = `/supervisor/claims/${id}`;
  const claim = await prisma.claim.findUniqueOrThrow({ where: { id }, include: { promotion: true } });
  if (!(FLOW[claim.status] ?? []).includes(decision)) go(back, "error", `A ${claim.status.replace(/_/g, " ")} claim cannot move to ${decision.replace(/_/g, " ")}.`);
  const me = await actor();
  const { role } = await getSession();
  if (["approved", "rejected"].includes(decision) && claim.submittedById === me.id && role !== "admin") go(back, "error", "You raised this claim, so another approver must decide it.");
  if (["returned", "rejected"].includes(decision) && !reason) go(back, "error", `Give a reason so the submitter knows what to ${decision === "returned" ? "correct" : "expect"}.`);
  if (decision === "settled" && !reference) go(back, "error", "Enter the settlement reference (credit memo / payment reference).");

  await prisma.claim.update({ where: { id }, data: { status: decision, ...(reference ? { settlementReference: reference } : {}), tradePromoStatus: decision } });
  await history(id, decision, me.name, [reason, reference && `Ref ${reference}`].filter(Boolean).join(" · "));
  await logAudit("Claim", id, decision, `Claim ${claim.claimNumber}: ${claim.status} → ${decision.replace(/_/g, " ")}${reason ? ` — ${reason}` : ""}`, { before: { status: claim.status }, after: { status: decision } });
  await sendMessage({ connector: "trade_promotion", direction: "outbound", docType: "Claim status", reference: claim.claimNumber, payload: { status: decision, settlementReference: reference || undefined } });
  if (["returned", "rejected", "approved", "settled"].includes(decision)) {
    await notify({ userId: claim.submittedById, title: `Claim ${decision.replace(/_/g, " ")}`, body: `${claim.claimNumber}${reason ? `: ${reason}` : ""}`, link: back, kind: decision === "approved" || decision === "settled" ? "info" : "alert" });
  }
  revalidatePath("/supervisor/claims");
  go(back, "notice", `Claim is now ${decision.replace(/_/g, " ")}.`);
}
