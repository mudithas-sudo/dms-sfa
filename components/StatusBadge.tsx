import { STATUS_COLORS } from "@/lib/constants";

function formatLabel(status: string) {
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "slate";
  return <span className={`badge badge-${color}`}>{formatLabel(status)}</span>;
}
