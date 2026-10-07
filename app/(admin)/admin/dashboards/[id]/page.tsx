import DashboardView from "@/components/dashboards/DashboardView";

export default async function DashboardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  return <DashboardView id={id} basePath="/admin/dashboards" reportsBase="/admin/reports" params={await searchParams} />;
}
