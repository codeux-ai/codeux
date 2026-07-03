import type { ComponentType, FunctionComponent } from "preact";
import {
  Clock3,
  ShieldCheck,
  Sparkles,
  TimerReset,
} from "lucide-preact";
import type {
  ExecutionStatsEntitySummary,
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
import { buildTelemetrySourceSummary } from "../model-insights.js";

type ProviderTelemetryUsage = ExecutionStatsEntitySummary["usage"] & {
  reportedInvocationCount?: number;
  estimatedInvocationCount?: number;
};

type ProviderTelemetrySource = {
  label: string;
  tone: string;
  detail: string;
  caveat: string;
};

function getProviderTelemetrySource(
  providerUsage: ProviderTelemetryUsage,
  tokenSources: Array<{ source: TokenUsageSource; count: number }>,
): ProviderTelemetrySource {
  const source = buildTelemetrySourceSummary({
    reportedInvocationCount: providerUsage.reportedInvocationCount ?? 0,
    estimatedInvocationCount: providerUsage.estimatedInvocationCount ?? 0,
    unavailableInvocationCount: providerUsage.unavailableInvocationCount ?? 0,
    unsupportedInvocationCount: providerUsage.unsupportedInvocationCount ?? 0,
  });

  if (source.mix.total > 0) {
    if (source.tone === "strong") {
      return { label: source.label, tone: "text-status-green dark:text-status-green", detail: source.detail, caveat: source.caveat };
    }

    if (source.tone === "warn") {
      return { label: source.label, tone: "text-amber-600 dark:text-amber-400", detail: source.detail, caveat: source.caveat };
    }

    if (source.tone === "critical") {
      return { label: source.label, tone: "text-rose-600 dark:text-rose-400", detail: source.detail, caveat: source.caveat };
    }

    return { label: source.label, tone: "text-slate-500 dark:text-slate-400", detail: source.detail, caveat: source.caveat };
  }

  const aggregateSource = tokenSources.find((entry) => entry.source === "reported" && entry.count > 0)
    ? "reported"
    : tokenSources.find((entry) => entry.source === "estimated" && entry.count > 0)
      ? "estimated"
      : tokenSources.find((entry) => entry.source === "unavailable" && entry.count > 0)
        ? "unavailable"
        : tokenSources.find((entry) => entry.source === "unsupported" && entry.count > 0)
          ? "unsupported"
          : "unknown";

  if (aggregateSource === "reported") {
    return {
      label: "Reported",
      tone: "text-status-green dark:text-status-green",
      detail: "Aggregate token-source fallback",
      caveat: "Provider-specific telemetry is missing, so this provider inherits the reported aggregate mix.",
    };
  }

  if (aggregateSource === "estimated") {
    return {
      label: "Estimated",
      tone: "text-amber-600 dark:text-amber-400",
      detail: "Aggregate token-source fallback",
      caveat: "Provider-specific telemetry is missing, so this provider inherits the estimated aggregate mix.",
    };
  }

  if (aggregateSource === "unavailable") {
    return {
      label: "Unavailable",
      tone: "text-rose-600 dark:text-rose-400",
      detail: "Aggregate token-source fallback",
      caveat: "Provider-specific telemetry is missing and the aggregate mix only reports unavailable counts.",
    };
  }

  return { label: source.label, tone: "text-slate-500 dark:text-slate-400", detail: source.detail, caveat: source.caveat };
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
    <div className="mt-2 text-xl font-black text-slate-900 dark:text-white">{value}</div>
    <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{detail}</div>
  </div>
);

export const ReliabilityStudio: FunctionComponent<{
  stats: ProjectExecutionStatsSnapshot;
  providerSegments: SegmentDefinition[];
  sourceSegments: SegmentDefinition[];
}> = ({ stats, providerSegments, sourceSegments }) => {
  const sourceSummary = buildTelemetrySourceSummary(stats.usage);
  const finishedCount = stats.statusCounts.completed + stats.statusCounts.failed + stats.statusCounts.cancelled;
  const successRate = finishedCount > 0 ? stats.statusCounts.completed / finishedCount : null;
  const overallDurationSamples = stats.duration.sampleCount;
  const providerRows = [...stats.providers].sort((left, right) => {
    const delta = right.usage.totalTokens - left.usage.totalTokens;
    return delta !== 0 ? delta : left.label.localeCompare(right.label);
  });

  return (
    <section className="space-y-6">
      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1.02fr_0.98fr]">
        <DonutCard
          title="Telemetry Source Mix"
          eyebrow="Reliability"
          description="Provider-reported versus estimated, unavailable, and unsupported usage across the selected window."
          centerValue={String(sourceSummary.mix.total)}
          centerLabel="invocations"
          segments={sourceSegments}
        />
        <DonutCard
          title="Provider Share"
          eyebrow="Signal Integrity"
          description="Provider leaders over the selected period, grouped for a cleaner read under high volume."
          centerValue={formatTokens(stats.usage.totalTokens)}
          centerLabel="token volume"
          segments={providerSegments}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StudioMetricTile
          label={`Telemetry ${sourceSummary.label}`}
          value={sourceSummary.detail}
          detail={sourceSummary.caveat}
          toneClass={sourceSummary.tone === "strong"
            ? "text-status-green dark:text-status-green"
            : sourceSummary.tone === "warn"
              ? "text-amber-600 dark:text-amber-400"
              : sourceSummary.tone === "critical"
                ? "text-rose-600 dark:text-rose-400"
                : "text-slate-500 dark:text-slate-400"}
          icon={ShieldCheck}
        />
        <StudioMetricTile
          label="Status Counts"
          value={`${stats.statusCounts.completed.toLocaleString()} completed`}
          detail={`${stats.statusCounts.failed.toLocaleString()} failed · ${stats.statusCounts.running.toLocaleString()} running · ${stats.statusCounts.cancelled.toLocaleString()} cancelled`}
          toneClass="text-cyan-600 dark:text-cyan-400"
        />
        <StudioMetricTile
          label="Success Rate"
          value={successRate !== null ? formatPercent(successRate * 100) : "—"}
          detail={finishedCount > 0 ? `${finishedCount.toLocaleString()} finished invocations` : "Nothing finished yet"}
          toneClass="text-emerald-600 dark:text-emerald-400"
          icon={ShieldCheck}
        />
        <StudioMetricTile
          label="Duration Samples"
          value={`${overallDurationSamples.toLocaleString()} samples`}
          detail={overallDurationSamples > 0 ? `p50 ${formatStatsDuration(stats.duration.p50Ms)} · p95 ${formatStatsDuration(stats.duration.p95Ms)}` : "No duration data"}
          toneClass="text-amber-600 dark:text-amber-400"
          icon={Clock3}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1fr]">
        <div className={`${PANEL_CLASS} p-6`}>
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-4 w-4 text-status-green" strokeWidth={2} />
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Confidence Board</div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div className="rounded-2xl border border-status-green/16 bg-status-green/10 p-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-status-green">Reported</div>
              <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{stats.usage.reportedInvocationCount}</div>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-status-green/20">
                <div className="h-full bg-status-green" style={{ width: `${sourceSummary.mix.total > 0 ? ((stats.usage.reportedInvocationCount || 0) / sourceSummary.mix.total) * 100 : 0}%` }} />
              </div>
            </div>
            <div className="rounded-2xl border border-amber-500/16 bg-amber-500/10 p-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-600 dark:text-amber-400">Estimated</div>
              <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{stats.usage.estimatedInvocationCount}</div>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-amber-500/20">
                <div className="h-full bg-amber-500" style={{ width: `${sourceSummary.mix.total > 0 ? ((stats.usage.estimatedInvocationCount || 0) / sourceSummary.mix.total) * 100 : 0}%` }} />
              </div>
            </div>
            <div className="rounded-2xl border border-rose-500/16 bg-rose-500/10 p-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-rose-600 dark:text-rose-400">Unavailable</div>
              <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{stats.usage.unavailableInvocationCount}</div>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-rose-500/20">
                <div className="h-full bg-rose-500" style={{ width: `${sourceSummary.mix.total > 0 ? ((stats.usage.unavailableInvocationCount || 0) / sourceSummary.mix.total) * 100 : 0}%` }} />
              </div>
            </div>
            <div className="rounded-2xl border border-slate-500/16 bg-slate-500/10 p-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600 dark:text-slate-300">Unsupported</div>
              <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{stats.usage.unsupportedInvocationCount}</div>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-500/20">
                <div className="h-full bg-slate-500" style={{ width: `${sourceSummary.mix.total > 0 ? ((stats.usage.unsupportedInvocationCount || 0) / sourceSummary.mix.total) * 100 : 0}%` }} />
              </div>
            </div>
          </div>
        </div>
        <div className={`${PANEL_CLASS} p-6`}>
          <div className="flex items-center gap-3">
            <Sparkles className="h-4 w-4 text-amber-500" strokeWidth={2} />
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Audit Notes</div>
          </div>
          <div className="mt-4 space-y-4">
            <div className={SUBPANEL_CLASS}>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">Source mix</div>
              <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                {sourceSummary.caveat}
              </div>
            </div>
            <div className={SUBPANEL_CLASS}>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">Duration coverage</div>
              <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                {overallDurationSamples > 0
                  ? `Latency is backed by ${overallDurationSamples.toLocaleString()} samples, so p50 and p95 are decision-ready for this window.`
                  : "No duration samples were recorded, so latency metrics remain unavailable rather than inferred."}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Provider Breakdown</div>
          <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            Per-provider token anatomy, invocation volume, compute time, and telemetry reliability for the selected window.
          </div>
        </div>
        {providerRows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-black/[0.08] px-4 py-8 text-center text-sm text-slate-400 dark:border-white/[0.08]">
            No provider telemetry for this window.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {providerRows.map((provider) => {
              const { icon: Icon, bg, text } = getProviderIcon(provider.provider);
              const providerUsage = provider.usage as ProviderTelemetryUsage;
              const sourceQuality = getProviderTelemetrySource(providerUsage, stats.tokenSources);
              const providerModels = (stats.models || []).filter((model) => model.provider === provider.id);
              const durationSamples = providerModels.reduce((sum, model) => sum + model.duration.sampleCount, 0);
              const weightedLatencyMs = durationSamples > 0
                ? providerModels.reduce((sum, model) => sum + model.duration.avgMs * model.duration.sampleCount, 0) / durationSamples
                : null;
              const completedCount = providerModels.reduce((sum, model) => sum + model.statusCounts.completed, 0);
              const failedCount = providerModels.reduce((sum, model) => sum + model.statusCounts.failed, 0);
              const cancelledCount = providerModels.reduce((sum, model) => sum + model.statusCounts.cancelled, 0);
              const runningCount = providerModels.reduce((sum, model) => sum + model.statusCounts.running, 0);
              const finishedCountForProvider = completedCount + failedCount + cancelledCount;
              const successRateForProvider = finishedCountForProvider > 0 ? completedCount / finishedCountForProvider : null;
              const providerActiveVsWall = provider.usage.wallTimeMs > 0 ? provider.usage.activeTimeMs / provider.usage.wallTimeMs : null;

              return (
                <div key={provider.id} className={`${PANEL_CLASS} p-5`}>
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className={`rounded-xl p-2 ${bg} ${text}`}>
                        <Icon className="h-4 w-4" strokeWidth={2.1} />
                      </div>
                      <div className="min-w-0">
                        <div className="break-words text-base font-black text-slate-900 dark:text-white" title={provider.label}>{provider.label}</div>
                        <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{provider.secondaryLabel ?? "No secondary label"}</div>
                        <div className={`mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] ${sourceQuality.tone}`}>
                          {sourceQuality.label}
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
                      label="Telemetry Quality"
                      value={sourceQuality.label}
                      detail={sourceQuality.detail}
                      toneClass={sourceQuality.tone === "strong"
                        ? "text-status-green dark:text-status-green"
                        : sourceQuality.tone === "warn"
                          ? "text-amber-600 dark:text-amber-400"
                          : sourceQuality.tone === "critical"
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-slate-500 dark:text-slate-400"}
                    />
                    <StudioMetricTile
                      label="Success Rate"
                      value={successRateForProvider !== null ? formatPercent(successRateForProvider * 100) : "—"}
                      detail={finishedCountForProvider > 0 ? `${finishedCountForProvider.toLocaleString()} finished from models` : "No finished model runs"}
                      toneClass="text-emerald-600 dark:text-emerald-400"
                      icon={ShieldCheck}
                    />
                    <StudioMetricTile
                      label="Duration Samples"
                      value={`${durationSamples.toLocaleString()} samples`}
                      detail={durationSamples > 0 ? `p50 ${formatStatsDuration(weightedLatencyMs || 0)}` : "No latency samples"}
                      toneClass="text-cyan-600 dark:text-cyan-400"
                      icon={Clock3}
                    />
                    <StudioMetricTile
                      label="Tokens / Call"
                      value={provider.usage.invocationCount > 0 ? `${formatTokens(Math.round(provider.usage.totalTokens / provider.usage.invocationCount))}/call` : "—"}
                      detail={provider.usage.invocationCount > 0 ? "Average per invocation" : "No calls yet"}
                      toneClass="text-rose-600 dark:text-rose-400"
                    />
                    <StudioMetricTile
                      label="Status Counts"
                      value={`${completedCount.toLocaleString()} completed`}
                      detail={`${failedCount.toLocaleString()} failed · ${runningCount.toLocaleString()} running · ${cancelledCount.toLocaleString()} cancelled`}
                      toneClass="text-slate-500 dark:text-slate-400"
                    />
                    <StudioMetricTile
                      label="Active Time"
                      value={formatStatsDuration(provider.usage.activeTimeMs)}
                      detail={providerActiveVsWall !== null ? `${formatPercent(providerActiveVsWall * 100)} active utilization` : "Wall time not tracked"}
                      toneClass="text-amber-600 dark:text-amber-400"
                      icon={TimerReset}
                    />
                  </div>

                  <div className="mt-4">
                    <TokenFlowBar
                      input={provider.usage.inputTokens}
                      cached={provider.usage.cachedInputTokens}
                      output={provider.usage.outputTokens}
                      reasoning={provider.usage.reasoningOutputTokens}
                      total={provider.usage.totalTokens}
                    />
                  </div>

                  <div className="mt-4 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                    {sourceQuality.caveat}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
