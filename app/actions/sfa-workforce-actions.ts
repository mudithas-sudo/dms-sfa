"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { getAllSettings, num } from "@/lib/settings";
import { dayStart, getRepVan } from "@/lib/van";
import { savePhotos, hasPhoto } from "@/lib/photos";
import { distanceM } from "@/lib/geo";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function go(path: string, kind: "error" | "notice", message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
}

async function rep() {
  const { userId, branchId } = await getSession();
  const user = userId ? await prisma.user.findUnique({ where: { id: userId }, include: { branch: true } }) : null;
  return { user, branchId };
}

// ---------------------------------------------------------------------------
// Tasks: assigned → acknowledged → in progress → completed / not completed
// ---------------------------------------------------------------------------

async function ownTask(id: string) {
  const { user } = await rep();
  const t = await prisma.task.findUnique({ where: { id } });
  if (!user || !t || t.assignedToId !== user.id) go("/sfa/tasks", "error", "That task is not assigned to you.");
  return { user, task: t };
}

export async function acknowledgeTask(formData: FormData) {
  const { task } = await ownTask(str(formData, "id"));
  if (task.status !== "pending") go("/sfa/tasks", "error", "That task is already acknowledged.");
  await prisma.task.update({ where: { id: task.id }, data: { status: "acknowledged", acknowledgedAt: new Date() } });
  revalidatePath("/sfa/tasks");
  go("/sfa/tasks", "notice", "Task acknowledged.");
}

export async function startTask(formData: FormData) {
  const { task } = await ownTask(str(formData, "id"));
  if (!["pending", "acknowledged"].includes(task.status)) go("/sfa/tasks", "error", "That task cannot be started.");
  await prisma.task.update({ where: { id: task.id }, data: { status: "in_progress", startedAt: new Date(), acknowledgedAt: task.acknowledgedAt ?? new Date() } });
  revalidatePath("/sfa/tasks");
  go("/sfa/tasks", "notice", "Task started.");
}

export async function completeTask(formData: FormData) {
  const { user, task } = await ownTask(str(formData, "id"));
  if (["completed", "cancelled", "not_completed"].includes(task.status)) go("/sfa/tasks", "error", "That task is closed.");
  if (task.requiresPhoto && !hasPhoto(formData)) go("/sfa/tasks", "error", "This task needs a photo as proof before it can be completed.");
  await prisma.task.update({ where: { id: task.id }, data: { status: "completed", completedAt: new Date(), notes: str(formData, "notes") || task.notes } });
  await savePhotos(formData, { linkedType: "task", linkedId: task.id, outletId: task.outletId, photoType: "other", uploadedBy: user.name });
  await notify({ userId: task.assignedById, title: "Task completed", body: `${user.name}: ${task.title}`, link: "/supervisor/tasks", kind: "info" });
  revalidatePath("/sfa/tasks");
  go("/sfa/tasks", "notice", "Task completed.");
}

export async function notCompleteTask(formData: FormData) {
  const { user, task } = await ownTask(str(formData, "id"));
  const reason = str(formData, "reason");
  if (["completed", "cancelled", "not_completed"].includes(task.status)) go("/sfa/tasks", "error", "That task is closed.");
  if (!reason) go("/sfa/tasks", "error", "Say why the task could not be completed.");
  await prisma.task.update({ where: { id: task.id }, data: { status: "not_completed", notCompletedReason: reason } });
  await notify({ userId: task.assignedById, title: "Task not completed", body: `${user.name}: ${task.title} — ${reason}`, link: "/supervisor/tasks", kind: "alert" });
  revalidatePath("/sfa/tasks");
  go("/sfa/tasks", "notice", "Recorded as not completed — your supervisor has been told.");
}

// ---------------------------------------------------------------------------
// Leave and expenses
// ---------------------------------------------------------------------------

