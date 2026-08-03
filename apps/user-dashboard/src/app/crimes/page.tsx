import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { CrimesDashboardView } from "@/components/crimes/crimes-dashboard-view";

export default function CrimesPage() {
  return (
    <DashboardLayout>
      <CrimesDashboardView />
    </DashboardLayout>
  );
}
