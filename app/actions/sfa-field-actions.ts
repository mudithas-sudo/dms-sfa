"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { getAllSettings, num } from "@/lib/settings";
import { distanceM } from "@/lib/geo";
import { dayStart } from "@/lib/van";
import { savePhotos, hasPhoto } from "@/lib/photos";
import { findDuplicateOutlets } from "@/app/actions/admin-actions";
import { NO_ORDER_REASONS } from "@/lib/field-constants";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const numOf = (f: FormData, k: string, d = 0) => {
  const n = Number(f.get(k));
  return Number.isFinite(n) && String(f.get(k) ?? "") !== "" ? n : d;
};

function go(path: string, kind: "error" | "notice", message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
}

async function rep() {
  const { userId, branchId } = await getSession();
  const user = userId ? await prisma.user.findUnique({ where: { id: userId }, include: { route: true } }) : null;
  return { user, branchId };
}

const WEEKDAY = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// ---------------------------------------------------------------------------
// Check-in: one open visit at a time, location checked against the outlet, out-of-route and mock-location flagged
// ---------------------------------------------------------------------------

export async function checkInVisit(formData: FormData) {
  const { user, branchId } = await rep();
  const outletId = str(formData, "outletId");
  const back = `/sfa/visit/new?outlet=${outletId}`;
  if (!user || !branchId) go(back, "error", "No active session.");
  const outlet = await prisma.outlet.findUnique({ where: { id: outletId } });
  if (!outlet) go(back, "error", "Customer not found.");
  const open = await prisma.fieldVisit.findFirst({ where: { salespersonId: user.id, status: "in_progress" }, include: { outlet: true } });
  if (open) go("/sfa/visit/new", "error", `You are still checked in at ${open.outlet.name}. Check out of it first.`);
  const attendance = await prisma.attendance.findFirst({ where: { userId: user.id, dayDate: { gte: dayStart() } } });
  if (!attendance || attendance.status === "completed") go(back, "error", attendance ? "Your day has ended — ask your supervisor to reopen it to record more visits." : "Start your day (Attendance) before checking in at a customer.");

  const s = await getAllSettings();
  const lat = numOf(formData, "lat", outlet.lat);
  const lng = numOf(formData, "lng", outlet.lng);
  const mock = str(formData, "mock") === "1";
  const dist = distanceM(lat, lng, outlet.lat, outlet.lng);
  const tol = num(s, "visit.toleranceM");
  const outOfTolerance = dist > tol;
  const override = str(formData, "overrideReason");
  if (outOfTolerance) {
    if (s["visit.toleranceMode"] === "block") go(back, "error", `You are ${Math.round(dist)} m from ${outlet.name} — beyond the ${tol} m tolerance, and check-in is blocked outside it. Move closer or ask your supervisor to approve an exception.`);
    if (!override) go(`${back}&far=${Math.round(dist)}`, "error", `You are ${Math.round(dist)} m from ${outlet.name} (tolerance ${tol} m). Give a reason to check in anyway — the supervisor will see the variance.`);
  }

  const today = WEEKDAY[new Date().getDay()];
  const onRoute = user.routeId && outlet.routeId === user.routeId;
  const planned = !!onRoute && (!outlet.visitDay || outlet.visitDay === today);
  const visit = await prisma.fieldVisit.create({
    data: {
      outletId, salespersonId: user.id, checkinLat: lat, checkinLng: lng, status: "in_progress",
      visitType: planned ? "planned" : "unplanned", distanceM: Math.round(dist), outOfTolerance,
      overrideReason: outOfTolerance ? override : null, mockLocation: mock,
    },
  });
  if (mock) {
    await logAudit("FieldVisit", visit.id, "mock_location", `Mock-location signal detected at check-in for ${outlet.name}`, { after: { lat, lng } }, { userId: user.id });
    await notify({ role: "supervisor", branchId, title: "Mock location detected", body: `${user.name} checked in at ${outlet.name} with a mock-location signal.`, link: "/supervisor/coverage", kind: "alert" });
  }
  if (!planned) {
    await prisma.approvalRequest.create({
      data: { type: "out_of_route_visit", refId: visit.id, requestedBy: user.name, amount: 0, branchId, outletId, reason: `${user.name} visited ${outlet.name}, which is ${onRoute ? "not planned for today" : "not on their route"}.` },
    });
    await notify({ role: "supervisor", branchId, title: "Out-of-route visit", body: `${user.name} → ${outlet.name}`, link: "/supervisor/approvals", kind: "approval" });
  }
  await logAudit("FieldVisit", visit.id, "check_in", `${user.name} checked in at ${outlet.name} (${Math.round(dist)} m${outOfTolerance ? ", outside tolerance" : ""}${planned ? "" : ", unplanned"})`, undefined, { userId: user.id });
  revalidatePath("/sfa");
  go("/sfa/visit/new", "notice", `Checked in at ${outlet.name}${outOfTolerance ? " — location variance recorded" : ""}${planned ? "" : " — flagged as an unplanned visit"}.`);
}

