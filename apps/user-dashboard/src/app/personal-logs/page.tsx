import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { PersonalLogsDashboard } from "@/components/personal-logs/personal-logs-dashboard";

export default function PersonalLogsPage() {
  return (
    <DashboardLayout>
      <PersonalLogsDashboard />
    </DashboardLayout>
  );
}
