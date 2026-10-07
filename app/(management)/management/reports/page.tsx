import ReportCatalog from "@/components/reports/ReportCatalog";
import { visibleReports } from "@/lib/report-runner";

export default async function ReportsPage() {
  return <ReportCatalog reports={await visibleReports()} basePath="/management/reports" />;
}
