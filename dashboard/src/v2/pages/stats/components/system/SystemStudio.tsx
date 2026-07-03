import type { FunctionComponent, ComponentType } from "preact";
import { useMemo, useState } from "preact/hooks";
import {
  Activity,
  Clock,
  Database,
  ShieldCheck,
  Terminal,
  TrendingUp,
  Zap,
} from "lucide-preact";
import { useSystemViewData, type SystemSummaryMetrics } from "../../../../pages/stats/hooks/use-system-view-data.js";
import { formatStatsDuration, formatTokens } from "../../stats-utils.js";
import {
  PANEL_CLASS,
  SUBPANEL_CLASS,
  CHIP_CLASS,
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
  icon: ComponentType<any>;
  label: string;
  value: string;
  detail: import("preact").ComponentChild;
  circleClassName: string;
  valueClassName?: string;
}> = ({ icon: Icon, label, value, detail, circleClassName, valueClassName }) => (
  <div className={`${SUBPANEL_CLASS} flex min-h-[8rem] flex-col justify-between p-4`}>
    <div className="flex items-start justify-between gap-3">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${circleClassName}`}>
      <Icon className="h-4 w-4" strokeWidth={2.25} />
      </div>
      <div className="text-right text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-detail-color)]">
        {label}
      </div>
    </div>
    <div className={`mt-4 break-words text-2xl font-black tracking-tight md:text-3xl ${valueClassName || "text-[color:var(--stats-value-color)]"}`}>
      {value}
    </div>
    <div className="mt-1 text-[11px] font-medium text-[color:var(--stats-detail-color)]">
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
    <div className={`${SUBPANEL_CLASS} p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--stats-label-color)]">Status Distribution</div>
        <div className="flex flex-wrap items-center gap-3">
          {STATUS_BAR_SEGMENTS.filter((segment) => metrics[segment.key] > 0).map((segment) => (
            <div key={segment.key} className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-detail-color)]">
              <span className={`h-2 w-2 rounded-full ${segment.dotClassName}`} />
              {segment.label} · {metrics[segment.key]}
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
}> = ({ eyebrow, title, description }) => (
  <div className="flex flex-wrap items-start justify-between gap-3">
    <div>
      <div className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-warning-text)] ${CHIP_CLASS}`}>
        {eyebrow}
      </div>
      <div className="mt-3 text-xl font-black text-[color:var(--stats-value-color)]">{title}</div>
      {description ? (
        <div className="mt-1.5 max-w-3xl text-sm leading-relaxed text-[color:var(--stats-detail-color)]">{description}</div>
      ) : null}
    </div>
  </div>
);

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
  const errorEntries = Object.entries(errorData).filter(([_, count]) => count > 0);
  const totalErrors = errorEntries.reduce((sum, [_, count]) => sum + count, 0);

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

      <section className={`${PANEL_CLASS} p-5 md:p-6`}>
        <StudioSectionHeader
          eyebrow="Sprint Overview"
          title="Sprint State"
          description="Current sprint and task state stays separate from invocation metrics so active work, blocked work, and settled work can be scanned first."
        />
        <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-5">
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
            detail={sprintData.activeSprints > 0 ? `${sprintData.runningTasks} tasks live` : <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold ${STATUS_TONE_CLASS.signal}`}>All settled</span>}
            circleClassName={STATUS_TONE_CLASS.signal}
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
      </section>

      <section className={`${PANEL_CLASS} p-5 md:p-6`}>
        <StudioSectionHeader
          eyebrow="Invocation Health"
          title="Health Snapshot"
          description="Current volume, success rate, latency, cache efficiency, and in-flight work are derived from the server-projected summary for the current filter set."
        />
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
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
            detail={summaryMetrics.failedCount > 0 ? `${summaryMetrics.failedCount} failed` : "no failures"}
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
      </section>

      <section className={`${PANEL_CLASS} p-5 md:p-6`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <StudioSectionHeader
            eyebrow="External APIs"
            title="External API Activity"
            description="Git, Jules, Jira, and other integrations are isolated from the main invocation table so external traffic stays easy to audit."
          />
          <div className="flex flex-wrap gap-2">
            {(Object.entries(apiData) as [keyof typeof apiData, any][]).filter(([_, metrics]) => metrics.calls > 0).map(([key, metrics]) => (
              <div key={key} className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-detail-color)] ${CHIP_CLASS}`}>
                {key.charAt(0).toUpperCase() + key.slice(1)} · {metrics.calls} calls
              </div>
            ))}
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {Object.entries(apiData).map(([key, metrics]) => (
            <SystemMetricCard
              key={key}
              icon={Database}
              label={key.charAt(0).toUpperCase() + key.slice(1)}
              value={metrics.calls.toLocaleString()}
              detail={metrics.calls > 0 ? formatStatsDuration(metrics.avgDurationMs) : "No calls"}
              circleClassName={STATUS_TONE_CLASS.neutral}
            />
          ))}
        </div>
      </section>

      <section className={`${PANEL_CLASS} p-5 md:p-6`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <StudioSectionHeader
            eyebrow="Error Categories"
            title="Error Categories"
            description="Error classes are grouped so operators can separate transient issues from provider, model, and cancellation problems at a glance."
          />
          {totalErrors > 0 ? (
            <div className={`flex h-8 items-center justify-center rounded-full px-3 text-[11px] font-bold ${STATUS_TONE_CLASS.warning}`}>
              {totalErrors} total failures
            </div>
          ) : null}
        </div>
        <div className="mt-6">
          {errorEntries.length === 0 ? (
            <div className={`${SUBPANEL_CLASS} flex flex-col items-center justify-center py-12 text-center`}>
              <ShieldCheck className="mb-3 h-8 w-8 text-[color:var(--stats-positive-text)] opacity-50" />
              <div className="text-sm font-bold text-[color:var(--stats-value-color)]">No Errors Recorded</div>
              <div className="mt-1 text-sm text-[color:var(--stats-detail-color)]">All invocations completed successfully.</div>
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {errorEntries.map(([category, count]) => {
                const label = category === "rateLimit" ? "Rate Limit" : category === "apiError" ? "API Error" : category === "modelError" ? "Model Error" : category.charAt(0).toUpperCase() + category.slice(1);
                const tone = category === "timeout" || category === "rateLimit"
                  ? "bg-[color:var(--stats-warning-text)]"
                  : category === "cancelled"
                    ? "bg-[color:var(--stats-detail-color)]"
                    : "bg-[color:var(--stats-negative-text)]";
                return (
                  <div key={category} className={`${SUBPANEL_CLASS} flex items-center justify-between p-4 transition-colors hover:bg-[color:var(--fill-muted-hover)]`}>
                    <div className="flex items-center gap-3">
                      <div className={`h-2.5 w-2.5 rounded-full ${tone}`} />
                      <div className="text-sm font-bold text-[color:var(--stats-value-color)]">{label}</div>
                    </div>
                    <div className="text-lg font-black tracking-tight text-[color:var(--stats-value-color)]">{count}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className={`${PANEL_CLASS} p-5 md:p-6`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <StudioSectionHeader
            eyebrow="Invocation Records"
            title="Invocation Records"
            description="Search, server filters, record tabs, result counts, pagination, and expandable transcript detail stay in one operational record area."
          />
          <div className="flex flex-wrap gap-2">
            <div className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-detail-color)] ${CHIP_CLASS}`}>
              All · {invocations.length.toLocaleString()}
            </div>
            <div className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-detail-color)] ${CHIP_CLASS}`}>
              Errors · {errorCount.toLocaleString()}
            </div>
            <div className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-detail-color)] ${CHIP_CLASS}`}>
              System · {systemCount.toLocaleString()}
            </div>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <div className="sticky top-3 z-30 flex max-w-full flex-wrap gap-1 self-start rounded-2xl border border-[color:var(--stats-card-border)] bg-[color:var(--stats-card-bg)] p-1 shadow-[var(--stats-subpanel-shadow)] backdrop-blur-xl" role="group" aria-label="Invocation record views">
            {(["all", "errors", "system"] as SystemTab[]).map((tab) => {
              const tabCount = tab === "all" ? invocations.length : tab === "errors" ? errorCount : systemCount;
              return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                aria-pressed={activeTab === tab}
                className={`inline-flex min-w-max items-center gap-2 rounded-xl px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] transition-all ${
                  activeTab === tab ? TAB_ACTIVE_CLASS : TAB_IDLE_CLASS
                }`}
              >
                {tab === "all" ? "All" : tab === "errors" ? "Errors" : "System Msgs"}
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-black tabular-nums tracking-[0.12em] ${activeTab === tab ? TAB_COUNT_ACTIVE_CLASS : TAB_COUNT_IDLE_CLASS}`}>
                  {tabCount.toLocaleString()}
                </span>
              </button>
              );
            })}
          </div>

          <div className="space-y-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--stats-label-color)]">Filters</div>
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
            <div className={`rounded-2xl px-4 py-3 text-sm ${STATUS_TONE_CLASS.negative}`}>
              Failed to load invocations — {error}
            </div>
          ) : null}

          <div className="space-y-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--stats-label-color)]">Invocation Ledger</div>
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
      </section>
    </div>
  );
};