export async function submitLeave(formData: FormData) {
  const { user } = await rep();
  const back = "/sfa/requests";
  if (!user) go(back, "error", "No active session.");
  const start = new Date(str(formData, "startDate"));
  const end = new Date(str(formData, "endDate"));
  const half = str(formData, "halfDay") === "on";
  const type = str(formData, "leaveType") || "annual";
  const reason = str(formData, "reason");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) go(back, "error", "Choose valid dates — the end cannot be before the start.");
  if (!reason) go(back, "error", "Give a reason.");
  const s = await getAllSettings();
  const days = half ? 0.5 : Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const year = start.getFullYear();
  const used = await prisma.leaveRequest.findMany({ where: { userId: user.id, leaveType: type, status: { in: ["approved", "pending"] }, startDate: { gte: new Date(`${year}-01-01`), lte: new Date(`${year}-12-31`) } } });
  const usedDays = used.reduce((a, l) => a + (l.halfDay ? 0.5 : Math.round((l.endDate.getTime() - l.startDate.getTime()) / 86400000) + 1), 0);
  const allowance = type === "annual" ? num(s, "leave.annualDays") : type === "sick" ? num(s, "leave.sickDays") : num(s, "leave.emergencyDays");
  if (usedDays + days > allowance) go(back, "error", `That would use ${usedDays + days} of ${allowance} ${type} leave days this year (${usedDays} already approved or pending).`);
  const overlap = await prisma.leaveRequest.count({ where: { userId: user.id, status: { in: ["approved", "pending"] }, startDate: { lte: end }, endDate: { gte: start } } });
  if (overlap) go(back, "error", "You already have leave covering some of those dates.");
  const file = formData.get("attachment");
  const lr = await prisma.leaveRequest.create({ data: { userId: user.id, startDate: start, endDate: end, reason, leaveType: type, halfDay: half, attachmentName: file instanceof File && file.size > 0 ? file.name : null } });
  await logAudit("LeaveRequest", lr.id, "create", `${user.name} requested ${days} day(s) of ${type} leave`, undefined, { userId: user.id });
  if (user.supervisorId) await notify({ userId: user.supervisorId, title: "Leave request", body: `${user.name}: ${days} day(s) ${type}`, link: "/supervisor/requests", kind: "approval" });
  else await notify({ role: "supervisor", branchId: user.branchId, title: "Leave request", body: `${user.name}: ${days} day(s) ${type}`, link: "/supervisor/requests", kind: "approval" });
  go(back, "notice", "Leave request sent for approval.");
}

