// Every kind of request that reaches the approvals queue, who handles it by default, and which setting holds its
// value limit. Administrators can move a type to "head office only" on the Approval Authority screen.

export interface ApprovalTypeDef {
  id: string;
  label: string;
  area: string;
  limit?: { key: string; label: string };
}

export const APPROVAL_TYPES: ApprovalTypeDef[] = [
  { id: "credit_limit_exception", label: "Credit-limit exception", area: "Sales", limit: { key: "credit.supervisorMaxExcess", label: "Excess over limit the supervisor may approve (₱)" } },
  { id: "overdue_balance", label: "Order for a customer with overdue balance", area: "Sales" },
  { id: "stock_shortage", label: "Stock shortage on an order", area: "Sales" },
  { id: "duplicate_order", label: "Possible duplicate order", area: "Sales" },
  { id: "discount_override", label: "Discount beyond the rules", area: "Sales", limit: { key: "discount.supervisorMaxPct", label: "Discount % the supervisor may approve" } },
  { id: "order_void", label: "Void of an invoiced order", area: "Sales", limit: { key: "cancel.supervisorMaxValue", label: "Order value the supervisor may void (₱)" } },
  { id: "order_cancel", label: "Cancellation of an allocated order", area: "Sales", limit: { key: "cancel.supervisorMaxValue", label: "Order value the supervisor may cancel (₱)" } },
  { id: "ar_reversal", label: "Reversal of a posted payment / credit note", area: "Finance" },
  { id: "cheque_bounce", label: "Bounced cheque (after clearing)", area: "Finance" },
  { id: "fin_doc", label: "Debit note / adjustment / write-off", area: "Finance", limit: { key: "finance.docSupervisorLimit", label: "Amount the supervisor may approve (₱); write-offs are always head office" } },
  { id: "credit_note", label: "Credit note", area: "Finance", limit: { key: "creditNote.supervisorLimit", label: "Credit note the supervisor may approve (₱)" } },
  { id: "fixed_discount", label: "Standing customer discount", area: "Commercial" },
  { id: "claim_exception", label: "Promotion claim above the eligible amount", area: "Commercial", limit: { key: "finance.docSupervisorLimit", label: "Excess the supervisor may approve (₱)" } },
  { id: "stock_reclass", label: "Bad stock back to good", area: "Inventory" },
  { id: "return_outside_policy", label: "Market return outside the return policy", area: "Field" },
  { id: "out_of_route_visit", label: "Visit outside the planned route", area: "Field" },
];

export const typeLabel = (id: string) => APPROVAL_TYPES.find((t) => t.id === id)?.label ?? id.replace(/_/g, " ");
