export const ROLES = [
  { id: "admin", label: "Central Administrator", homePath: "/admin" },
  { id: "branch_ops", label: "Branch / Warehouse Operations", homePath: "/branch" },
  { id: "supervisor", label: "Sales & Finance Supervisor", homePath: "/supervisor" },
  { id: "sales_rep", label: "Field Sales Representative", homePath: "/sfa" },
  { id: "management", label: "Management & Reporting", homePath: "/management" },
] as const;

export type RoleId = (typeof ROLES)[number]["id"];

export const ROLE_COOKIE = "dms_role";
export const BRANCH_COOKIE = "dms_branch";
export const USER_COOKIE = "dms_user";

export function roleLabel(id: string): string {
  return ROLES.find((r) => r.id === id)?.label ?? id;
}

export const STATUS_COLORS: Record<string, string> = {
  active: "green",
  on_track: "green",
  approved: "green",
  paid: "green",
  delivered: "green",
  completed: "green",
  settled: "green",
  closed: "green",
  fulfilled: "green",
  processed: "green",
  issued: "green",
  good: "green",
  simulated: "green",
  posted: "green",
  posted_to_erp: "green",
  received: "green",
  resolved: "green",
  acknowledged: "green",
  matched: "green",
  cleared: "green",
  applied: "green",
  fully_allocated: "green",

  pending: "amber",
  submitted: "amber",
  reviewed: "amber",
  draft: "amber",
  in_progress: "amber",
  partially_received: "amber",
  partially_paid: "amber",
  confirmed: "amber",
  open: "amber",
  exception: "amber",
  pending_approval: "amber",
  in_transit: "amber",
  shipped: "amber",
  recount_required: "amber",
  pending_review: "amber",
  returned: "amber",
  on_watch: "amber",
  discrepancy: "amber",
  partially_allocated: "amber",
  partially_approved: "amber",
  settlement_pending: "amber",
  generated: "amber",
  picked: "green",
  invoiced: "amber",
  partially_delivered: "amber",
  pending_delivery: "amber",
  out_for_delivery: "amber",
  redelivery_scheduled: "amber",
  not_allocated: "slate",
  dispatched: "green",
  suspended: "amber",
  proposed: "amber",
  under_review: "amber",

  overdue: "red",
  damaged: "red",
  rejected: "red",
  voided: "red",
  void: "red",
  cancelled: "red",
  inactive: "red",
  failed: "red",
  blocked: "red",
  on_hold: "red",
  reversed: "red",
  discarded: "red",
  expired: "red",
  discontinued: "red",
  ended: "red",
  error: "red",
  unpaid: "red",
};

// Free-text `type` values used across the new ApprovalRequest / FieldNote /
// AuditLog records — kept here so seed data and UI copy stay in sync.
export const APPROVAL_TYPES = [
  "credit_limit_exception",
  "discount_override",
  "stock_shortage",
  "price_promo_mismatch",
  "order_void",
  "ar_reversal",
] as const;

export const FIELD_NOTE_TYPES = ["shelf_audit", "merchandising", "competitor"] as const;

export const AI_INSIGHTS_BADGE = "Optional capability — priced separately";

export const LAST_SYNC_LABEL = "Last synced: Today 06:00 AM (stubbed ERP sync)";

// Section 5 of the proposal — data exchange happens only through defined,
// agreed interfaces behind a single API gateway. None of these are real
// connections in this prototype; each is a static, clearly-labeled stub.
export const INTEGRATIONS = [
  {
    name: "ERP System",
    value:
      "Exchanges product/SKU master data, purchase and invoice references, returns and credit-related information through an agreed posting interface — keeping the DMS and the ERP consistent without manual re-entry.",
    lastSync: "Today 06:00 AM",
  },
  {
    name: "Mobile SFA Application",
    value:
      "Orders, returns, payments, van invoices, inventory movements and reference data (customer, product, pricing) flow bidirectionally between the DMS and the SFA app, kept in sync continuously rather than through periodic file transfer.",
    lastSync: "Live — continuous sync",
  },
  {
    name: "Merchandising Application",
    value:
      "Physical inventory observations, approved returns, near-expiry signals and suggested order quantities are exchanged via API, so merchandising insight feeds directly into replenishment and stock decisions.",
    lastSync: "Today 06:00 AM",
  },
  {
    name: "Trade Promotion / Workflow Application",
    value:
      "Promotion setup, eligibility and claim/approval statuses are exchanged as agreed, keeping promotional data consistent across systems.",
    lastSync: "Today 06:00 AM",
  },
  {
    name: "Business Intelligence Environment",
    value:
      "A governed, authorized data feed delivers operational and management reporting data to the client's BI environment for cross-functional analytics.",
    lastSync: "Today 06:15 AM",
  },
] as const;

// Section 5.1 — infrastructure-level commitments described narratively in
// the proposal; not something a prototype can demonstrate, so shown as
// static reference information only.
export const SECURITY_MEASURES = [
  {
    title: "Data Protection",
    detail:
      "Data is encrypted both at rest and in transit. Privileged-user multi-factor authentication and enterprise SSO integration protect administrative access.",
  },
  {
    title: "Access Control",
    detail:
      "Access is managed by role and branch, so users see only the information and features relevant to their scope. MDM-compatible mobile deployment extends the same control to field devices.",
  },
  {
    title: "Infrastructure Security",
    detail:
      "Hosted on Microsoft Azure with Azure SQL, a high-availability configuration targeting 99.9% monthly uptime, managed backups meeting a recovery point objective of no more than four hours, and OWASP-aligned application security testing with coordinated penetration testing ahead of go-live.",
  },
] as const;

export const PLATFORM_SCALE_NOTE =
  "Engineered for Company F and B's planned user base — up to 250 DMS users and 600 SFA users — with headroom for annual growth.";

// Section 4.4.1 — central administrators govern the mobile fleet: rollout
// and device compatibility under enterprise MDM, and the approved hardware
// list for field-generated receipts. Static reference data in this prototype.
export const MDM_POLICY_NOTE =
  "SFA app rollout and Android device compatibility are governed under Company F and B's enterprise MDM policy — app deployment, device enrollment and compliance are managed centrally rather than per device.";

export const APPROVED_PRINTERS = [
  { model: "Bixolon SPP-R310", connection: "Bluetooth", status: "approved" },
  { model: "Epson TM-P20", connection: "Bluetooth", status: "approved" },
  { model: "Zebra ZQ320", connection: "Bluetooth", status: "approved" },
  { model: "HPRT HM-A300L", connection: "Bluetooth", status: "under_review" },
] as const;
