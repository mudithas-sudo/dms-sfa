"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertCan } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { currentScope } from "@/lib/report-runner";
import { receiveInventoryObservations, sendApprovedReturns, sendNearExpirySignals, sendSuggestedOrderQuantities } from "@/lib/merchandising";

const BACK = "/admin/merchandising";

export async function runMerchandisingExchange(formData: FormData) {
  await assertCan("inventory", "edit");
  const kind = String(formData.get("kind"));
  const scope = await currentScope();
  let message = "";
  if (kind === "near_expiry") {
    const r = await sendNearExpirySignals(scope.branchIds);
    message = r.lots ? `Near-expiry signals sent: ${r.lots} lot(s) across ${r.branches} branch(es).` : "No lot is within the near-expiry window — nothing to send.";
  } else if (kind === "returns") {
    const r = await sendApprovedReturns(scope.branchIds);
    message = r.market + r.central ? `Approved returns sent: ${r.market} market and ${r.central} central-warehouse return(s).` : "There are no approved returns in the last 30 days.";
  } else if (kind === "suggested") {
    const r = await sendSuggestedOrderQuantities(scope.branchIds);
    message = `Suggested order quantities sent: ${r.suggestions} suggestion(s) for ${r.outlets} outlet(s).`;
  } else if (kind === "observations") {
    const r = await receiveInventoryObservations(scope.branchIds);
    message = `Received ${r.observations} shelf observation(s) from ${r.outlets} outlet(s); ${r.gaps} shelf gap(s) were flagged to supervisors.`;
  } else {
    redirect(`${BACK}?error=${encodeURIComponent("Unknown exchange.")}`);
  }
  await logAudit("Integration", "merchandising", "exchange", message);
  revalidatePath(BACK);
  revalidatePath("/admin/integrations");
  redirect(`${BACK}?notice=${encodeURIComponent(message)}`);
}