export async function checkOutVisit(formData: FormData) {
  const { user, branchId } = await rep();
  const visitId = str(formData, "visitId");
  const back = "/sfa/visit/new";
  if (!user) go(back, "error", "No active session.");
  const visit = await prisma.fieldVisit.findUnique({ where: { id: visitId }, include: { outlet: true } });
  if (!visit || visit.status !== "in_progress") go(back, "error", "That visit is not open.");
  const outcome = str(formData, "outcome");
  const noReason = str(formData, "noOrderReason");
  if (!outcome) go(back, "error", "Choose the visit outcome before checking out.");
  if (outcome === "no_order" && !NO_ORDER_REASONS.includes(noReason)) go(back, "error", "Choose why no order was taken.");
  const rating = numOf(formData, "serviceRating", 0);
  const complaint = str(formData, "complaint");
  const followUp = str(formData, "followUp") === "on";
  const followUpDue = str(formData, "followUpDue");
  if (followUp && !followUpDue) go(back, "error", "Set a follow-up due date.");
  const s = await getAllSettings();

  const now = new Date();
  const minutes = (now.getTime() - visit.checkinAt.getTime()) / 60000;
  const short = minutes < num(s, "visit.minDurationMin");
  const lat = numOf(formData, "lat", visit.outlet.lat);
  const lng = numOf(formData, "lng", visit.outlet.lng);
  await prisma.fieldVisit.update({
    where: { id: visitId },
    data: {
      checkoutAt: now, checkoutLat: lat, checkoutLng: lng, feedback: str(formData, "feedback") || null, status: "completed",
      outcome, noOrderReason: outcome === "no_order" ? noReason : null, serviceRating: rating >= 1 && rating <= 5 ? rating : null,
      complaint: complaint || null, complaintCategory: complaint ? str(formData, "complaintCategory") || "Other" : null,
      followUp, followUpDue: followUp ? new Date(followUpDue) : null, photoPlaceholder: hasPhoto(formData),
    },
  });
  const photos = await savePhotos(formData, { linkedType: "visit", linkedId: visitId, outletId: visit.outletId, photoType: "outlet_front", uploadedBy: user.name, lat, lng });
  await logAudit("FieldVisit", visitId, "check_out", `${user.name} checked out of ${visit.outlet.name} after ${Math.round(minutes)} min — ${outcome.replace(/_/g, " ")}${short ? " (short visit flagged)" : ""}${photos ? `, ${photos} photo(s)` : ""}`, undefined, { userId: user.id });
  if (short) await notify({ role: "supervisor", branchId, title: "Short visit", body: `${user.name} spent ${Math.round(minutes)} min at ${visit.outlet.name}.`, link: "/supervisor/coverage", kind: "info" });
  if (complaint) await notify({ role: "supervisor", branchId, title: "Customer complaint recorded", body: `${visit.outlet.name}: ${complaint.slice(0, 100)}`, link: "/supervisor/coverage", kind: "alert" });
  revalidatePath("/sfa");
  redirect(`/sfa?visit=completed`);
}

