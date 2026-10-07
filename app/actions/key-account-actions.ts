"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { KA_ACTIVITY_TYPES } from "@/lib/key-accounts";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function go(path: string, kind: "error" | "notice", message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
}

export async function logKeyAccountActivity(formData: FormData) {
  const { userId, branchId } = await getSession();
  const outletId = str(formData, "outletId");
  const back = `/sfa/key-accounts/${outletId}`;
  const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
  if (!user) go(back, "error", "No active session.");
  const type = str(formData, "type");
  const summary = str(formData, "summary");
  if (!KA_ACTIVITY_TYPES[type]) go(back, "error", "Choose the type of activity.");
  if (summary.length < 5) go(back, "error", "Describe what was discussed or done.");
  const nextAction = str(formData, "nextAction");
  const nextDue = str(formData, "nextDue");
  if (nextAction && !nextDue) go(back, "error", "Give the next action a due date.");
  const outlet = await prisma.outlet.findUniqueOrThrow({ where: { id: outletId } });
  const a = await prisma.keyAccountActivity.create({
    data: { outletId, userId: user.id, type, summary, outcome: str(formData, "outcome") || null, nextAction: nextAction || null, nextDue: nextDue ? new Date(nextDue) : null },
  });
  await logAudit("KeyAccountActivity", a.id, "create", `${user.name}: ${KA_ACTIVITY_TYPES[type]} with ${outlet.name}${nextAction ? ` — next: ${nextAction}` : ""}`, undefined, { userId: user.id, branchId });
  if (type === "issue_resolution" || type === "negotiation") await notify({ role: "supervisor", branchId: outlet.branchId, title: `Key account: ${KA_ACTIVITY_TYPES[type]}`, body: `${user.name} · ${outlet.name} — ${summary.slice(0, 100)}`, link: "/supervisor/key-accounts", kind: "info" });
  revalidatePath(back);
  go(back, "notice", "Activity logged.");
}

export async function completeKeyAccountAction(formData: FormData) {
  const id = str(formData, "id");
  const back = str(formData, "back") || "/sfa/key-accounts";
  await prisma.keyAccountActivity.update({ where: { id }, data: { status: "done" } });
  revalidatePath(back);
  go(back, "notice", "Next action marked done.");
}
