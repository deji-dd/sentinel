import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { LiveTelemetryDashboard } from "@/components/telemetry/live-telemetry-dashboard";

export default function TelemetryPage() {
  return (
    <DashboardLayout>
      <LiveTelemetryDashboard />
    </DashboardLayout>
  );
}
