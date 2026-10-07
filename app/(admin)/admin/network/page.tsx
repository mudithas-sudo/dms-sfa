import NetworkView from "@/components/NetworkView";

export default async function NetworkPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days } = await searchParams;
  return <NetworkView reportsBase="/admin/reports" days={Math.max(1, Math.min(365, Number(days) || 30))} />;
}
