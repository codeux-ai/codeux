import type { FunctionComponent } from "preact";
import { Layers3 } from "lucide-preact";
import type { ProjectExecutionStatsSnapshot } from "../../../types.js";
import { formatStatsDuration } from "../stats-utils.js";
import {
  SUBPANEL_CLASS,
  StudioHeader,
  CHIP_CLASS,
} from "./StatsShared.js";
import { TelemetryLedgerTabs } from "./TelemetryLedgerTabs.js";

export interface TelemetrySectionsSectionProps {
  stats: ProjectExecutionStatsSnapshot;
}

export const TelemetrySectionsSection: FunctionComponent<TelemetrySectionsSectionProps> = ({ stats }) => {
  return (
    <section className="min-w-0 space-y-4">
      <div className={`${SUBPANEL_CLASS} flex min-w-0 flex-col gap-4 p-4 md:flex-row md:items-end md:justify-between`}>
        <StudioHeader
          icon={Layers3}
          eyebrow="Telemetry Ledgers"
          title="Task and sprint telemetry"
          description={`Compact operational records for execution scopes, search, recency, sorting, and usage breakdowns. — ${stats.range.label}`}
        />
        <div className="flex shrink-0 flex-wrap gap-2">
          <span className={`${CHIP_CLASS} px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em]`}>{stats.purposes.length} Purpose Types</span>
          <span className={`${CHIP_CLASS} px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em]`}>{formatStatsDuration(stats.usage.activeTimeMs)} Active Time</span>
        </div>
      </div>
      <TelemetryLedgerTabs stats={stats} />
    </section>
  );
};
