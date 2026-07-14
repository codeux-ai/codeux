import type { ComponentChild, ComponentChildren, FunctionComponent, JSX } from "preact";
import { useMemo, useRef, useState } from "preact/hooks";
import {
  Activity,
  Clock,
  Database,
  AlertTriangle,
  Inbox,
  ShieldCheck,
  Terminal,
  TrendingUp,
  Zap,
  type LucideIcon,
} from "lucide-preact";
import { useSystemViewData, type SystemSummaryMetrics } from "../../../../pages/stats/hooks/use-system-view-data.js";
import { formatStatsDuration, formatTokens } from "../../stats-utils.js";
import {
  PANEL_CLASS,
  SUBPANEL_CLASS,
  CHIP_CLASS,
  CONTROL_FOCUS_CLASS,
  StudioHeader,
  STATUS_TONE_CLASS,
  TAB_ACTIVE_CLASS,
  TAB_COUNT_ACTIVE_CLASS,
  TAB_COUNT_IDLE_CLASS,
  TAB_IDLE_CLASS,
  TRACK_CLASS,
} from "../StatsShared.js";
import { SystemFilterBar } from "./SystemFilterBar.js";
import { InvocationsTable } from "./InvocationsTable.js";
import { useStatsI18n } from "../../stats-i18n.js";

type SystemTab = "all" | "errors" | "system";

