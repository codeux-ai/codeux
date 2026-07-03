import type { ComponentType, FunctionComponent } from "preact";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  HelpCircle,
  ShieldCheck,
  Sparkles,
  TimerReset,
} from "lucide-preact";
import type {
  ExecutionDurationStats,
  ExecutionStatsEntitySummary,
  ExecutionUsageTotals,
  ProjectExecutionStatsSnapshot,
  SegmentDefinition,
  TokenUsageSource,
} from "../../../types.js";
import {
  formatPercent,
  formatStatsDuration,
  formatTokens,
} from "../stats-utils.js";
import {
  CHIP_CLASS,
  DonutCard,
  PANEL_CLASS,
  SUBPANEL_CLASS,
  TokenFlowBar,
  getProviderIcon,
} from "./stats-ui-primitives.js";
import {
  buildTelemetrySourceSummary,
  formatSuccessRate,
  getSuccessTone,
} from "../model-insights.js";

type ReliabilitySource = TokenUsageSource | "unknown";
type SourceTone = "strong" | "fallback" | "critical" | "neutral";

interface SourceRow {
  source: ReliabilitySource;
  label: string;
  count: number;
  share: number | null;
  tone: SourceTone;
  detail: string;
  icon: ComponentType<any>;
}

interface ProviderReliabilityRow {
  provider: ExecutionStatsEntitySummary;
  sourceRows: SourceRow[];
  sourceSummaryLabel: string;
  sourceSummaryDetail: string;
  sourceTone: SourceTone;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  runningCount: number;
  finishedCount: number;
  successRate: number | null;
  duration: ExecutionDurationStats;
  riskScore: number;
}

const SOURCE_META: Record<ReliabilitySource, {
  label: string;
  tone: SourceTone;
  detail: string;
  icon: ComponentType<any>;
}> = {
  reported: {
    label: "Reported",
    tone: "strong",
    detail: "Provider-native counts",
    icon: ShieldCheck,
  },
  estimated: {
    label: "Estimated",
    tone: "fallback",
    detail: "Calculated fallback",
    icon: Sparkles,
  },
  unavailable: {
    label: "Unavailable",
    tone: "critical",
    detail: "Provider ran without usable counts",
    icon: AlertTriangle,
  },
  unsupported: {
    label: "Unsupported",
    tone: "neutral",
    detail: "Telemetry is not supported",
    icon: HelpCircle,
  },
  unknown: {
    label: "Unknown",
    tone: "neutral",
    detail: "No source counter was recorded",
    icon: HelpCircle,
  },
};

const SOURCE_TONE_CLASS: Record<SourceTone, string> = {
  strong: "border-status-green/20 bg-status-green/[0.08] text-status-green",
  fallback: "border-amber-500/22 bg-amber-500/[0.08] text-amber-700 dark:text-amber-300",
  critical: "border-rose-500/22 bg-rose-500/[0.08] text-rose-700 dark:text-rose-300",
  neutral: "border-slate-500/20 bg-slate-500/10 text-slate-500 dark:text-slate-400",
};

const SOURCE_TEXT_CLASS: Record<SourceTone, string> = {
  strong: "text-status-green",
  fallback: "text-amber-700 dark:text-amber-300",
  critical: "text-rose-700 dark:text-rose-300",
  neutral: "text-slate-500 dark:text-slate-400",
};

const SUCCESS_TONE_CLASS: Record<ReturnType<typeof getSuccessTone>, string> = {
  strong: "border-status-green/20 bg-status-green/[0.08] text-status-green",
  warn: "border-amber-500/22 bg-amber-500/[0.08] text-amber-700 dark:text-amber-300",
  critical: "border-rose-500/22 bg-rose-500/[0.08] text-rose-700 dark:text-rose-300",
  neutral: "border-slate-500/20 bg-slate-500/10 text-slate-500 dark:text-slate-400",
};

const RISK_TONE_CLASS = {
  low: "border-status-green/20 bg-status-green/[0.08] text-status-green",
  medium: "border-amber-500/22 bg-amber-500/[0.08] text-amber-700 dark:text-amber-300",
  high: "border-rose-500/22 bg-rose-500/[0.08] text-rose-700 dark:text-rose-300",
};

