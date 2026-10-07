"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { assertCan } from "@/lib/rbac";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function go(path: string, kind: "error" | "notice", message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
}

async function actor() {
  const { userId, branchId, role } = await getSession();
  const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
  return { user, branchId, role };
}

// ---------------------------------------------------------------------------
// Customer change requests raised by reps
// ---------------------------------------------------------------------------

export async function decideChangeRequest(formData: FormData) {
  await assertCan("sales", "approve");
  const back = "/supervisor/change-requests";
  const id = str(formData, "id");
  const decision = str(formData, "decision");
  const note = str(formData, "note");
  const { user } = await actor();
  const cr = await prisma.customerChangeRequest.findUniqueOrThrow({ where: { id } });
  if (cr.status !== "pending") go(back, "error", "This request was already decided.");
  if (decision === "rejected" && !note) go(back, "error", "Give a reason when rejecting a change request.");
  if (decision === "approved") {
    const data: Record<string, unknown> = {};
    if (cr.field === "address") data.address = cr.proposedValue;
    if (cr.field === "contact_person") data.contactPerson = cr.proposedValue;
    if (cr.field === "phone") data.phone = cr.proposedValue;
    if (cr.field === "visit_day") data.visitDay = cr.proposedValue.toLowerCase();
    if (cr.field === "closed") {
      const open = await prisma.salesOrder.count({ where: { outletId: cr.outletId, status: { in: ["draft", "confirmed", "picked", "on_hold"] } } });
      if (open) go(back, "error", `The customer has ${open} open order(s) — close them before deactivating the outlet.`);
      data.status = "inactive";
      data.blockedReason = `Closed (field report: ${cr.reason})`;
    }
    if (Object.keys(data).length) await prisma.outlet.update({ where: { id: cr.outletId }, data });
  }
  await prisma.customerChangeRequest.update({ where: { id }, data: { status: decision, decidedBy: user?.name, decisionNote: note || null, decidedAt: new Date() } });
  await logAudit("Outlet", cr.outletId, "change_request_" + decision, `${decision === "approved" ? "Approved" : "Rejected"} change request: ${cr.field.replace("_", " ")} → "${cr.proposedValue}"${note ? ` — ${note}` : ""}`);
  const rep = await prisma.user.findFirst({ where: { name: cr.requestedBy } });
  if (rep) await notify({ userId: rep.id, title: `Change request ${decision}`, body: `${cr.field.replace("_", " ")} → ${cr.proposedValue}${note ? `: ${note}` : ""}`, link: `/sfa/outlets/${cr.outletId}`, kind: decision === "approved" ? "info" : "alert" });
  revalidatePath(back);
  go(back, "notice", `Change request ${decision}.`);
}

// ---------------------------------------------------------------------------
// Task assignment
// ---------------------------------------------------------------------------

export async function createTask(formData: FormData) {
  await assertCan("sales", "edit");
  const back = "/supervisor/tasks";
  const { user, branchId } = await actor();
  const title = str(formData, "title");
  const assignees = formData.getAll("assignedToId").map(String).filter(Boolean);
  if (!user) go(back, "error", "No active session.");
  if (!title || assignees.length === 0) go(back, "error", "Give the task a title and choose at least one representative.");
  const due = str(formData, "dueDate");
  for (const assignedToId of assignees) {
    const t = await prisma.task.create({
      data: {
        title, description: str(formData, "description") || null, assignedToId, assignedById: user.id,
        outletId: str(formData, "outletId") || null, dueDate: due ? new Date(due) : null,
        priority: str(formData, "priority") || "normal", requiresPhoto: str(formData, "requiresPhoto") === "on",
      },
    });
    await notify({ userId: assignedToId, title: "New task assigned", body: `${title}${due ? ` — due ${due}` : ""}`, link: "/sfa/tasks", kind: "action" });
    await logAudit("Task", t.id, "create", `${user.name} assigned "${title}"`, undefined, { branchId });
  }
  revalidatePath(back);
  go(back, "notice", `Task assigned to ${assignees.length} representative(s).`);
}

export async function cancelTask(formData: FormData) {
  await assertCan("sales", "edit");
  const id = str(formData, "id");
  const t = await prisma.task.findUniqueOrThrow({ where: { id } });
  if (["completed", "cancelled"].includes(t.status)) go("/supervisor/tasks", "error", "That task is already closed.");
  await prisma.task.update({ where: { id }, data: { status: "cancelled" } });
  await notify({ userId: t.assignedToId, title: "Task cancelled", body: t.title, link: "/sfa/tasks", kind: "info" });
  revalidatePath("/supervisor/tasks");
  go("/supervisor/tasks", "notice", "Task cancelled.");
}

// ---------------------------------------------------------------------------
// Leave and expense approvals
// ---------------------------------------------------------------------------

