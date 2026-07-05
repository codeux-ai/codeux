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
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${circleClassName}`}>
        <Icon className="h-4 w-4" strokeWidth={2.25} />
      </div>
      <div className="text-right text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--stats-label-color)]">
        {label}
      </div>
    </div>
    <div className={`mt-4 break-words text-xl font-semibold tracking-tight tabular-nums md:text-[1.7rem] ${valueClassName || "text-[color:var(--stats-value-color)]"}`}>
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
  const total = STATUS_BAR_SEGMENTS.reduce((sum, segment) => sum + metrics[segment.key], 0);
  if (total === 0) {
    return null;
  }

  return (
    <div className={`${SUBPANEL_CLASS} p-4`} aria-label="Status distribution">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--stats-label-color)]">Status Distribution</div>
        <div className="flex flex-wrap items-center gap-3">
          {STATUS_BAR_SEGMENTS.filter((segment) => metrics[segment.key] > 0).map((segment) => (
            <div key={segment.key} className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-detail-color)]">
              <span className={`h-2 w-2 rounded-full ${segment.dotClassName}`} />
              <span>{segment.label}</span>
              <span className="tabular-nums text-[color:var(--stats-value-color)]">{metrics[segment.key].toLocaleString()}</span>
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
              className={`h-full ${segment.barClassName} transition-all duration-500`}
              style={{ width: `${(count / total) * 100}%` }}
              title={`${segment.label}: ${count}`}
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
}> = ({ label, value, tone = "neutral" }) => (
  <div className={`inline-flex h-8 items-center gap-2 rounded-full px-3 text-[10px] font-bold uppercase tracking-[0.16em] ${STATUS_TONE_CLASS[tone]}`}>
    <span>{label}</span>
    <span className="tabular-nums text-[color:var(--stats-value-color)]">{value.toLocaleString()}</span>
  </div>
);

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
    ? `${Math.round(summaryMetrics.successRate * 100)}%`
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
      <section className={`${PANEL_CLASS} rounded-[2.2rem] p-6 md:p-7`}>
        <StudioHeader
          icon={Terminal}
          eyebrow="System Telemetry"
          title="System Operations"
          description="Project invocation workbench for sprint state, invocation health, external API activity, filters, pagination, and expandable message detail."
        />
      </section>

      <SystemAdminSection
        eyebrow="Sprint Overview"
        title="Sprint State"
        description="Current sprint and task state stays separate from invocation metrics so active work, blocked work, and settled work can be scanned first."
        action={<SectionCount label="Tasks" value={sprintData.totalTasks} />}
      >
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          <SystemMetricCard
            icon={Activity}
            label="Sprints"
            value={sprintData.totalSprints.toLocaleString()}
            detail="recorded across logs"
            circleClassName={STATUS_TONE_CLASS.neutral}
          />
          <SystemMetricCard
            icon={TrendingUp}
            label="Active"
            value={sprintData.activeSprints > 0 ? sprintData.activeSprints.toLocaleString() : "0"}
            detail={sprintData.activeSprints > 0 ? `${sprintData.runningTasks} tasks live` : "all settled"}
            circleClassName={sprintData.activeSprints > 0 ? STATUS_TONE_CLASS.signal : STATUS_TONE_CLASS.neutral}
            valueClassName={sprintData.activeSprints > 0 ? "text-[color:var(--stats-signal-text)]" : undefined}
          />
          <SystemMetricCard
            icon={ShieldCheck}
            label="Completed"
            value={sprintData.completedSprints.toLocaleString()}
            detail={`${sprintData.failedSprints} failed`}
            circleClassName={STATUS_TONE_CLASS.positive}
          />
          <SystemMetricCard
            icon={Database}
            label="Tasks"
            value={sprintData.totalTasks.toLocaleString()}
            detail={`${sprintData.blockedTasks} blocked`}
            circleClassName={STATUS_TONE_CLASS.neutral}
          />
          <SystemMetricCard
            icon={Terminal}
            label="Invocations"
            value={summaryMetrics.totalInvocations.toLocaleString()}
            detail={`${summaryMetrics.runningCount.toLocaleString()} running`}
            circleClassName={STATUS_TONE_CLASS.signal}
          />
        </div>
      </SystemAdminSection>

      <SystemAdminSection
        eyebrow="Invocation Health"
        title="Health Snapshot"
        description="Current volume, success rate, latency, cache efficiency, and in-flight work are derived from the server-projected summary for the current filter set."
        action={<SectionCount label="Filtered" value={summaryMetrics.totalInvocations} />}
      >
        {summaryMetrics.totalInvocations === 0 ? (
          <div className="mb-4">
            <SystemFeedbackState
              icon={Inbox}
              title="Invocation health needs records"
              detail="No invocation records match the current filter set, so rate and latency metrics are unavailable."
              role="status"
              ariaLabel="Invocation health reduced data"
            />
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <SystemMetricCard
            icon={Activity}
            label="Invocations"
            value={summaryMetrics.totalInvocations.toLocaleString()}
            detail={`${summaryMetrics.completedCount.toLocaleString()} completed`}
            circleClassName={STATUS_TONE_CLASS.signal}
          />
          <SystemMetricCard
            icon={Zap}
            label="Total Tokens"
            value={formatTokens(summaryMetrics.totalTokens)}
            detail={`${formatTokens(summaryMetrics.totalOutputTokens)} output`}
            circleClassName={STATUS_TONE_CLASS.warning}
          />
          <SystemMetricCard
            icon={ShieldCheck}
            label="Success Rate"
            value={successRateLabel}
            detail={summaryMetrics.failedCount > 0 ? `${summaryMetrics.failedCount} failed` : summaryMetrics.totalInvocations > 0 ? "no failures in data" : "needs records"}
            circleClassName={STATUS_TONE_CLASS.positive}
            valueClassName={successTone}
          />
          <SystemMetricCard
            icon={Clock}
            label="Avg Duration"
            value={formatStatsDuration(summaryMetrics.avgDurationMs)}
            detail={summaryMetrics.p95DurationMs > 0 ? `p95 ${formatStatsDuration(summaryMetrics.p95DurationMs)}` : "no finished calls"}
            circleClassName={STATUS_TONE_CLASS.neutral}
          />
          <SystemMetricCard
            icon={Database}
            label="Cache Hits"
            value={summaryMetrics.cacheHitRate !== null ? `${Math.round(summaryMetrics.cacheHitRate * 100)}%` : "—"}
            detail={`${formatTokens(summaryMetrics.totalCachedTokens)} cached tokens`}
            circleClassName={STATUS_TONE_CLASS.neutral}
          />
          <SystemMetricCard
            icon={TrendingUp}
            label="Running"
            value={summaryMetrics.runningCount.toLocaleString()}
            detail={summaryMetrics.runningCount > 0 ? "live right now" : "all settled"}
            circleClassName={summaryMetrics.runningCount > 0 ? STATUS_TONE_CLASS.signal : STATUS_TONE_CLASS.neutral}
            valueClassName={summaryMetrics.runningCount > 0 ? "text-[color:var(--stats-signal-text)]" : undefined}
          />
        </div>
        <div className="mt-4">
          <StatusDistributionBar metrics={summaryMetrics} />
        </div>
      </SystemAdminSection>

      <SystemAdminSection
        eyebrow="External APIs"
        title="External API Activity"
        description="Git, Jules, Jira, and other integrations are isolated from the main invocation table so external traffic stays easy to audit."
        action={<SectionCount label="Calls" value={externalApiCallCount} />}
      >
        {externalApiCallCount === 0 ? (
          <div className="mb-4">
            <SystemFeedbackState
              icon={Database}
              title="No external API activity classified"
              detail="This data set does not include classified Git, Jules, Jira, or other external API calls."
              role="status"
              ariaLabel="No external API activity"
            />
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Object.entries(apiData).map(([key, metrics]) => (
            <SystemMetricCard
              key={key}
              icon={Database}
              label={formatExternalApiLabel(key)}
              value={metrics.calls.toLocaleString()}
              detail={metrics.calls > 0 ? formatStatsDuration(metrics.avgDurationMs) : "No classified calls"}
              circleClassName={STATUS_TONE_CLASS.neutral}
            />
          ))}
        </div>
      </SystemAdminSection>

      <SystemAdminSection
        eyebrow="Failure Analysis"
        title="Error Categories"
        description="Error classes are grouped so operators can separate transient issues from provider, model, and cancellation problems at a glance."
        action={totalErrors > 0 ? <SectionCount label="Failures" value={totalErrors} tone="warning" /> : undefined}
      >
        <div>
          {errorEntries.length === 0 ? (
            <SystemFeedbackState
              icon={ShieldCheck}
              title="No error categories classified"
              detail="Failed or cancelled invocations with classifiable details will appear here."
              role="status"
              ariaLabel="No error categories"
              tone="positive"
            />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {errorEntries.map(([category, count]) => {
                const label = formatErrorCategoryLabel(category);
                const tone = getErrorCategoryTone(category);
                return (
                  <div key={category} className={`${SUBPANEL_CLASS} flex items-center justify-between p-4 transition-colors hover:bg-[color:var(--fill-muted-hover)]`}>
                    <div className="flex items-center gap-3">
                      <div className={`h-2.5 w-2.5 rounded-full ${tone}`} />
                      <div className="text-sm font-bold text-[color:var(--stats-value-color)]">{label}</div>
                    </div>
                    <div className="text-base font-semibold tracking-tight text-[color:var(--stats-value-color)]">{count}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SystemAdminSection>

      <SystemAdminSection
        eyebrow="Invocation Records"
        title="Invocation Records"
        description="Search, server filters, record tabs, result counts, pagination, and expandable transcript detail stay in one operational record area."
        action={(
          <div
            className="inline-flex min-h-8 items-center gap-2 rounded-[var(--stats-control-radius)] border border-[color:var(--stats-border-hairline)] bg-[color:var(--stats-surface-chip)] px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-detail-color)]"
            aria-label={`Available invocation records: ${invocations.length.toLocaleString()}`}
          >
            <span>Available</span>
            <span className="inline-flex min-w-[3.25rem] justify-end font-black tabular-nums text-[color:var(--stats-value-color)]">
              {invocations.length.toLocaleString()}
            </span>
          </div>
        )}
      >
        <div className="space-y-4">
          <div className={`${SUBPANEL_CLASS} p-3`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">Record Views</div>
              <div
                className="grid w-full grid-cols-3 gap-px overflow-hidden rounded-[var(--stats-control-radius)] border border-[color:var(--stats-border-hairline)] bg-[color:var(--stats-border-hairline)] sm:w-auto"
                role="group"
                aria-label="Invocation record views"
                onKeyDown={handleRecordViewKeyDown}
              >
                {recordTabs.map((tab) => {
                  const tabCount = tab === "all" ? invocations.length : tab === "errors" ? errorCount : systemCount;
                  const tabLabel = tab === "all" ? "All" : tab === "errors" ? "Errors" : "System Msgs";
                  return (
                    <button
                      key={tab}
                      type="button"
                      ref={(node) => {
                        recordViewRefs.current[tab] = node;
                      }}
                      onClick={() => setActiveTab(tab)}
                      aria-pressed={activeTab === tab}
                      aria-label={`${tabLabel} invocation records, ${tabCount.toLocaleString()} ${tabCount === 1 ? "record" : "records"}`}
                      className={`inline-flex min-h-10 min-w-0 items-center justify-center gap-2 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] transition-[background-color,border-color,box-shadow,color] duration-200 motion-reduce:transition-none sm:min-w-[10rem] ${CONTROL_FOCUS_CLASS} ${
                        activeTab === tab ? TAB_ACTIVE_CLASS : `border-transparent bg-[color:var(--stats-surface-subpanel)] ${TAB_IDLE_CLASS}`
                      }`}
                    >
                      <span className="min-w-0 truncate">{tabLabel}</span>
                      <span
                        className={`inline-flex min-w-[2.5rem] justify-end rounded-full px-2 py-0.5 text-[9px] font-black tabular-nums tracking-[0.08em] ${activeTab === tab ? TAB_COUNT_ACTIVE_CLASS : TAB_COUNT_IDLE_CLASS}`}
                        aria-hidden="true"
                      >
                        {tabCount.toLocaleString()}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">
              <span>Filters</span>
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
              title="Failed to load invocations"
              detail={error}
              role="alert"
              ariaLabel="Invocation load failed"
              tone="negative"
            />
          ) : null}

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">
              <span>Invocation Ledger</span>
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