function getUsageSourceCount(usage: ExecutionUsageTotals, source: TokenUsageSource): number {
  if (source === "reported") return usage.reportedInvocationCount || 0;
  if (source === "estimated") return usage.estimatedInvocationCount || 0;
  if (source === "unavailable") return usage.unavailableInvocationCount || 0;
  return usage.unsupportedInvocationCount || 0;
}

function buildSourceRows(usage: ExecutionUsageTotals): SourceRow[] {
  const knownCount = getUsageSourceCount(usage, "reported")
    + getUsageSourceCount(usage, "estimated")
    + getUsageSourceCount(usage, "unavailable")
    + getUsageSourceCount(usage, "unsupported");
  const unknownCount = Math.max(0, (usage.invocationCount || 0) - knownCount);
  const total = knownCount + unknownCount;

  return (["reported", "estimated", "unavailable", "unsupported", "unknown"] as const).map((source) => {
    const meta = SOURCE_META[source];
    const count = source === "unknown" ? unknownCount : getUsageSourceCount(usage, source);
    return {
      source,
      label: meta.label,
      count,
      share: total > 0 ? count / total : null,
      tone: meta.tone,
      detail: meta.detail,
      icon: meta.icon,
    };
  });
}

function summarizeSourceRows(rows: SourceRow[]): {
  label: string;
  detail: string;
  tone: SourceTone;
  total: number;
  fallbackCount: number;
  failureRiskCount: number;
} {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const reported = rows.find((row) => row.source === "reported")?.count ?? 0;
  const estimated = rows.find((row) => row.source === "estimated")?.count ?? 0;
  const unavailable = rows.find((row) => row.source === "unavailable")?.count ?? 0;
  const unsupported = rows.find((row) => row.source === "unsupported")?.count ?? 0;
  const unknown = rows.find((row) => row.source === "unknown")?.count ?? 0;
  const fallbackCount = estimated + unknown;
  const failureRiskCount = unavailable + unsupported;

  if (total === 0) {
    return {
      label: "No source signal",
      detail: "No invocation source counters",
      tone: "neutral",
      total,
      fallbackCount,
      failureRiskCount,
    };
  }

  if (reported === total) {
    return {
      label: "Reported",
      detail: `${reported.toLocaleString()} reported calls`,
      tone: "strong",
      total,
      fallbackCount,
      failureRiskCount,
    };
  }

  if (failureRiskCount > 0 && reported === 0 && estimated === 0) {
    return {
      label: "Unavailable",
      detail: `${failureRiskCount.toLocaleString()} unavailable or unsupported`,
      tone: "critical",
      total,
      fallbackCount,
      failureRiskCount,
    };
  }

  if (failureRiskCount > 0) {
    return {
      label: "Mixed sources",
      detail: `${reported.toLocaleString()} reported · ${fallbackCount.toLocaleString()} fallback · ${failureRiskCount.toLocaleString()} unavailable`,
      tone: "critical",
      total,
      fallbackCount,
      failureRiskCount,
    };
  }

  if (fallbackCount > 0) {
    return {
      label: reported > 0 ? "Reported + fallback" : "Estimated",
      detail: `${reported.toLocaleString()} reported · ${fallbackCount.toLocaleString()} fallback`,
      tone: "fallback",
      total,
      fallbackCount,
      failureRiskCount,
    };
  }

  return {
    label: "Unknown",
    detail: `${unknown.toLocaleString()} unknown calls`,
    tone: "neutral",
    total,
    fallbackCount,
    failureRiskCount,
  };
}

function combineProviderDuration(models: ProjectExecutionStatsSnapshot["models"]): ExecutionDurationStats {
  const sampleCount = models.reduce((sum, model) => sum + model.duration.sampleCount, 0);
  if (sampleCount === 0) {
    return { sampleCount: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 };
  }

  return {
    sampleCount,
    avgMs: models.reduce((sum, model) => sum + model.duration.avgMs * model.duration.sampleCount, 0) / sampleCount,
    p50Ms: models.reduce((sum, model) => sum + model.duration.p50Ms * model.duration.sampleCount, 0) / sampleCount,
    p95Ms: Math.max(...models.map((model) => model.duration.p95Ms)),
    maxMs: Math.max(...models.map((model) => model.duration.maxMs)),
  };
}