export async function submitExpense(formData: FormData) {
  const { user } = await rep();
  const back = "/sfa/requests";
  if (!user) go(back, "error", "No active session.");
  const amount = Number(str(formData, "amount"));
  const description = str(formData, "description");
  if (!(amount > 0) || !description) go(back, "error", "Enter an amount above zero and a description.");
  const date = str(formData, "expenseDate");
  if (date && new Date(date) > new Date()) go(back, "error", "The expense date cannot be in the future.");
  const file = formData.get("receipt");
  const hasReceipt = file instanceof File && file.size > 0;
  const s = await getAllSettings();
  if (amount > num(s, "expense.receiptAbove") && !hasReceipt) go(back, "error", `A receipt is required for expenses above ₱${num(s, "expense.receiptAbove").toLocaleString()}.`);
  const ex = await prisma.expenseRequest.create({ data: { userId: user.id, amount, category: str(formData, "category") || "other", description, receiptPlaceholder: hasReceipt, expenseDate: date ? new Date(date) : null } });
  await logAudit("ExpenseRequest", ex.id, "create", `${user.name} claimed ₱${amount.toLocaleString()} (${ex.category})`, undefined, { userId: user.id });
  await notify({ role: "supervisor", branchId: user.branchId, title: "Expense claim", body: `${user.name}: ₱${amount.toLocaleString()} ${ex.category}`, link: "/supervisor/requests", kind: "approval" });
  go(back, "notice", "Expense claim sent for approval.");
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export async function startDay(formData: FormData) {
  const { user } = await rep();
  const back = "/sfa/attendance";
  if (!user) go(back, "error", "No active session.");
  const existing = await prisma.attendance.findFirst({ where: { userId: user.id, dayDate: { gte: dayStart() } } });
  if (existing) go(back, "error", existing.status === "completed" ? "You have already ended today. Ask your supervisor to reopen it." : "Your day has already started.");
  const s = await getAllSettings();
  const now = new Date();
  const lat = Number(str(formData, "lat")) || 14.5995;
  const lng = Number(str(formData, "lng")) || 120.9842;
  const [h, m] = (s["attendance.standardStart"] ?? "08:30").split(":").map(Number);
  const late = now.getHours() * 60 + now.getMinutes() > h * 60 + (m || 0) + 15;
  const device = new Date(str(formData, "deviceTime"));
  const skew = !Number.isNaN(device.getTime()) && Math.abs(device.getTime() - now.getTime()) > 5 * 60000;
  // start-location check: the first route stop is the reference point
  const first = user.routeId ? await prisma.routeStop.findFirst({ where: { routeId: user.routeId }, include: { outlet: true }, orderBy: { sequence: "asc" } }) : null;
  const far = first ? distanceM(lat, lng, first.outlet.lat, first.outlet.lng) > num(s, "attendance.startRadiusM") : false;
  const a = await prisma.attendance.create({
    data: { userId: user.id, dayDate: dayStart(), startAt: now, startLat: lat, startLng: lng, status: "in_progress", startVariance: late ? "late" : "on_time", clockSkewFlag: skew, remarks: far ? "Started far from the first route stop" : null },
  });
  await logAudit("Attendance", a.id, "start", `${user.name} started the day${late ? " (late)" : ""}${skew ? " — device clock differs from the server" : ""}${far ? " — start location far from the route" : ""}`, undefined, { userId: user.id });
  if (late || skew || far) await notify({ role: "supervisor", branchId: user.branchId, title: "Day started with a flag", body: `${user.name}: ${[late && "late start", skew && "device clock skew", far && "away from route"].filter(Boolean).join(", ")}`, link: "/supervisor/team-dashboard", kind: "info" });
  revalidatePath(back);
  go(back, "notice", `Day started${late ? " — recorded as a late start" : ""}${skew ? "; your device clock differs from the server, which is flagged" : ""}.`);
}

// Items that must be settled before the day can end.
export async function openItems(userId: string): Promise<string[]> {
  const items: string[] = [];
  const visit = await prisma.fieldVisit.findFirst({ where: { salespersonId: userId, status: "in_progress" }, include: { outlet: true } });
  if (visit) items.push(`You are still checked in at ${visit.outlet.name} — check out first.`);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user?.branchId) {
    const van = await getRepVan(user.branchId, user);
    if (van) {
      const moves = await prisma.stockMovement.count({ where: { vanId: van.id, createdAt: { gte: dayStart() }, type: { in: ["van_sale", "van_load"] } } });
      const rec = await prisma.vanReconciliation.findFirst({ where: { vanId: van.id, dayDate: dayStart() } });
      if (moves > 0 && !rec) items.push("The van stock and cash reconciliation has not been submitted (End-of-Day screen).");
      if (rec && ["variance_open", "escalated"].includes(rec.status)) items.push("The van reconciliation has an unresolved variance — your supervisor must resolve it.");
    }
  }
  const drafts = await prisma.salesOrder.count({ where: { salespersonId: userId, status: "draft", orderDate: { gte: dayStart() } } });
  if (drafts) items.push(`${drafts} draft order(s) from today are still open — submit or delete them.`);
  return items;
}

export async function endDay(formData: FormData) {
  const { user } = await rep();
  const back = "/sfa/attendance";
  if (!user) go(back, "error", "No active session.");
  const a = await prisma.attendance.findUnique({ where: { id: str(formData, "attendanceId") } });
  if (!a || a.userId !== user.id || a.status !== "in_progress") go(back, "error", "There is no open day to end.");
  const items = await openItems(user.id);
  if (items.length) go(back, "error", `Cannot end the day yet: ${items.join(" ")}`);
  const lat = Number(str(formData, "lat")) || 14.5995;
  const lng = Number(str(formData, "lng")) || 120.9842;
  await prisma.attendance.update({ where: { id: a.id }, data: { endAt: new Date(), endLat: lat, endLng: lng, status: "completed" } });
  const planned = await prisma.fieldVisit.count({ where: { salespersonId: user.id, checkinAt: { gte: dayStart() }, visitType: "planned" } });
  await logAudit("Attendance", a.id, "end", `${user.name} ended the day — ${planned} planned visit(s)`, undefined, { userId: user.id });
  revalidatePath(back);
  go(back, "notice", "Day ended. Your summary has gone to your supervisor.");
}