const SystemMetricCard: FunctionComponent<{
  icon: LucideIcon;
  label: string;
  value: string;
  detail: ComponentChild;
  circleClassName: string;
  valueClassName?: string;
}> = ({ icon: Icon, label, value, detail, circleClassName, valueClassName }) => (
  <div className={`${SUBPANEL_CLASS} flex min-h-[7.5rem] flex-col justify-between p-4`}>
    <div className="flex items-start justify-between gap-3">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--stats-chip-radius)] ${circleClassName}`}>
        <Icon className="h-4 w-4" strokeWidth={2.25} />
      </div>
      <div className="text-right text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--stats-label-color)]">
        {label}
      </div>
    </div>
    <div className={`mt-4 break-words text-xl font-semibold tracking-tight tabular-nums md:text-2xl ${valueClassName || "text-[color:var(--stats-value-color)]"}`}>
      {value}
    </div>
    <div className="mt-1 text-[11px] font-semibold leading-snug text-[color:var(--stats-detail-color)]">
      {detail}
    </div>
  </div>
);

const STATUS_BAR_SEGMENTS: Array<{
  key: keyof Pick<SystemSummaryMetrics, "completedCount" | "runningCount" | "failedCount" | "cancelledCount" | "pausedCount">;
  label: string;
  barClassName: string;
  dotClassName: string;
}> = [
  { key: "completedCount", label: "Completed", barClassName: "bg-[color:var(--stats-positive-text)]", dotClassName: "bg-[color:var(--stats-positive-text)]" },
  { key: "runningCount", label: "Running", barClassName: "bg-[color:var(--stats-signal-text)]", dotClassName: "bg-[color:var(--stats-signal-text)]" },
  { key: "failedCount", label: "Failed", barClassName: "bg-[color:var(--stats-negative-text)]", dotClassName: "bg-[color:var(--stats-negative-text)]" },
  { key: "cancelledCount", label: "Cancelled", barClassName: "bg-[color:var(--stats-detail-color)]", dotClassName: "bg-[color:var(--stats-detail-color)]" },
  { key: "pausedCount", label: "Paused", barClassName: "bg-[color:var(--stats-warning-text)]", dotClassName: "bg-[color:var(--stats-warning-text)]" },
];

const StatusDistributionBar: FunctionComponent<{ metrics: SystemSummaryMetrics }> = ({ metrics }) => {
  const { locale, formatNumber } = useStatsI18n();
  const total = STATUS_BAR_SEGMENTS.reduce((sum, segment) => sum + metrics[segment.key], 0);
  if (total === 0) {
    return null;
  }

  return (
    <div className={`${SUBPANEL_CLASS} p-4`} aria-label={locale === "de" ? "Statusverteilung" : "Status distribution"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Statusverteilung" : "Status Distribution"}</div>
        <div className="flex flex-wrap items-center gap-3">
          {STATUS_BAR_SEGMENTS.filter((segment) => metrics[segment.key] > 0).map((segment) => (
            <div key={segment.key} className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-detail-color)]">
              <span className={`h-2 w-2 rounded-full ${segment.dotClassName}`} />
              <span>{locale === "de" ? ({ completedCount: "Abgeschlossen", runningCount: "Laufend", failedCount: "Fehlgeschlagen", cancelledCount: "Abgebrochen", pausedCount: "Pausiert" } as const)[segment.key] : segment.label}</span>
              <span className="tabular-nums text-[color:var(--stats-value-color)]">{formatNumber(metrics[segment.key])}</span>
            </div>
          ))}
        </div>
      </div>
      <div className={`mt-3 flex h-2.5 w-full overflow-hidden rounded-full ${TRACK_CLASS}`}>
        {STATUS_BAR_SEGMENTS.map((segment) => {
          const count = metrics[segment.key];
          if (count === 0) return null;
          return (
            <div
              key={segment.key}
              className={`h-full ${segment.barClassName} transition-[width] duration-500`}
              style={{ width: `${(count / total) * 100}%` }}
              title={`${locale === "de" ? ({ completedCount: "Abgeschlossen", runningCount: "Laufend", failedCount: "Fehlgeschlagen", cancelledCount: "Abgebrochen", pausedCount: "Pausiert" } as const)[segment.key] : segment.label}: ${formatNumber(count)}`}
            />
          );
        })}
      </div>
    </div>
  );
};

const StudioSectionHeader: FunctionComponent<{
  eyebrow: string;
  title: string;
  description?: string;
  action?: ComponentChild;
}> = ({ eyebrow, title, description, action }) => (
  <div className="flex flex-wrap items-start justify-between gap-3">
    <div className="min-w-0 max-w-3xl">
      <div className={`inline-flex px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--stats-label-color)] ${CHIP_CLASS}`}>
        {eyebrow}
      </div>
      <div className="mt-3 text-lg font-semibold tracking-tight text-[color:var(--stats-value-color)]">{title}</div>
      {description ? (
        <div className="mt-1.5 max-w-3xl text-sm leading-relaxed text-[color:var(--stats-detail-color)]">{description}</div>
      ) : null}
    </div>
    {action ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{action}</div> : null}
  </div>
);

const SystemAdminSection: FunctionComponent<{
  eyebrow: string;
  title: string;
  description: string;
  action?: ComponentChild;
  children: ComponentChildren;
}> = ({ eyebrow, title, description, action, children }) => (
  <section className={`${PANEL_CLASS} p-5 md:p-6`} aria-label={title}>
    <StudioSectionHeader eyebrow={eyebrow} title={title} description={description} action={action} />
    <div className="mt-6">{children}</div>
  </section>
);

const SectionCount: FunctionComponent<{
  label: string;
  value: number;
  tone?: keyof typeof STATUS_TONE_CLASS;
}> = ({ label, value, tone = "neutral" }) => {
  const { formatNumber } = useStatsI18n();
  return (
  <div className={`inline-flex h-8 items-center gap-2 rounded-full px-3 text-[10px] font-bold uppercase tracking-[0.16em] ${STATUS_TONE_CLASS[tone]}`}>
    <span>{label}</span>
    <span className="tabular-nums text-[color:var(--stats-value-color)]">{formatNumber(value)}</span>
  </div>
  );
};

const SystemFeedbackState: FunctionComponent<{
  icon: LucideIcon;
  title: string;
  detail: string;
  role: "status" | "alert";
  ariaLabel: string;
  tone?: keyof typeof STATUS_TONE_CLASS;
}> = ({ icon: Icon, title, detail, role, ariaLabel, tone = "neutral" }) => (
  <div
    role={role}
    aria-label={ariaLabel}
    aria-live={role === "status" ? "polite" : undefined}
    className={`${SUBPANEL_CLASS} flex min-w-0 flex-col gap-3 p-4 text-left sm:flex-row sm:items-start`}
  >
    <div className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--stats-chip-radius)] ${STATUS_TONE_CLASS[tone]}`}>
      <Icon className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
    </div>
    <div className="min-w-0">
      <div className="text-sm font-bold text-[color:var(--stats-value-color)]">{title}</div>
      <div className="mt-1 text-sm leading-relaxed text-[color:var(--stats-detail-color)]">{detail}</div>
    </div>
  </div>
);

const formatExternalApiLabel = (key: string): string => key.charAt(0).toUpperCase() + key.slice(1);