function buildProviderRows(stats: ProjectExecutionStatsSnapshot): ProviderReliabilityRow[] {
  return [...(stats.providers || [])].map((provider) => {
    const providerModels = (stats.models || []).filter((model) => model.provider === provider.id);
    const completedCount = providerModels.reduce((sum, model) => sum + model.statusCounts.completed, 0);
    const failedCount = providerModels.reduce((sum, model) => sum + model.statusCounts.failed, 0);
    const cancelledCount = providerModels.reduce((sum, model) => sum + model.statusCounts.cancelled, 0);
    const runningCount = providerModels.reduce((sum, model) => sum + model.statusCounts.running, 0);
    const finishedCount = completedCount + failedCount + cancelledCount;
    const successRate = finishedCount > 0 ? completedCount / finishedCount : null;
    const sourceRows = buildSourceRows(provider.usage);
    const sourceSummary = summarizeSourceRows(sourceRows);
    const failureRate = finishedCount > 0 ? failedCount / finishedCount : 0;
    const sourceUncertaintyRate = sourceSummary.total > 0
      ? (sourceSummary.fallbackCount * 0.45 + sourceSummary.failureRiskCount) / sourceSummary.total
      : provider.usage.invocationCount > 0 ? 0.5 : 0;
    const riskScore = (failureRate * 100)
      + sourceUncertaintyRate * 44
      + Math.min(20, failedCount * 6)
      + Math.min(12, provider.usage.invocationCount / 10);

    return {
      provider,
      sourceRows,
      sourceSummaryLabel: sourceSummary.label,
      sourceSummaryDetail: sourceSummary.detail,
      sourceTone: sourceSummary.tone,
      completedCount,
      failedCount,
      cancelledCount,
      runningCount,
      finishedCount,
      successRate,
      duration: combineProviderDuration(providerModels),
      riskScore,
    };
  }).sort((left, right) => {
    const riskDelta = right.riskScore - left.riskScore;
    if (Math.abs(riskDelta) >= 0.01) return riskDelta;
    const volumeDelta = right.provider.usage.totalTokens - left.provider.usage.totalTokens;
    return volumeDelta !== 0 ? volumeDelta : left.provider.label.localeCompare(right.provider.label);
  });
}

const StudioMetricTile: FunctionComponent<{
  label: string;
  value: string;
  detail: string;
  toneClass?: string;
  icon?: ComponentType<any>;
}> = ({ label, value, detail, toneClass = "text-slate-500 dark:text-slate-400", icon: Icon }) => (
  <div className={`${SUBPANEL_CLASS} p-4`}>
    <div className="flex items-center justify-between gap-3">
      <div className={`text-[10px] font-bold uppercase tracking-[0.18em] ${toneClass}`}>{label}</div>
      {Icon ? <Icon className={`h-3.5 w-3.5 ${toneClass}`} strokeWidth={2.2} aria-hidden="true" /> : null}
    </div>
    <div className="mt-2 break-words text-xl font-black text-slate-900 dark:text-white">{value}</div>
    <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{detail}</div>
  </div>
);

const EmptyTelemetryPanel: FunctionComponent<{
  title: string;
  detail: string;
}> = ({ title, detail }) => (
  <div className={`${SUBPANEL_CLASS} border-dashed px-4 py-10 text-center`}>
    <div className="text-sm font-black text-slate-700 dark:text-slate-200">{title}</div>
    <div className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">{detail}</div>
  </div>
);

const SourceCountCard: FunctionComponent<{
  row: SourceRow;
}> = ({ row }) => {
  const Icon = row.icon;
  return (
    <div className={`${SUBPANEL_CLASS} p-4`}>
      <div className="flex items-center justify-between gap-3">
        <div className={`inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] ${SOURCE_TEXT_CLASS[row.tone]}`}>
          <Icon className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
          {row.label}
        </div>
        <div className="text-[11px] font-mono text-slate-400">
          {row.share !== null ? formatPercent(row.share * 100) : "—"}
        </div>
      </div>
      <div className="mt-3 text-2xl font-black text-slate-900 dark:text-white">{row.count.toLocaleString()}</div>
      <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{row.detail}</div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/[0.05] dark:bg-white/[0.06]">
        <div
          className={`h-full rounded-full ${row.tone === "strong"
            ? "bg-status-green"
            : row.tone === "fallback"
              ? "bg-amber-500/75"
              : row.tone === "critical"
                ? "bg-rose-500/70"
                : "bg-slate-500/45"}`}
          style={{ width: `${row.share !== null ? Math.max(4, row.share * 100) : 0}%` }}
        />
      </div>
    </div>
  );
};