// A stop that will not be visited today is skipped with a reason so it shows as an exception, not a silent miss.
export async function skipStop(formData: FormData) {
  const { user } = await rep();
  const outletId = str(formData, "outletId");
  const reason = str(formData, "reason");
  if (!user) go("/sfa/route", "error", "No active session.");
  if (!reason) go("/sfa/route", "error", "Choose a reason for skipping the stop.");
  const outlet = await prisma.outlet.findUniqueOrThrow({ where: { id: outletId } });
  const exists = await prisma.fieldVisit.findFirst({ where: { salespersonId: user.id, outletId, checkinAt: { gte: dayStart() } } });
  if (exists) go("/sfa/route", "error", "That stop already has a visit today.");
  await prisma.fieldVisit.create({ data: { outletId, salespersonId: user.id, checkinLat: outlet.lat, checkinLng: outlet.lng, checkoutAt: new Date(), status: "skipped", skipReason: reason, outcome: "skipped" } });
  await logAudit("FieldVisit", outletId, "skip", `${user.name} skipped ${outlet.name}: ${reason}`, undefined, { userId: user.id });
  revalidatePath("/sfa/route");
  go("/sfa/route", "notice", `${outlet.name} skipped — "${reason}" is reported to your supervisor.`);
}

// ---------------------------------------------------------------------------
// Field execution forms (shelf audit, merchandising insight, competitor observation)
// ---------------------------------------------------------------------------

export async function submitFieldForm(formData: FormData) {
  const { user } = await rep();
  const outletId = str(formData, "outletId");
  const type = str(formData, "type");
  const back = `/sfa/field-notes/new?type=${type}&outlet=${outletId}`;
  if (!user) go(back, "error", "No active session.");
  const visit = await prisma.fieldVisit.findFirst({ where: { salespersonId: user.id, outletId, status: "in_progress" } });
  const data: Record<string, unknown> = {};
  let notes = str(formData, "notes");

  if (type === "shelf_audit") {
    const rows: { productId: string; available: boolean; facings: number; expiryRisk: boolean }[] = [];
    for (const [k] of formData.entries()) {
      if (!k.startsWith("seen_")) continue;
      const pid = k.slice(5);
      rows.push({ productId: pid, available: str(formData, `avail_${pid}`) === "on", facings: numOf(formData, `facings_${pid}`, 0), expiryRisk: str(formData, `exp_${pid}`) === "on" });
    }
    if (rows.length === 0) go(back, "error", "Record at least one product.");
    data.items = rows;
    const out = rows.filter((r) => !r.available).length;
    notes = notes || `Shelf audit: ${rows.length} products checked, ${out} out of stock, ${rows.filter((r) => r.expiryRisk).length} with expiry risk.`;
  } else if (type === "merchandising") {
    data.display = str(formData, "display");
    data.posm = str(formData, "posm") === "on";
    data.shelfSharePct = numOf(formData, "shelfShare", 0);
    data.opportunity = str(formData, "opportunity");
    if (!data.display) go(back, "error", "Choose the display type.");
    notes = notes || `Merchandising: ${data.display}, POSM ${data.posm ? "present" : "missing"}, shelf share ${data.shelfSharePct}%${data.opportunity ? ` — ${data.opportunity}` : ""}`;
  } else if (type === "competitor") {
    data.brand = str(formData, "brand");
    data.product = str(formData, "product");
    data.price = numOf(formData, "price", 0);
    data.promotion = str(formData, "promotion");
    if (!data.brand || !data.product) go(back, "error", "Choose the competitor brand and enter the product observed.");
    notes = notes || `Competitor ${data.brand}: ${data.product}${data.price ? ` at ₱${data.price}` : ""}${data.promotion ? `, promotion: ${data.promotion}` : ""}`;
  } else go(back, "error", "Unknown form.");

  const note = await prisma.fieldNote.create({ data: { outletId, salespersonId: user.id, type, notes, data: JSON.stringify(data), photoPlaceholder: hasPhoto(formData) } });
  await savePhotos(formData, { linkedType: type, linkedId: note.id, outletId, photoType: type === "competitor" ? "competitor" : "shelf", uploadedBy: user.name });
  await logAudit("FieldNote", note.id, "create", `${user.name} submitted a ${type.replace("_", " ")} for outlet ${outletId.slice(-6)}${visit ? " during a visit" : ""}`, undefined, { userId: user.id });
  go("/sfa", "notice", "Form submitted — it appears in the supervisor's field activity.");
}

