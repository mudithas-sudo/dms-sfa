// Client-safe list of payment modes (lib/finance.ts pulls in server-only code).
export const PAYMENT_MODES = [
  { id: "cash", label: "Cash" },
  { id: "cheque", label: "Cheque" },
  { id: "bank_transfer", label: "Bank transfer" },
  { id: "other", label: "Other (e-wallet / deposit slip)" },
] as const;
