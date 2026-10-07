"use server";

import { redirect } from "next/navigation";
import { deleteFieldDraft } from "@/app/actions/sfa-order-actions";

export async function deleteDraftAction(formData: FormData) {
  const r = await deleteFieldDraft(String(formData.get("id")));
  redirect(`/sfa/orders?${r.ok ? "notice" : "error"}=${encodeURIComponent(r.message)}`);
}