// ---------------------------------------------------------------------------
// New customer from the field
// ---------------------------------------------------------------------------

export async function registerCustomer(formData: FormData) {
  const { user, branchId } = await rep();
  const resubmitId = str(formData, "resubmitId");
  const back = `/sfa/customers/new${resubmitId ? `?edit=${resubmitId}` : ""}`;
  if (!user || !branchId) go(back, "error", "No active session.");
  const name = str(formData, "name");
  const channelId = str(formData, "channelId");
  const subChannel = str(formData, "subChannel");
  const address = str(formData, "address");
  const lat = numOf(formData, "lat", 14.5995);
  const lng = numOf(formData, "lng", 120.9842);
  if (!name || !channelId || !subChannel || !address) go(back, "error", "Business name, channel, sub-channel and address are required.");
  if (!hasPhoto(formData) && !(resubmitId && str(formData, "keepPhoto") === "1")) go(back, "error", "Take a photo of the outlet front — it is required for registration.");

  if (str(formData, "confirmDuplicate") !== "1") {
    const dups = await findDuplicateOutlets(name, address, lat, lng, resubmitId || undefined);
    if (dups.length) {
      const list = dups.slice(0, 3).map((d) => `${d.name} (${d.code ?? "pending"})`).join(", ");
      go(`${back}${back.includes("?") ? "&" : "?"}dups=${encodeURIComponent(list)}`, "error", `Possible duplicate: ${list}. Tick "This is a different outlet" to continue.`);
    }
  }
  const photo = str(formData, "photoData");
  const common = {
    name, channelId, subChannel, address, lat, lng,
    contactPerson: str(formData, "contactPerson") || null, ownerName: str(formData, "ownerName") || null, phone: str(formData, "phone") || null,
    businessRegRef: str(formData, "businessRegRef") || null, proposedVisitDay: str(formData, "visitDay") || null,
    proposedRoute: str(formData, "proposedRoute") || null, remarks: str(formData, "remarks") || null,
    ...(photo.startsWith("data:image") ? { photoData: photo } : {}),
  };
  if (resubmitId) {
    const o = await prisma.outlet.findUnique({ where: { id: resubmitId } });
    if (!o || o.createdById !== user.id || o.onboardingStatus !== "returned") go(back, "error", "Only a registration returned to you can be resubmitted.");
    await prisma.outlet.update({ where: { id: resubmitId }, data: { ...common, onboardingStatus: "pending", onboardingReason: null } });
    await logAudit("Outlet", resubmitId, "resubmit", `${user.name} corrected and resubmitted "${name}"`, undefined, { userId: user.id });
  } else {
    const o = await prisma.outlet.create({ data: { ...common, branchId, creditLimit: 0, status: "inactive", onboardingStatus: "pending", routeId: user.routeId, createdById: user.id } });
    await logAudit("Outlet", o.id, "create", `${user.name} registered "${name}" from the field — pending approval`, { after: { name, address } }, { userId: user.id });
  }
  await notify({ role: "supervisor", branchId, title: resubmitId ? "Registration resubmitted" : "New customer registration", body: `${name} — ${user.name}`, link: "/supervisor/onboarding", kind: "approval" });
  go("/sfa", "notice", `${name} was sent for approval. Your supervisor assigns the route, price list and credit terms.`);
}
