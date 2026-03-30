import type { FunctionComponent } from "preact";
import { Layers3 } from "lucide-preact";
import {
  PANEL_CLASS,
  StudioHeader,
  TelemetryLedger,
} from "./StatsShared.js";

export const TelemetrySectionsSection: FunctionComponent<any> = ({ stats }) => {
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
      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
        <TelemetryLedger
          title="Task Telemetry"
          eyebrow="Task Ledger"
          items={stats.tasks}
          kindLabel="tasks"
          emptyLabel="No task telemetry landed in this window yet."
        />
        <TelemetryLedger
          title="Sprint Telemetry"
          eyebrow="Sprint Ledger"
          items={stats.sprints}
          kindLabel="sprints"
          emptyLabel="No sprint telemetry active in this window."
        />
      </div>
    </section>
  );
};