const formatErrorCategoryLabel = (category: string): string => {
  if (category === "rateLimit") return "Rate Limit";
  if (category === "apiError") return "API Error";
  if (category === "modelError") return "Model Error";
  return category.charAt(0).toUpperCase() + category.slice(1);
};

const getErrorCategoryTone = (category: string): string => {
  if (category === "timeout" || category === "rateLimit") {
    return "bg-[color:var(--stats-warning-text)]";
  }
  if (category === "cancelled") {
    return "bg-[color:var(--stats-detail-color)]";
  }
  return "bg-[color:var(--stats-negative-text)]";
};

export const SystemStudio: FunctionComponent<{ projectId: string }> = ({ projectId }) => {
  const { locale, formatNumber, formatPercentage, text } = useStatsI18n();
  const {
    invocations,
    summaryMetrics,
    availablePurposes,
    availableProviders,
    filters,
    setFilters,
    search,
    setSearch,
    sort,
    setSort,
    loading,
    error,
    refetch,
    externalApiMetrics,
    sprintStateSummary,
    errorsByCategory,
    page,
    setPage,
    hasMore,
    totalCount,
  } = useSystemViewData(projectId);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SystemTab>("all");
  const recordViewRefs = useRef<Record<SystemTab, HTMLButtonElement | null>>({
    all: null,
    errors: null,
    system: null,
  });

  void refetch;

  const errorCount = useMemo(() => {
    return invocations.filter((invocation) => invocation.status === "failed" || invocation.status === "cancelled").length;
  }, [invocations]);

  const systemCount = useMemo(() => {
    return invocations.filter((invocation) => {
      const type = (invocation.type || "").toLowerCase();
      return type.includes("system") || type.includes("message") || Boolean(invocation.lastErrorMessage);
    }).length;
  }, [invocations]);

  const tabbedInvocations = useMemo(() => {
    if (activeTab === "errors") {
      return invocations.filter((invocation) => invocation.status === "failed" || invocation.status === "cancelled");
    }

    if (activeTab === "system") {
      const systemMatches = invocations.filter((invocation) => {
        const type = (invocation.type || "").toLowerCase();
        return type.includes("system") || type.includes("message");
      });

      if (systemMatches.length > 0) {
        return systemMatches;
      }

      return invocations.filter((invocation) => Boolean(invocation.lastErrorMessage));
    }

    return invocations;
  }, [activeTab, invocations]);

  const successRateLabel = summaryMetrics.successRate !== null
    ? formatPercentage(summaryMetrics.successRate, { maximumFractionDigits: 0 })
    : "—";
  const successTone = summaryMetrics.successRate === null
    ? "text-[color:var(--stats-value-color)]"
    : summaryMetrics.successRate >= 0.95
      ? "text-[color:var(--stats-positive-text)]"
      : summaryMetrics.successRate >= 0.8
        ? "text-[color:var(--stats-warning-text)]"
        : "text-[color:var(--stats-negative-text)]";

  const sprintData = sprintStateSummary || {
    totalSprints: 0, activeSprints: 0, completedSprints: 0, failedSprints: 0,
    totalTasks: 0, runningTasks: 0, blockedTasks: 0
  };
  const apiData = externalApiMetrics || {
    git: { calls: 0, avgDurationMs: 0 },
    jules: { calls: 0, avgDurationMs: 0 },
    jira: { calls: 0, avgDurationMs: 0 },
    other: { calls: 0, avgDurationMs: 0 },
  };
  const errorData = errorsByCategory || {
    timeout: 0, rateLimit: 0, apiError: 0, modelError: 0, cancelled: 0, other: 0
  };
  const errorEntries = Object.entries(errorData).filter(([, count]) => count > 0);
  const totalErrors = errorEntries.reduce((sum, [, count]) => sum + count, 0);
  const externalApiCallCount = Object.values(apiData).reduce((sum, metrics) => sum + metrics.calls, 0);
  const recordTabs: SystemTab[] = ["all", "errors", "system"];
  const focusRecordTab = (tab: SystemTab) => {
    setActiveTab(tab);
    recordViewRefs.current[tab]?.focus();
  };
  const handleRecordViewKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }

    event.preventDefault();
    const currentIndex = recordTabs.indexOf(activeTab);
    if (event.key === "Home") {
      focusRecordTab(recordTabs[0]);
      return;
    }
    if (event.key === "End") {
      focusRecordTab(recordTabs[recordTabs.length - 1]);
      return;
    }

    const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    focusRecordTab(recordTabs[(currentIndex + delta + recordTabs.length) % recordTabs.length]);
  };

  return (
    <div className="space-y-6">
      <section className={`${PANEL_CLASS} p-6 md:p-7`}>
        <StudioHeader
          icon={Terminal}
          eyebrow={locale === "de" ? "Systemtelemetrie" : "System Telemetry"}
          title={locale === "de" ? "Systembetrieb" : "System Operations"}
          description={locale === "de" ? "Projekt-Aufrufarbeitsbereich für Sprintstatus, Aufrufzustand, externe API-Aktivität, Filter, Seitennavigation und erweiterbare Nachrichtendetails." : "Project invocation workbench for sprint state, invocation health, external API activity, filters, pagination, and expandable message detail."}
        />
      </section>

      <SystemAdminSection
        eyebrow={locale === "de" ? "Sprintübersicht" : "Sprint Overview"}
        title={locale === "de" ? "Sprintstatus" : "Sprint State"}
        description={locale === "de" ? "Der aktuelle Sprint- und Aufgabenstatus bleibt von Aufrufmetriken getrennt, damit aktive, blockierte und abgeschlossene Arbeit zuerst erfasst werden kann." : "Current sprint and task state stays separate from invocation metrics so active work, blocked work, and settled work can be scanned first."}
        action={<SectionCount label={locale === "de" ? "Aufgaben" : "Tasks"} value={sprintData.totalTasks} />}
      >
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          <SystemMetricCard
            icon={Activity}
            label={text("sprints")}
            value={formatNumber(sprintData.totalSprints)}
            detail={locale === "de" ? "über Protokolle erfasst" : "recorded across logs"}
            circleClassName={STATUS_TONE_CLASS.neutral}
          />
          <SystemMetricCard
            icon={TrendingUp}
            label={locale === "de" ? "Aktiv" : "Active"}
            value={formatNumber(sprintData.activeSprints)}
            detail={sprintData.activeSprints > 0 ? `${formatNumber(sprintData.runningTasks)} ${locale === "de" ? "Aufgaben aktiv" : "tasks live"}` : locale === "de" ? "alles abgeschlossen" : "all settled"}
            circleClassName={sprintData.activeSprints > 0 ? STATUS_TONE_CLASS.signal : STATUS_TONE_CLASS.neutral}
            valueClassName={sprintData.activeSprints > 0 ? "text-[color:var(--stats-signal-text)]" : undefined}
          />
          <SystemMetricCard
            icon={ShieldCheck}
            label={locale === "de" ? "Abgeschlossen" : "Completed"}
            value={formatNumber(sprintData.completedSprints)}
            detail={`${formatNumber(sprintData.failedSprints)} ${locale === "de" ? "fehlgeschlagen" : "failed"}`}
            circleClassName={STATUS_TONE_CLASS.positive}
          />
          <SystemMetricCard
            icon={Database}
            label={locale === "de" ? "Aufgaben" : "Tasks"}
            value={formatNumber(sprintData.totalTasks)}
            detail={`${formatNumber(sprintData.blockedTasks)} ${locale === "de" ? "blockiert" : "blocked"}`}
            circleClassName={STATUS_TONE_CLASS.neutral}
          />
          <SystemMetricCard
            icon={Terminal}
            label={locale === "de" ? "Aufrufe" : "Invocations"}
            value={formatNumber(summaryMetrics.totalInvocations)}
            detail={`${formatNumber(summaryMetrics.runningCount)} ${locale === "de" ? "laufend" : "running"}`}
            circleClassName={STATUS_TONE_CLASS.signal}
          />
        </div>
      </SystemAdminSection>

      <SystemAdminSection
        eyebrow={locale === "de" ? "Aufrufzustand" : "Invocation Health"}
        title={locale === "de" ? "Zustandsübersicht" : "Health Snapshot"}
        description={locale === "de" ? "Aktuelles Volumen, Erfolgsrate, Latenz, Cache-Effizienz und laufende Arbeit werden aus der serverseitigen Zusammenfassung für den aktuellen Filtersatz abgeleitet." : "Current volume, success rate, latency, cache efficiency, and in-flight work are derived from the server-projected summary for the current filter set."}
        action={<SectionCount label={locale === "de" ? "Gefiltert" : "Filtered"} value={summaryMetrics.totalInvocations} />}
      >
        {summaryMetrics.totalInvocations === 0 ? (
          <div className="mb-4">
            <SystemFeedbackState
              icon={Inbox}
              title={locale === "de" ? "Aufrufzustand benötigt Datensätze" : "Invocation health needs records"}
              detail={locale === "de" ? "Keine Aufrufdatensätze entsprechen dem aktuellen Filtersatz; Raten- und Latenzmetriken sind daher nicht verfügbar." : "No invocation records match the current filter set, so rate and latency metrics are unavailable."}
              role="status"
              ariaLabel={locale === "de" ? "Aufrufzustand mit reduzierten Daten" : "Invocation health reduced data"}
            />
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <SystemMetricCard
            icon={Activity}
            label={locale === "de" ? "Aufrufe" : "Invocations"}
            value={formatNumber(summaryMetrics.totalInvocations)}
            detail={`${formatNumber(summaryMetrics.completedCount)} ${locale === "de" ? "abgeschlossen" : "completed"}`}
            circleClassName={STATUS_TONE_CLASS.signal}
          />
          <SystemMetricCard
            icon={Zap}
            label={locale === "de" ? "Token gesamt" : "Total Tokens"}
            value={formatTokens(summaryMetrics.totalTokens, locale)}
            detail={`${formatTokens(summaryMetrics.totalOutputTokens, locale)} ${locale === "de" ? "Ausgabe" : "output"}`}
            circleClassName={STATUS_TONE_CLASS.warning}
          />
          <SystemMetricCard
            icon={ShieldCheck}
            label={locale === "de" ? "Erfolgsrate" : "Success Rate"}
            value={successRateLabel}
            detail={summaryMetrics.failedCount > 0 ? `${formatNumber(summaryMetrics.failedCount)} ${locale === "de" ? "fehlgeschlagen" : "failed"}` : summaryMetrics.totalInvocations > 0 ? (locale === "de" ? "keine Fehler in den Daten" : "no failures in data") : (locale === "de" ? "benötigt Datensätze" : "needs records")}
            circleClassName={STATUS_TONE_CLASS.positive}
            valueClassName={successTone}
          />
          <SystemMetricCard
            icon={Clock}
            label={locale === "de" ? "Durchschn. Dauer" : "Avg Duration"}
            value={formatStatsDuration(summaryMetrics.avgDurationMs, locale)}
            detail={summaryMetrics.p95DurationMs > 0 ? `p95 ${formatStatsDuration(summaryMetrics.p95DurationMs, locale)}` : locale === "de" ? "keine beendeten Aufrufe" : "no finished calls"}
            circleClassName={STATUS_TONE_CLASS.neutral}
          />
          <SystemMetricCard
            icon={Database}
            label={locale === "de" ? "Cache-Treffer" : "Cache Hits"}
            value={summaryMetrics.cacheHitRate !== null ? formatPercentage(summaryMetrics.cacheHitRate, { maximumFractionDigits: 0 }) : "—"}
            detail={`${formatTokens(summaryMetrics.totalCachedTokens, locale)} ${locale === "de" ? "Token im Cache" : "cached tokens"}`}
            circleClassName={STATUS_TONE_CLASS.neutral}
          />
          <SystemMetricCard
            icon={TrendingUp}
            label={locale === "de" ? "Laufend" : "Running"}
            value={formatNumber(summaryMetrics.runningCount)}
            detail={summaryMetrics.runningCount > 0 ? (locale === "de" ? "gerade aktiv" : "live right now") : (locale === "de" ? "alles abgeschlossen" : "all settled")}
            circleClassName={summaryMetrics.runningCount > 0 ? STATUS_TONE_CLASS.signal : STATUS_TONE_CLASS.neutral}
            valueClassName={summaryMetrics.runningCount > 0 ? "text-[color:var(--stats-signal-text)]" : undefined}
          />
        </div>
        <div className="mt-4">
          <StatusDistributionBar metrics={summaryMetrics} />
        </div>
      </SystemAdminSection>

      <SystemAdminSection
        eyebrow={locale === "de" ? "Externe APIs" : "External APIs"}
        title={locale === "de" ? "Externe API-Aktivität" : "External API Activity"}
        description={locale === "de" ? "Git, Jules, Jira und andere Integrationen sind von der Hauptaufruftabelle getrennt, damit externer Datenverkehr leicht geprüft werden kann." : "Git, Jules, Jira, and other integrations are isolated from the main invocation table so external traffic stays easy to audit."}
        action={<SectionCount label={locale === "de" ? "Aufrufe" : "Calls"} value={externalApiCallCount} />}
      >
        {externalApiCallCount === 0 ? (
          <div className="mb-4">
            <SystemFeedbackState
              icon={Database}
              title={locale === "de" ? "Keine externe API-Aktivität klassifiziert" : "No external API activity classified"}
              detail={locale === "de" ? "Dieser Datensatz enthält keine klassifizierten Git-, Jules-, Jira- oder anderen externen API-Aufrufe." : "This data set does not include classified Git, Jules, Jira, or other external API calls."}
              role="status"
              ariaLabel={locale === "de" ? "Keine externe API-Aktivität" : "No external API activity"}
            />
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Object.entries(apiData).map(([key, metrics]) => (
            <SystemMetricCard
              key={key}
              icon={Database}
              label={formatExternalApiLabel(key)}
              value={formatNumber(metrics.calls)}
              detail={metrics.calls > 0 ? formatStatsDuration(metrics.avgDurationMs, locale) : locale === "de" ? "Keine klassifizierten Aufrufe" : "No classified calls"}
              circleClassName={STATUS_TONE_CLASS.neutral}
            />
          ))}
        </div>
      </SystemAdminSection>

      <SystemAdminSection
        eyebrow={locale === "de" ? "Fehleranalyse" : "Failure Analysis"}
        title={locale === "de" ? "Fehlerkategorien" : "Error Categories"}
        description={locale === "de" ? "Fehlerklassen werden gruppiert, damit vorübergehende Probleme von Provider-, Modell- und Abbruchproblemen unterschieden werden können." : "Error classes are grouped so operators can separate transient issues from provider, model, and cancellation problems at a glance."}
        action={totalErrors > 0 ? <SectionCount label={locale === "de" ? "Fehler" : "Failures"} value={totalErrors} tone="warning" /> : undefined}
      >
        <div>
          {errorEntries.length === 0 ? (
            <SystemFeedbackState
              icon={ShieldCheck}
              title={locale === "de" ? "Keine Fehlerkategorien klassifiziert" : "No error categories classified"}
              detail={locale === "de" ? "Fehlgeschlagene oder abgebrochene Aufrufe mit klassifizierbaren Details erscheinen hier." : "Failed or cancelled invocations with classifiable details will appear here."}
              role="status"
              ariaLabel={locale === "de" ? "Keine Fehlerkategorien" : "No error categories"}
              tone="positive"
            />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {errorEntries.map(([category, count]) => {
                const label = locale === "de"
                  ? ({ timeout: "Zeitüberschreitung", rateLimit: "Ratenlimit", apiError: "API-Fehler", modelError: "Modellfehler", cancelled: "Abgebrochen", other: "Sonstige" } as Record<string, string>)[category] ?? category
                  : formatErrorCategoryLabel(category);
                const tone = getErrorCategoryTone(category);
                return (
                  <div key={category} className={`${SUBPANEL_CLASS} flex items-center justify-between p-4 transition-colors hover:bg-[color:var(--stats-surface-subpanel-hover)]`}>
                    <div className="flex items-center gap-3">
                      <div className={`h-2.5 w-2.5 rounded-full ${tone}`} />
                      <div className="text-sm font-bold text-[color:var(--stats-value-color)]">{label}</div>
                    </div>
                    <div className="text-base font-semibold tracking-tight text-[color:var(--stats-value-color)]">{formatNumber(count)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SystemAdminSection>

      <SystemAdminSection
        eyebrow={locale === "de" ? "Aufrufdatensätze" : "Invocation Records"}
        title={locale === "de" ? "Aufrufdatensätze" : "Invocation Records"}
        description={locale === "de" ? "Suche, Serverfilter, Datensatzregister, Ergebniszahlen, Seitennavigation und erweiterbare Protokolldetails bleiben in einem operativen Datensatzbereich." : "Search, server filters, record tabs, result counts, pagination, and expandable transcript detail stay in one operational record area."}
        action={(
          <div
            className="inline-flex min-h-8 items-center gap-2 rounded-[var(--stats-control-radius)] border border-[color:var(--stats-border-hairline)] bg-[color:var(--stats-surface-chip)] px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-detail-color)]"
            aria-label={locale === "de" ? `Verfügbare Aufrufdatensätze: ${formatNumber(invocations.length)}` : `Available invocation records: ${formatNumber(invocations.length)}`}
          >
            <span>{locale === "de" ? "Verfügbar" : "Available"}</span>
            <span className="inline-flex min-w-[3.25rem] justify-end font-semibold tabular-nums text-[color:var(--stats-value-color)]">
              {formatNumber(invocations.length)}
            </span>
          </div>
        )}
      >
        <div className="space-y-4">
          <div className={`${SUBPANEL_CLASS} p-3`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Datensatzansichten" : "Record Views"}</div>
              <div
                className="grid w-full grid-cols-3 gap-px overflow-hidden rounded-[var(--stats-control-radius)] border border-[color:var(--stats-border-hairline)] bg-[color:var(--stats-border-hairline)] sm:w-auto"
                role="group"
                aria-label={locale === "de" ? "Ansichten der Aufrufdatensätze" : "Invocation record views"}
                onKeyDown={handleRecordViewKeyDown}
              >
                {recordTabs.map((tab) => {
                  const tabCount = tab === "all" ? invocations.length : tab === "errors" ? errorCount : systemCount;
                  const tabLabel = tab === "all" ? (locale === "de" ? "Alle" : "All") : tab === "errors" ? (locale === "de" ? "Fehler" : "Errors") : (locale === "de" ? "Systemnachr." : "System Msgs");
                  return (
                    <button
                      key={tab}
                      type="button"
                      ref={(node) => {
                        recordViewRefs.current[tab] = node;
                      }}
                      onClick={() => setActiveTab(tab)}
                      aria-pressed={activeTab === tab}
                      aria-label={locale === "de" ? `${tabLabel}, ${formatNumber(tabCount)} ${tabCount === 1 ? "Datensatz" : "Datensätze"}` : `${tabLabel} invocation records, ${formatNumber(tabCount)} ${tabCount === 1 ? "record" : "records"}`}
                      className={`inline-flex min-h-10 min-w-0 items-center justify-center gap-2 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] transition-[background-color,border-color,color] duration-200 motion-reduce:transition-none sm:min-w-[10rem] ${CONTROL_FOCUS_CLASS} ${
                        activeTab === tab ? TAB_ACTIVE_CLASS : `border-transparent bg-[color:var(--stats-surface-subpanel)] ${TAB_IDLE_CLASS}`
                      }`}
                    >
                      <span className="min-w-0 truncate">{tabLabel}</span>
                      <span
                        className={`inline-flex min-w-[2.5rem] justify-end rounded-full px-2 py-0.5 text-[9px] font-semibold tabular-nums tracking-[0.08em] ${activeTab === tab ? TAB_COUNT_ACTIVE_CLASS : TAB_COUNT_IDLE_CLASS}`}
                        aria-hidden="true"
                      >
                        {formatNumber(tabCount)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">
              <span>{locale === "de" ? "Filter" : "Filters"}</span>
              <span className="h-px min-w-6 flex-1 bg-[color:var(--stats-border-hairline)]" aria-hidden="true" />
            </div>
            <SystemFilterBar
              filters={filters}
              onFiltersChange={setFilters}
              search={search}
              onSearchChange={setSearch}
              availablePurposes={availablePurposes}
              availableProviders={availableProviders}
              totalCount={totalCount}
              filteredCount={tabbedInvocations.length}
              page={page}
              onPageChange={setPage}
              hasMore={hasMore}
            />
          </div>

          {error ? (
            <SystemFeedbackState
              icon={AlertTriangle}
              title={locale === "de" ? "Aufrufe konnten nicht geladen werden" : "Failed to load invocations"}
              detail={error}
              role="alert"
              ariaLabel={locale === "de" ? "Laden der Aufrufe fehlgeschlagen" : "Invocation load failed"}
              tone="negative"
            />
          ) : null}

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">
              <span>{locale === "de" ? "Aufruf-Ledger" : "Invocation Ledger"}</span>
              <span className="h-px min-w-6 flex-1 bg-[color:var(--stats-border-hairline)]" aria-hidden="true" />
            </div>
            <InvocationsTable
              invocations={tabbedInvocations}
              sort={sort}
              onSortChange={setSort}
              expandedId={expandedId}
              onRowExpand={(id) => setExpandedId((prev) => (prev === id ? null : id))}
              loading={loading}
              error={error}
            />
          </div>
        </div>
      </SystemAdminSection>
    </div>
  );
};