const ProviderReliabilityCard: FunctionComponent<{
  row: ProviderReliabilityRow;
}> = ({ row }) => {
  const { provider } = row;
  const { icon: Icon, bg, text } = getProviderIcon(provider.provider);
  const successTone = getSuccessTone(row.successRate);
  const riskLevel = row.riskScore >= 55 ? "high" : row.riskScore >= 25 ? "medium" : "low";
  const providerActiveVsWall = provider.usage.wallTimeMs > 0 ? provider.usage.activeTimeMs / provider.usage.wallTimeMs : null;

  return (
    <div className={`${PANEL_CLASS} p-5`}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className={`rounded-xl p-2 ${bg} ${text}`}>
            <Icon className="h-4 w-4" strokeWidth={2.1} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="break-words text-base font-black text-slate-900 dark:text-white" title={provider.label}>{provider.label}</div>
            <div className="mt-1 break-words text-sm text-slate-500 dark:text-slate-400">{provider.secondaryLabel ?? "No secondary label"}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${SOURCE_TONE_CLASS[row.sourceTone]}`}>
                {row.sourceSummaryLabel}
              </div>
              <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${RISK_TONE_CLASS[riskLevel]}`}>
                {riskLevel} risk
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] ${CHIP_CLASS}`}>
            <span className="text-base font-black normal-case tracking-tight text-slate-900 dark:text-white">
              {provider.usage.totalTokens > 0 ? formatTokens(provider.usage.totalTokens) : "—"}
            </span>
            <span className="text-slate-400">tokens</span>
          </div>
          <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] ${CHIP_CLASS}`}>
            <span className="text-base font-black normal-case tracking-tight text-slate-900 dark:text-white">
              {provider.usage.invocationCount.toLocaleString()}
            </span>
            <span className="text-slate-400">calls</span>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StudioMetricTile
          label="Failures"
          value={row.failedCount.toLocaleString()}
          detail={`${row.completedCount.toLocaleString()} completed · ${row.runningCount.toLocaleString()} running · ${row.cancelledCount.toLocaleString()} cancelled`}
          toneClass={row.failedCount > 0 ? "text-rose-700 dark:text-rose-300" : "text-status-green"}
          icon={row.failedCount > 0 ? AlertTriangle : CheckCircle2}
        />
        <div className={`${SUBPANEL_CLASS} p-4`}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Success Rate</div>
            <ShieldCheck className="h-3.5 w-3.5 text-slate-400" strokeWidth={2.2} aria-hidden="true" />
          </div>
          <div className="mt-2">
            <span className={`inline-flex rounded-full border px-3 py-1.5 text-lg font-black ${SUCCESS_TONE_CLASS[successTone]}`}>
              {formatSuccessRate(row.successRate)}
            </span>
          </div>
          <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            {row.finishedCount > 0 ? `${row.finishedCount.toLocaleString()} finished model runs` : "No finished model runs"}
          </div>
        </div>
        <StudioMetricTile
          label="Token Volume"
          value={formatTokens(provider.usage.totalTokens)}
          detail={provider.usage.invocationCount > 0 ? `${formatTokens(Math.round(provider.usage.totalTokens / provider.usage.invocationCount))}/call` : "No calls yet"}
          toneClass="text-signal-600 dark:text-signal-400"
        />
        <StudioMetricTile
          label="Active Time"
          value={formatStatsDuration(provider.usage.activeTimeMs)}
          detail={providerActiveVsWall !== null ? `${formatPercent(providerActiveVsWall * 100)} active utilization` : "Wall time not tracked"}
          toneClass="text-amber-600 dark:text-amber-400"
          icon={TimerReset}
        />
        <StudioMetricTile
          label="Duration"
          value={row.duration.sampleCount > 0 ? formatStatsDuration(row.duration.p50Ms) : "—"}
          detail={row.duration.sampleCount > 0 ? `${row.duration.sampleCount.toLocaleString()} samples · p95 ${formatStatsDuration(row.duration.p95Ms)}` : "No duration samples"}
          toneClass="text-cyan-600 dark:text-cyan-400"
          icon={Clock3}
        />
        <StudioMetricTile
          label="Source Confidence"
          value={row.sourceSummaryLabel}
          detail={row.sourceSummaryDetail}
          toneClass={SOURCE_TEXT_CLASS[row.sourceTone]}
        />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-5">
        {row.sourceRows.map((sourceRow) => (
          <div key={sourceRow.source} className={`rounded-[var(--stats-chip-radius)] border px-3 py-2 ${SOURCE_TONE_CLASS[sourceRow.tone]}`}>
            <div className="text-[9px] font-bold uppercase tracking-[0.14em]">{sourceRow.label}</div>
            <div className="mt-1 text-sm font-black">{sourceRow.count.toLocaleString()}</div>
          </div>
        ))}
      </div>

      <div className="mt-5">
        <TokenFlowBar
          input={provider.usage.inputTokens}
          cached={provider.usage.cachedInputTokens}
          output={provider.usage.outputTokens}
          reasoning={provider.usage.reasoningOutputTokens}
          total={provider.usage.totalTokens}
        />
      </div>
    </div>
  );
};

