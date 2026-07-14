import type { FunctionComponent } from "preact";
import { Layers3 } from "lucide-preact";
import type { ProjectExecutionStatsSnapshot } from "../../../types.js";
import { formatStatsDuration } from "../stats-utils.js";
import {
  PANEL_CLASS,
  StudioHeader,
  CHIP_CLASS,
} from "./StatsShared.js";
import { TelemetryLedgerTabs } from "./TelemetryLedgerTabs.js";
import { useStatsI18n } from "../stats-i18n.js";

export interface TelemetrySectionsSectionProps {
  stats: ProjectExecutionStatsSnapshot;
}

export const TelemetrySectionsSection: FunctionComponent<TelemetrySectionsSectionProps> = ({ stats }) => {
  const { locale, formatNumber } = useStatsI18n();
  return (
    <section className="space-y-6">
      <div className={`${PANEL_CLASS} rounded-[2.2rem] p-6 md:p-7`}>
        <div className="mb-6 flex flex-wrap gap-2">
          <span className={CHIP_CLASS}>{formatNumber(stats.purposes.length)} {locale === "de" ? "Zwecktypen" : "Purpose Types"}</span>
          <span className={CHIP_CLASS}>{formatStatsDuration(stats.usage.activeTimeMs, locale)} {locale === "de" ? "aktive Zeit" : "Active Time"}</span>
        </div>
        <StudioHeader
          icon={Layers3}
          eyebrow={locale === "de" ? "Telemetrieprotokolle" : "Telemetry Ledgers"}
          title={locale === "de" ? "Aufgaben- und Sprint-Telemetrie" : "Task and sprint telemetry"}
          description={locale === "de" ? `Detaillierte operative Protokolle für Ausführungsbereiche mit Suche, Aktualität, Sortierung und umfangreicheren Nutzungsaufschlüsselungen. — ${stats.range.label}` : `Deep operational ledgers for execution scopes, redesigned around search, recency, sort controls, and richer usage breakdowns. — ${stats.range.label}`}
        />
      </div>
      <TelemetryLedgerTabs stats={stats} />
    </section>
  );
};
