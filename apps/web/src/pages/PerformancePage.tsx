import { PageHead } from "../components/ui.tsx";
import PerformancePanel from "../components/PerformancePanel.tsx";

/** An advisor's own performance workspace: plan, projection, badges and activity log. */
export default function PerformancePage() {
  return (
    <div>
      <PageHead title="My Performance" subtitle="Your sales plan, activity-adjusted projection and badges" />
      <PerformancePanel />
    </div>
  );
}