export const ReliabilityStudio: FunctionComponent<{
  stats: ProjectExecutionStatsSnapshot;
  providerSegments: SegmentDefinition[];
  sourceSegments: SegmentDefinition[];
}> = ({ stats, providerSegments, sourceSegments }) => {
  const sourceSummary = buildTelemetrySourceSummary(stats.usage);
  const sourceRows = buildSourceRows(stats.usage);
  const sourceAudit = summarizeSourceRows(sourceRows);
  const providerRows = buildProviderRows(stats);
  const finishedCount = stats.statusCounts.completed + stats.statusCounts.failed + stats.statusCounts.cancelled;
  const successRate = finishedCount > 0 ? stats.statusCounts.completed / finishedCount : null;
  const successTone = getSuccessTone(successRate);
  const fallbackCount = sourceRows.find((row) => row.source === "estimated")!.count
    + sourceRows.find((row) => row.source === "unknown")!.count;
  const failureRiskCount = sourceRows.find((row) => row.source === "unavailable")!.count
    + sourceRows.find((row) => row.source === "unsupported")!.count;
  const highestRiskProvider = providerRows[0] || null;

  return (
    <section className="space-y-6">
      <div className={`${PANEL_CLASS} rounded-[2.2rem] p-6 md:p-7`}>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <div className="flex max-w-4xl items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[color:var(--stats-border-hairline)] bg-[color:var(--stats-surface-chip)] text-status-green">
              <ShieldCheck className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Reliability Mode</div>
              <div className="mt-1 break-words text-2xl font-black tracking-tight text-slate-900 dark:text-white">Provider confidence & failure risk</div>
              <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                Telemetry confidence, source mix, provider health, fallback usage, and failure pressure for the selected Stats window.
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${SOURCE_TONE_CLASS[sourceAudit.tone]}`}>
              {sourceSummary.label} confidence
            </div>
            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${SUCCESS_TONE_CLASS[successTone]}`}>
              {formatSuccessRate(successRate)} success
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StudioMetricTile
            label="Telemetry Confidence"
            value={sourceSummary.label}
            detail={sourceSummary.detail}
            toneClass={SOURCE_TEXT_CLASS[sourceAudit.tone]}
            icon={ShieldCheck}
          />
          <StudioMetricTile
            label="Fallback Usage"
            value={fallbackCount.toLocaleString()}
            detail={`${sourceRows.find((row) => row.source === "estimated")!.count.toLocaleString()} estimated · ${sourceRows.find((row) => row.source === "unknown")!.count.toLocaleString()} unknown`}
            toneClass="text-amber-700 dark:text-amber-300"
            icon={Sparkles}
          />
          <StudioMetricTile
            label="Failure Pressure"
            value={stats.statusCounts.failed.toLocaleString()}
            detail={`${failureRiskCount.toLocaleString()} unavailable or unsupported source counts`}
            toneClass={stats.statusCounts.failed > 0 || failureRiskCount > 0 ? "text-rose-700 dark:text-rose-300" : "text-status-green"}
            icon={stats.statusCounts.failed > 0 || failureRiskCount > 0 ? AlertTriangle : CheckCircle2}
          />
          <StudioMetricTile
            label="Provider Coverage"
            value={providerRows.length > 0 ? `${providerRows.length.toLocaleString()} providers` : "No providers"}
            detail={highestRiskProvider ? `Highest risk: ${highestRiskProvider.provider.label}` : "No provider telemetry landed"}
            toneClass="text-cyan-600 dark:text-cyan-400"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1.02fr_0.98fr]">
        {sourceSegments.length > 0 ? (
          <DonutCard
            title="Telemetry Source Mix"
            eyebrow="Source Confidence"
            description="Reported, estimated, unavailable, unsupported, and unknown invocation-source counts across this window."
            centerValue={String(sourceAudit.total)}
            centerLabel="source counts"
            segments={sourceSegments}
          />
        ) : (
          <div className={`${PANEL_CLASS} p-6`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Source Confidence</div>
            <div className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">Telemetry Source Mix</div>
            <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              Reported, estimated, unavailable, unsupported, and unknown invocation-source counts across this window.
            </div>
            <div className="mt-6">
              <EmptyTelemetryPanel
                title="No telemetry source segments for this window."
                detail="Provider invocation counts may still exist, but the snapshot did not include source-segment lanes to chart."
              />
            </div>
          </div>
        )}
        {providerSegments.length > 0 ? (
          <DonutCard
            title="Provider Share"
            eyebrow="Volume Context"
            description="Token volume by provider, shown beside confidence and risk signals so high-volume providers stay easy to triage."
            centerValue={formatTokens(stats.usage.totalTokens)}
            centerLabel="token volume"
            segments={providerSegments}
          />
        ) : (
          <div className={`${PANEL_CLASS} p-6`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Volume Context</div>
            <div className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">Provider Share</div>
            <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              Token volume by provider appears here when the selected window includes provider segments.
            </div>
            <div className="mt-6">
              <EmptyTelemetryPanel
                title="No provider segments for this window."
                detail="Provider reliability cards will still appear below when provider rows exist without chartable token share."
              />
            </div>
          </div>
        )}
      </div>

      <div className={`${PANEL_CLASS} p-6`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Source Count Board</div>
            <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              Invocation-source counts are separated so estimated and unknown data are clear without treating fallback estimates as failures.
            </div>
          </div>
          <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 ${CHIP_CLASS}`}>
            {sourceAudit.total.toLocaleString()} counted
          </div>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {sourceRows.map((row) => <SourceCountCard key={row.source} row={row} />)}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Provider Confidence Board</div>
            <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              Providers are sorted by risk first, then token volume. Cards surface failures, success rate, token volume, active time, duration, and source confidence.
            </div>
          </div>
          <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 ${CHIP_CLASS}`}>
            {providerRows.length.toLocaleString()} providers
          </div>
        </div>
        {providerRows.length === 0 ? (
          <EmptyTelemetryPanel
            title="No provider telemetry for this window."
            detail="Provider reliability appears after tracked invocations record provider usage or status summaries."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {providerRows.map((row) => <ProviderReliabilityCard key={row.provider.id} row={row} />)}
          </div>
        )}
      </div>

      <div className={`${PANEL_CLASS} p-6`}>
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-500" strokeWidth={2} aria-hidden="true" />
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Fallback & Error Audit</div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className={SUBPANEL_CLASS}>
            <div className="text-sm font-semibold text-slate-900 dark:text-white">Fallback mix</div>
            <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              {fallbackCount > 0
                ? `${fallbackCount.toLocaleString()} invocations relied on estimated or unknown source counters. Estimates remain usable, but precision is lower than provider-reported counts.`
                : "No estimated or unknown invocation-source counts were recorded in this window."}
            </div>
          </div>
          <div className={SUBPANEL_CLASS}>
            <div className="text-sm font-semibold text-slate-900 dark:text-white">Failure risk</div>
            <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              {stats.statusCounts.failed > 0 || failureRiskCount > 0
                ? `${stats.statusCounts.failed.toLocaleString()} invocations failed and ${failureRiskCount.toLocaleString()} source counts were unavailable or unsupported.`
                : "No failed invocations or unavailable source counts were recorded in this window."}
            </div>
          </div>
          <div className={SUBPANEL_CLASS}>
            <div className="text-sm font-semibold text-slate-900 dark:text-white">Duration coverage</div>
            <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              {stats.duration.sampleCount > 0
                ? `Latency is backed by ${stats.duration.sampleCount.toLocaleString()} samples: p50 ${formatStatsDuration(stats.duration.p50Ms)}, p95 ${formatStatsDuration(stats.duration.p95Ms)}.`
                : "No duration samples were recorded, so latency remains unavailable rather than inferred."}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
