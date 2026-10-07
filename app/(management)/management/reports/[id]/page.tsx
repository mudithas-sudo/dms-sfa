import ReportRunner from "@/components/reports/ReportRunner";

export default async function ReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  return <ReportRunner id={id} basePath="/management/reports" params={await searchParams} />;
}