export async function decideLeave(formData: FormData) {
  await assertCan("sales", "approve");
  const back = "/supervisor/requests";
  const id = str(formData, "id");
  const decision = str(formData, "decision");
  const note = str(formData, "note");
  const { user } = await actor();
  const lr = await prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
  if (lr.status !== "pending") go(back, "error", "That request was already decided.");
  if (lr.userId === user?.id) go(back, "error", "You cannot approve your own leave.");
  if (["rejected", "returned"].includes(decision) && !note) go(back, "error", "Give a reason so the representative understands the decision.");
  await prisma.leaveRequest.update({ where: { id }, data: { status: decision, approvedBy: user?.name, decisionNote: note || null, decidedAt: new Date() } });
  await logAudit("LeaveRequest", id, decision, `Leave ${decision}: ${lr.startDate.toISOString().slice(0, 10)} to ${lr.endDate.toISOString().slice(0, 10)}${note ? ` — ${note}` : ""}`);
  await notify({ userId: lr.userId, title: `Leave ${decision}`, body: note || `${lr.leaveType} leave`, link: "/sfa/requests", kind: decision === "approved" ? "info" : "alert" });
  revalidatePath(back);
  go(back, "notice", `Leave ${decision}.`);
}

export async function decideExpense(formData: FormData) {
  await assertCan("sales", "approve");
  const back = "/supervisor/requests";
  const id = str(formData, "id");
  const decision = str(formData, "decision");
  const note = str(formData, "note");
  const { user } = await actor();
  const ex = await prisma.expenseRequest.findUniqueOrThrow({ where: { id } });
  if (ex.status !== "pending") go(back, "error", "That claim was already decided.");
  if (ex.userId === user?.id) go(back, "error", "You cannot approve your own expense claim.");
  if (["rejected", "partially_approved"].includes(decision) && !note) go(back, "error", "Explain a rejection or partial approval.");
  const approvedAmount = decision === "partially_approved" ? Number(str(formData, "approvedAmount")) : ex.amount;
  if (decision === "partially_approved" && !(approvedAmount > 0 && approvedAmount < ex.amount)) go(back, "error", "For a partial approval enter an amount above zero and below the claimed amount.");
  await prisma.expenseRequest.update({ where: { id }, data: { status: decision, approvedBy: user?.name, decisionNote: decision === "partially_approved" ? `Approved ₱${approvedAmount.toLocaleString()} of ₱${ex.amount.toLocaleString()}. ${note}` : note || null, decidedAt: new Date() } });
  await logAudit("ExpenseRequest", id, decision, `Expense ₱${ex.amount.toLocaleString()} ${decision.replace("_", " ")}${note ? ` — ${note}` : ""}`);
  await notify({ userId: ex.userId, title: `Expense ${decision.replace("_", " ")}`, body: `₱${ex.amount.toLocaleString()} ${ex.category}${note ? `: ${note}` : ""}`, link: "/sfa/requests", kind: decision === "rejected" ? "alert" : "info" });
  revalidatePath(back);
  go(back, "notice", `Expense ${decision.replace("_", " ")}.`);
}

// ---------------------------------------------------------------------------
// Targets and attendance reopen
// ---------------------------------------------------------------------------

export async function setTarget(formData: FormData) {
  await assertCan("sales", "approve");
  const back = "/supervisor/targets";
  const userId = str(formData, "userId");
  const metric = str(formData, "metric");
  const period = str(formData, "period");
  const value = Number(str(formData, "targetValue"));
  if (!userId || !metric || !/^\d{4}-\d{2}$/.test(period) || !(value >= 0)) go(back, "error", "Choose the representative, metric, a month and a target value.");
  const existing = await prisma.target.findFirst({ where: { userId, metric, period } });
  if (existing) await prisma.target.update({ where: { id: existing.id }, data: { targetValue: value } });
  else await prisma.target.create({ data: { userId, metric, period, targetValue: value } });
  await logAudit("Target", userId, "set", `Target ${metric.replace(/_/g, " ")} for ${period} set to ${value.toLocaleString()}`);
  revalidatePath(back);
  go(back, "notice", "Target saved.");
}

export async function reopenDay(formData: FormData) {
  await assertCan("sales", "approve");
  const id = str(formData, "attendanceId");
  const reason = str(formData, "reason");
  const back = "/supervisor/team-dashboard";
  const { user } = await actor();
  if (!reason) go(back, "error", "Give a reason for reopening the day.");
  const a = await prisma.attendance.findUniqueOrThrow({ where: { id } });
  if (a.status !== "completed") go(back, "error", "That day is still open.");
  await prisma.attendance.update({ where: { id }, data: { status: "in_progress", endAt: null, reopenedBy: user?.name, reopenReason: reason } });
  await logAudit("Attendance", id, "reopen", `Day reopened — ${reason}`);
  await notify({ userId: a.userId, title: "Your day was reopened", body: reason, link: "/sfa/attendance", kind: "info" });
  revalidatePath(back);
  go(back, "notice", "The representative's day was reopened.");
}
