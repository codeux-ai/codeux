import type { FunctionComponent } from "preact";
import { Layers3 } from "lucide-preact";
import type { ProjectExecutionStatsSnapshot } from "../../../types.js";
import {
  PANEL_CLASS,
  StudioHeader,
} from "./StatsShared.js";
import { TelemetryLedgerTabs } from "./TelemetryLedgerTabs.js";

export interface TelemetrySectionsSectionProps {
  stats: ProjectExecutionStatsSnapshot;
}

export const TelemetrySectionsSection: FunctionComponent<TelemetrySectionsSectionProps> = ({ stats }) => {
  return (
    <section className="space-y-6">
      <div className={`${PANEL_CLASS} rounded-[2.2rem] p-6 md:p-7`}>
        <StudioHeader
          icon={Layers3}
          eyebrow="Telemetry Ledgers"
          title="Task and sprint telemetry"
          description="Deep operational ledgers for execution scopes, redesigned around search, recency, sort controls, and richer usage breakdowns."
        />
      </div>
      <TelemetryLedgerTabs stats={stats} />
    </section>
  );
};
