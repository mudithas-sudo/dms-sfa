export const VISIT_OUTCOMES = [
  { id: "order_taken", label: "Order taken" },
  { id: "collection_only", label: "Collection only" },
  { id: "no_order", label: "No order" },
  { id: "outlet_closed", label: "Outlet closed" },
  { id: "owner_not_available", label: "Owner not available" },
];

export const NO_ORDER_REASONS = ["Overstocked", "No cash / credit blocked", "Competitor deal", "Owner decides later", "Product not wanted", "Price too high", "Other"];

export const SKIP_REASONS = ["Outlet closed", "Owner away", "Road / access problem", "Out of time", "Customer asked to skip", "Vehicle problem", "Other"];

export const COMPLAINT_CATEGORIES = ["Delivery", "Product quality", "Pricing", "Promotion", "Service", "Other"];

export const COMPETITOR_BRANDS = ["Competitor A", "Competitor B", "Competitor C", "Local brand", "Private label", "Other"];

export const DISPLAY_TYPES = ["Shelf", "Floor stack", "End-cap", "Chiller", "Counter", "None"];

export const RETURN_REASON_LABELS: Record<string, string> = {
  damaged: "Damaged",
  expired: "Expired",
  near_expiry: "Near expiry",
  wrong_item: "Wrong item delivered",
  overstock: "Overstock",
  quality_complaint: "Quality complaint",
};

export const TASK_STATUS_LABEL: Record<string, string> = {
  pending: "Assigned",
  acknowledged: "Acknowledged",
  in_progress: "In progress",
  completed: "Completed",
  not_completed: "Not completed",
  cancelled: "Cancelled",
};

export const LEAVE_TYPES = [
  { id: "annual", label: "Annual leave" },
  { id: "sick", label: "Sick leave" },
  { id: "emergency", label: "Emergency leave" },
];

export const EXPENSE_CATEGORIES = ["travel", "meals", "fuel", "parking", "other"];
