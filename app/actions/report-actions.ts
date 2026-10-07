"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { assertCan } from "@/lib/rbac";
import { sendMessage } from "@/lib/integration";
import { reportById, resolveRelativeDates, REPORTS, type Filters } from "@/lib/reports";
import { scopeForUser } from "@/lib/report-runner";

const PAGE = "/admin/scheduled-reports";

function go(kind: "error" | "notice", message: string, path = PAGE): never {
  redirect(`${path}?${kind}=${encodeURIComponent(message)}`);
}
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function createSchedule(formData: FormData) {
  await assertCan("reports", "edit");
  const name = str(formData, "name");
  const reportType = str(formData, "reportType");
  const def = reportById(reportType);
  const recipients = str(formData, "recipientEmails");
  const frequency = str(formData, "frequency") || "daily";
  if (!name || !def) go("error", "Give the schedule a name and choose a report.");
  if (!recipients || !recipients.split(",").every((r) => /\S+@\S+\.\S+/.test(r.trim()))) go("error", "Enter valid recipient e-mail addresses, separated by commas.");
  const filters: Filters = {};
  for (const fd of def.filters) {
    const v = formData.getAll(`f_${fd.key}`).map(String).filter(Boolean).join(",");
    if (v) filters[fd.key] = v;
  }
  const { userId } = await getSession();
  const owner = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
  const s = await prisma.scheduledReport.create({
    data: {
      name, reportType, recipientEmails: recipients, frequency,
      scheduleDescription: `${frequency === "daily" ? "Every day" : frequency === "weekly" ? "Every Monday" : "1st of each month"} at ${str(formData, "time") || "07:00"}`,
      format: str(formData, "format") || "excel",
      filters: Object.keys(filters).length ? JSON.stringify(filters) : null,
      relativeDates: str(formData, "relativeDates") || null,
      ownerId: owner?.id ?? null,
      createdBy: owner?.name ?? "Admin",
    },
  });
  await logAudit("ScheduledReport", s.id, "create", `Scheduled "${name}" (${def.title}) ${frequency} to ${recipients}`, { after: s });
  revalidatePath(PAGE);
  go("notice", `Schedule "${name}" created. It runs with your access rights, so a recipient never receives data beyond your branch scope.`);
}

export async function toggleSchedule(formData: FormData) {
  await assertCan("reports", "edit");
  const id = str(formData, "id");
  const next = str(formData, "nextStatus");
  await prisma.scheduledReport.update({ where: { id }, data: { status: next } });
  await logAudit("ScheduledReport", id, next === "active" ? "resume" : "pause", `Schedule ${next === "active" ? "resumed" : "paused"}`);
  revalidatePath(PAGE);
  redirect(PAGE);
}

// Runs one schedule with its owner's access rights, records the outcome and notifies the owner of a failure.
export async function executeSchedule(scheduleId: string, trigger: "schedule" | "manual" | "retry") {
  const sched = await prisma.scheduledReport.findUniqueOrThrow({ where: { id: scheduleId } });
  const def = reportById(sched.reportType);
  const run = await prisma.scheduledReportRun.create({ data: { reportId: sched.id, status: "failed", trigger } });
  try {
    if (!def) throw new Error(`Report "${sched.reportType}" no longer exists in the catalog`);
    const scope = sched.ownerId ? await scopeForUser(sched.ownerId) : { branchIds: null, role: "admin", userName: sched.createdBy };
    const filters = resolveRelativeDates(sched.filters ? (JSON.parse(sched.filters) as Filters) : {}, sched.relativeDates);
    const result = await def.run(filters, scope);
    const delivery = await sendMessage({ connector: "email", direction: "outbound", docType: "Scheduled report", reference: `${sched.name} (${def.title})`, payload: { recipients: sched.recipientEmails, format: sched.format, rows: result.rows.length } });
    if (delivery.status === "error") throw new Error(`Delivery to ${sched.recipientEmails} failed — ${delivery.error}`);
    await prisma.scheduledReportRun.update({ where: { id: run.id }, data: { status: "success", rowCount: result.rows.length, output: JSON.stringify({ columns: result.columns, rows: result.rows.slice(0, 200), totals: result.totals, filters }) } });
    await prisma.scheduledReport.update({ where: { id: sched.id }, data: { lastRunAt: new Date(), lastRunStatus: "success" } });
    return { ok: true as const, rows: result.rows.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Run failed";
    await prisma.scheduledReportRun.update({ where: { id: run.id }, data: { error: msg } });
    await prisma.scheduledReport.update({ where: { id: sched.id }, data: { lastRunAt: new Date(), lastRunStatus: "failed" } });
    if (sched.ownerId) await notify({ userId: sched.ownerId, title: `Scheduled report failed: ${sched.name}`, body: `${msg}. Open Scheduled Reports to repeat the run.`, link: PAGE, kind: "alert" });
    await notify({ role: "admin", title: `Scheduled report failed: ${sched.name}`, body: msg, link: PAGE, kind: "alert" });
    return { ok: false as const, error: msg };
  }
}

export async function runScheduleNow(formData: FormData) {
  await assertCan("reports", "edit");
  const id = str(formData, "id");
  const trigger = str(formData, "trigger") === "retry" ? "retry" : "manual";
  const r = await executeSchedule(id, trigger);
  revalidatePath(PAGE);
  if (r.ok) go("notice", `Report generated and delivered — ${r.rows} row(s). See the report inbox.`);
  go("error", `The run failed: ${r.error}. The owner has been notified; use "Repeat run" once the cause is fixed.`);
}

// Stands in for the scheduler: runs every active schedule that is due (daily after 20 h, weekly after 6 days,
// monthly after 27 days since the last run).
export async function runDueSchedules() {
  await assertCan("reports", "edit");
  const all = await prisma.scheduledReport.findMany({ where: { status: "active" } });
  const gap: Record<string, number> = { daily: 20, weekly: 6 * 24, monthly: 27 * 24 };
  let ran = 0;
  let failed = 0;
  for (const s of all) {
    const hours = gap[s.frequency ?? "daily"] ?? 20;
    if (s.lastRunAt && Date.now() - s.lastRunAt.getTime() < hours * 3600000) continue;
    const r = await executeSchedule(s.id, "schedule");
    ran++;
    if (!r.ok) failed++;
  }
  revalidatePath(PAGE);
  go(failed ? "error" : "notice", ran === 0 ? "No schedule is due." : `${ran} schedule(s) ran${failed ? `, ${failed} failed — owners were notified` : " successfully"}.`);
}

export async function deleteSchedule(formData: FormData) {
  await assertCan("reports", "approve");
  const id = str(formData, "id");
  await prisma.scheduledReportRun.deleteMany({ where: { reportId: id } });
  await prisma.scheduledReport.delete({ where: { id } });
  await logAudit("ScheduledReport", id, "delete", "Deleted a report schedule");
  revalidatePath(PAGE);
  redirect(PAGE);
}

export async function catalogIds() {
  return REPORTS.map((r) => r.id);
}
