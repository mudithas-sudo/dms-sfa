// Reason codes for stock adjustments (configurable list in the live system).
export const ADJUST_REASONS = [
  { id: "damage", label: "Damage", needsNote: false },
  { id: "expiry", label: "Expiry", needsNote: false },
  { id: "count_variance", label: "Count variance", needsNote: false },
  { id: "loss_theft", label: "Loss or theft", needsNote: true },
  { id: "data_entry", label: "Data entry correction", needsNote: true },
  { id: "sample_promo", label: "Sample or promotional use", needsNote: false },
] as const;

export const RETURN_REASONS = [
  { id: "damaged", label: "Damaged" },
  { id: "expired", label: "Expired" },
  { id: "quality_issue", label: "Quality issue" },
  { id: "other", label: "Other" },
] as const;

export const RETURN_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending: "Pending approval",
  approved: "Approved",
  shipped: "In transit",
  received: "Received",
  posted_to_erp: "Posted to ERP",
  rejected: "Rejected",
  cancelled: "Cancelled",
};
