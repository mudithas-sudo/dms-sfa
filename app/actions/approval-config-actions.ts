"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { assertCan } from "@/lib/rbac";
import { getSession } from "@/lib/session";
import { APPROVAL_TYPES } from "@/lib/approval-types";

// Which approval types only head office (administrators) may decide — everything else is decided by a supervisor
// within the value limits in Platform Configuration.
export async function saveApprovalAuthority(formData: FormData) {
  await assertCan("users", "approve");
  const headOffice = APPROVAL_TYPES.filter((t) => formData.get(`ho_${t.id}`) === "on").map((t) => t.id);
  const before = await prisma.appSetting.findUnique({ where: { key: "approval.headOfficeTypes" } });
  const { userId } = await getSession();
  const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
  await prisma.appSetting.upsert({ where: { key: "approval.headOfficeTypes" }, update: { value: headOffice.join(","), updatedBy: user?.name }, create: { key: "approval.headOfficeTypes", value: headOffice.join(","), updatedBy: user?.name } });
  await logAudit("Settings", "approval.headOfficeTypes", "update", `Approval authority changed — head office only: ${headOffice.join(", ") || "none"}`, { before: before?.value ?? "", after: headOffice.join(",") });
  revalidatePath("/admin/approval-authority");
  redirect(`/admin/approval-authority?notice=${encodeURIComponent("Approval authority saved. It applies to requests decided from now on.")}`);
}
