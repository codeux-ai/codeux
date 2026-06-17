import type { FunctionComponent } from "preact";
import { Layers3 } from "lucide-preact";
import type { ProjectExecutionStatsSnapshot } from "../../../types.js";
import { formatDuration } from "../stats-utils.js";
import {
  PANEL_CLASS,
  StudioHeader,
  CHIP_CLASS,
} from "./StatsShared.js";
import { TelemetryLedgerTabs } from "./TelemetryLedgerTabs.js";

export interface TelemetrySectionsSectionProps {
  stats: ProjectExecutionStatsSnapshot;
}

export const TelemetrySectionsSection: FunctionComponent<TelemetrySectionsSectionProps> = ({ stats }) => {
  return (
    <section className="space-y-6">
      <div className={`${PANEL_CLASS} rounded-[2.2rem] p-6 md:p-7`}>
        <div className="mb-6 flex flex-wrap gap-2">
          <span className={CHIP_CLASS}>{stats.purposes.length} Purpose Types</span>
          <span className={CHIP_CLASS}>{formatDuration(stats.usage.activeTimeMs)} Active Time</span>
        </div>
        <StudioHeader
          icon={Layers3}
          eyebrow="Telemetry Ledgers"
          title="Task and sprint telemetry"
          description={`Deep operational ledgers for execution scopes, redesigned around search, recency, sort controls, and richer usage breakdowns. — ${stats.range.label}`}
        />
      </div>
      <TelemetryLedgerTabs stats={stats} />
    </section>
  );
};
