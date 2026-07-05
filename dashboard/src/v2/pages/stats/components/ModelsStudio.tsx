import type { FunctionComponent } from "preact";
import {
  Brain,
  Activity,
  BarChart3,
  Clock3,
  Cpu,
  Database,
  DollarSign,
  Gauge,
  ShieldCheck,
  TrendingUp,
  Zap,
  type LucideIcon,
} from "lucide-preact";
import type { ExecutionModelStatsSummary, ProjectExecutionStatsSnapshot } from "../../../types.js";
import { formatStatsDuration, formatTokens, formatDateTime, formatPercent, formatCost } from "../stats-utils.js";
import {
  PANEL_CLASS,
  SUBPANEL_CLASS,
  CHIP_CLASS,
  DASHED_EMPTY_CLASS,
  DonutCard,
  STATUS_TONE_CLASS,
  StudioHeader,
  TEXT_DETAIL_CLASS,
  TEXT_LABEL_CLASS,
  TEXT_VALUE_CLASS,
  TokenFlowBar,
  getProviderIcon,
} from "./StatsShared.js";
import {
  buildModelHighlights,
  buildModelSegments,
  computeUsageEfficiency,
  formatSuccessRate,
  getSuccessTone,
  type ModelHighlight,
} from "../model-insights.js";

const LOW_SAMPLE_THRESHOLD = 3;

const SUCCESS_TONE_CLASS: Record<ReturnType<typeof getSuccessTone>, string> = {
  strong: STATUS_TONE_CLASS.positive,
  warn: STATUS_TONE_CLASS.warning,
  critical: STATUS_TONE_CLASS.negative,
  neutral: STATUS_TONE_CLASS.neutral,
};

const formatEfficiencyPercent = (value: number | null): string => (
  value === null ? "—" : formatPercent(value * 100)
);

const formatMetricTokens = (value: number | null): string => (
  value === null ? "—" : formatTokens(Math.round(value))
);

const formatVelocity = (value: number | null): string => (
  value === null || value <= 0 ? "—" : `${formatTokens(Math.round(value))} tok/s`
);

const formatPricingValue = (value: number | null): string => (
  value === null || value <= 0 ? "—" : formatCost(value)
);

const formatShare = (value: number): string => (
  value > 0 ? `${value.toFixed(1)}% share` : "no token share"
);

const getInvocationSignal = (count: number): string => {
  if (count === 0) {
    return "No calls yet";
  }
  if (count < LOW_SAMPLE_THRESHOLD) {
    return "Low sample";
  }
  return `${count.toLocaleString()} calls`;
};

export const HighlightTile: FunctionComponent<{
  icon: LucideIcon;
  label: string;
  highlight: ModelHighlight | null;
  tone: string;
}> = ({ icon: Icon, label, highlight, tone }) => (
  <div className={`${SUBPANEL_CLASS} p-4`}>
    <div className={`inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] ${tone}`}>
      <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
      {label}
    </div>
    <div className={`mt-3 break-words text-base font-semibold ${TEXT_VALUE_CLASS}`}>
      {highlight ? highlight.model.label : "—"}
    </div>
    <div className={`mt-1 text-xs font-medium ${TEXT_DETAIL_CLASS}`}>
      {highlight ? highlight.value : "Not enough telemetry yet"}
    </div>
    {highlight?.detail ? <div className={`mt-1 text-[10px] font-bold uppercase tracking-[0.14em] ${TEXT_LABEL_CLASS}`}>{highlight.detail}</div> : null}
  </div>
);

export const ModelMetric: FunctionComponent<{
  label: string;
  value: string;
  detail?: string;
}> = ({ label, value, detail }) => (
  <div className={`${SUBPANEL_CLASS} p-4`}>
    <div className={`text-[10px] font-bold uppercase tracking-[0.16em] ${TEXT_LABEL_CLASS}`}>{label}</div>
    <div className={`mt-2 text-base font-semibold ${value === "—" ? TEXT_DETAIL_CLASS : TEXT_VALUE_CLASS}`}>{value}</div>
    {detail ? <div className={`mt-1 text-[10px] font-bold uppercase tracking-[0.14em] ${TEXT_LABEL_CLASS}`}>{detail}</div> : null}
  </div>
);

export const ModelCard: FunctionComponent<{
  model: ExecutionModelStatsSummary;
  rank: number;
  shareOfTotal: number;
}> = ({ model, rank, shareOfTotal }) => {
  const { icon: Icon, bg, text } = getProviderIcon(model.provider);
  const efficiency = computeUsageEfficiency(model.usage);
  const successTone = getSuccessTone(model.successRate);
  const hasDuration = model.duration.sampleCount > 0;
  const hasLowTelemetry = model.usage.invocationCount > 0 && model.usage.invocationCount < LOW_SAMPLE_THRESHOLD;
  const hasCost = Number.isFinite(model.usage.totalCostUsd) && model.usage.totalCostUsd > 0;
  const costPerCall = hasCost && model.usage.invocationCount > 0
    ? model.usage.totalCostUsd / model.usage.invocationCount
    : null;
  const costPerMillionTokens = hasCost && model.usage.totalTokens > 0
    ? model.usage.totalCostUsd / (model.usage.totalTokens / 1_000_000)
    : null;
  const statusSummary = `${model.statusCounts.completed} completed · ${model.statusCounts.failed} failed · ${model.statusCounts.running} running · ${model.statusCounts.cancelled} cancelled`;

  return (
    <article className={`${PANEL_CLASS} p-4 md:p-5`} aria-label={`${model.label} model leaderboard rank ${rank}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className={`shrink-0 rounded-xl p-2 ${bg} ${text}`}>
            <Icon className="h-4 w-4" strokeWidth={2.1} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${CHIP_CLASS}`}>
                #{rank}
              </span>
              <h3 className="min-w-0 max-w-full break-words text-base font-black leading-tight text-[color:var(--stats-value-color)]" title={model.label}>
                {model.label}
              </h3>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-[color:var(--stats-detail-color)]">
              <span className="capitalize">{model.provider}</span>
              <span aria-hidden="true">·</span>
              <span>{formatShare(shareOfTotal)}</span>
              <span aria-hidden="true">·</span>
              <span>{getInvocationSignal(model.usage.invocationCount)}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start">
          <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${CHIP_CLASS}`}>
            Volume rank
          </div>
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] ${CHIP_CLASS}`}>
            <BarChart3 className="h-3.5 w-3.5 text-[color:var(--stats-signal-text)]" strokeWidth={2.2} />
            <span className="text-base font-black normal-case text-[color:var(--stats-value-color)]">
              {formatTokens(model.usage.totalTokens)}
            </span>
            <span className="text-[color:var(--stats-label-color)]">tokens</span>
          </div>
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] ${CHIP_CLASS}`}>
            <DollarSign className="h-3.5 w-3.5 text-[color:var(--stats-positive-text)]" strokeWidth={2.2} />
            <span className="text-base font-black normal-case text-[color:var(--stats-value-color)]">
              {formatPricingValue(hasCost ? model.usage.totalCostUsd : null)}
            </span>
            <span className="text-[color:var(--stats-label-color)]">cost</span>
          </div>
          <div className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${SUCCESS_TONE_CLASS[successTone]}`}>
            <ShieldCheck className="h-3 w-3" strokeWidth={2.4} />
            {formatSuccessRate(model.successRate)}
          </div>
        </div>
      </div>

      {hasLowTelemetry || !hasDuration ? (
        <div className={`${DASHED_EMPTY_CLASS} mt-4 py-3 text-left text-xs font-medium ${TEXT_DETAIL_CLASS}`}>
          {hasLowTelemetry ? "Leaderboard placement is based on limited invocation telemetry." : "Latency percentiles will appear after this model records duration samples."}
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-5">
        <ModelMetric
          label="Invocations"
          value={model.usage.invocationCount.toLocaleString()}
          detail={model.statusCounts.failed > 0 ? `${model.statusCounts.failed} failed` : "no failures"}
        />
        <ModelMetric
          label="Latency"
          value={hasDuration ? formatStatsDuration(model.duration.p50Ms) : "—"}
          detail={hasDuration ? `p50 · p95 ${formatStatsDuration(model.duration.p95Ms)}` : "no duration samples"}
        />
        <ModelMetric
          label="Tokens / Call"
          value={formatMetricTokens(efficiency.tokensPerCall)}
          detail={model.usage.invocationCount > 0 ? "avg volume" : "no calls"}
        />
        <ModelMetric
          label="Success"
          value={formatSuccessRate(model.successRate)}
          detail={model.successRate === null ? "pending outcomes" : statusSummary}
        />
        <ModelMetric
          label="Cost"
          value={formatPricingValue(hasCost ? model.usage.totalCostUsd : null)}
          detail={costPerCall !== null ? `${formatCost(costPerCall)}/call` : "no pricing signal"}
        />
        <ModelMetric
          label="$ / 1M Tok"
          value={formatPricingValue(costPerMillionTokens)}
          detail={costPerMillionTokens !== null ? "blended token rate" : "pricing unavailable"}
        />
        <ModelMetric
          label="Output Velocity"
          value={formatVelocity(efficiency.outputTokensPerSecond)}
          detail={efficiency.outputTokensPerSecond === null ? "no active output" : "generated output"}
        />
        <ModelMetric
          label="Cache Rate"
          value={formatEfficiencyPercent(efficiency.cacheHitRate)}
          detail={`${formatTokens(model.usage.cachedInputTokens)} cached`}
        />
        <ModelMetric
          label="Reasoning"
          value={formatEfficiencyPercent(efficiency.reasoningShare)}
          detail={`${formatTokens(model.usage.reasoningOutputTokens)} reasoning`}
        />
        <ModelMetric
          label="Output / Input"
          value={efficiency.outputInputRatio !== null ? efficiency.outputInputRatio.toFixed(2) : "—"}
          detail="generation ratio"
        />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-[0.85fr_1.15fr]">
        <div className={`${SUBPANEL_CLASS} p-4`}>
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">Outcome Mix</div>
          <div className="mt-2 text-sm font-semibold text-[color:var(--stats-value-color)]">{statusSummary}</div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)]">
            Last active {formatDateTime(model.lastActivityAt)}
          </div>
        </div>
        <div className={`${SUBPANEL_CLASS} p-4`}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">Token-Flow Anatomy</div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)]">{formatTokens(model.usage.totalTokens)} total</div>
          </div>
          <div className="mt-3">
            <TokenFlowBar
              input={model.usage.inputTokens}
              cached={model.usage.cachedInputTokens}
              output={model.usage.outputTokens}
              reasoning={model.usage.reasoningOutputTokens}
              total={model.usage.totalTokens}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--stats-label-color)] sm:grid-cols-4">
            <span>In {formatTokens(model.usage.inputTokens)}</span>
            <span>Cache {formatTokens(model.usage.cachedInputTokens)}</span>
            <span>Out {formatTokens(model.usage.outputTokens)}</span>
            <span>Think {formatTokens(model.usage.reasoningOutputTokens)}</span>
          </div>
        </div>
      </div>
    </article>
  );
};

export const ModelsStudio: FunctionComponent<{
  stats: ProjectExecutionStatsSnapshot;
}> = ({ stats }) => {
  const models = stats.models || [];
  const segments = buildModelSegments(models);
  const highlights = buildModelHighlights(models);
  const totalTokens = models.reduce((sum, model) => sum + model.usage.totalTokens, 0);
  const totalCalls = models.reduce((sum, model) => sum + model.usage.invocationCount, 0);
  const totalOutput = models.reduce((sum, model) => sum + model.usage.outputTokens, 0);
  const totalReasoning = models.reduce((sum, model) => sum + model.usage.reasoningOutputTokens, 0);
  const totalCached = models.reduce((sum, model) => sum + model.usage.cachedInputTokens, 0);
  const totalCost = models.reduce((sum, model) => sum + model.usage.totalCostUsd, 0);
  const sampledModels = models.filter((model) => model.duration.sampleCount > 0).length;
  const sorted = [...models].sort((left, right) => {
    const delta = right.usage.totalTokens - left.usage.totalTokens;
    return delta !== 0 ? delta : left.label.localeCompare(right.label);
  });

  return (
    <section className="space-y-6">
      <div className={`${PANEL_CLASS} rounded-[2.2rem] p-6 md:p-7`}>
        <StudioHeader
          icon={Cpu}
          eyebrow="Model Intelligence"
          title="Model performance & efficiency"
          description="Per-model telemetry across the selected window — token volume, reliability, latency distribution, cache efficiency, and output velocity for every model that participated."
        />
      </div>

      {models.length === 0 ? (
        <div className={`${PANEL_CLASS} border-dashed p-10 text-center`}>
          <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-[color:var(--stats-card-border)] bg-[color:var(--stats-surface-chip)] ${TEXT_LABEL_CLASS}`}>
            <Cpu className="h-5 w-5" strokeWidth={2.2} />
          </div>
          <div className="mt-4 text-base font-semibold text-[color:var(--stats-value-color)]">No model telemetry yet</div>
          <div className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-[color:var(--stats-detail-color)]">
            This window has no model entries, so volume, latency, cache, and reasoning comparisons will appear after provider invocations are recorded.
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[0.95fr_1.05fr_0.8fr]">
            <DonutCard
              title="Model Share"
              eyebrow="Distribution"
              description="Token volume split across the models active in this window, grouped into visible lanes."
              centerValue={String(models.length)}
              centerLabel={models.length === 1 ? "model" : "models"}
              segments={segments}
            />
            <div className={`${PANEL_CLASS} p-6`}>
              <div className="flex items-center gap-3">
                <Gauge className="h-4 w-4 text-[color:var(--stats-signal-text)]" strokeWidth={2} />
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--stats-label-color)]">Efficiency Highlights</div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <HighlightTile
                  icon={TrendingUp}
                  label="Volume Leader"
                  highlight={highlights.busiest}
                  tone="text-[color:var(--stats-signal-text)]"
                />
                <HighlightTile
                  icon={Clock3}
                  label="Fastest"
                  highlight={highlights.fastest}
                  tone="text-[color:var(--stats-accent-cyan)]"
                />
                <HighlightTile
                  icon={ShieldCheck}
                  label="Most Reliable"
                  highlight={highlights.mostReliable}
                  tone="text-[color:var(--stats-positive-text)]"
                />
                <HighlightTile
                  icon={Database}
                  label="Best Cache Efficiency"
                  highlight={highlights.bestCache}
                  tone="text-[color:var(--stats-warning-text)]"
                />
                <HighlightTile
                  icon={Zap}
                  label="Highest Velocity"
                  highlight={highlights.highestVelocity}
                  tone="text-[color:var(--stats-accent-cyan)]"
                />
                <HighlightTile
                  icon={Brain}
                  label="Highest Reasoning"
                  highlight={highlights.strongestReasoning}
                  tone="text-[color:var(--stats-negative-text)]"
                />
              </div>
            </div>
            <div className={`${PANEL_CLASS} p-6`}>
              <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--stats-label-color)]">
                <Activity className="h-3.5 w-3.5 text-[color:var(--stats-signal-text)]" strokeWidth={2.2} />
                Window Volume
              </div>
              <div className="mt-4 text-2xl font-semibold text-[color:var(--stats-value-color)]">{formatTokens(totalTokens)}</div>
              <div className="mt-1 text-xs font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)]">tokens ranked by model volume</div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <ModelMetric label="Calls" value={totalCalls.toLocaleString()} detail={totalCalls < LOW_SAMPLE_THRESHOLD ? "sparse sample" : "invocations"} />
                <ModelMetric label="Output" value={formatTokens(totalOutput)} detail="generated" />
                <ModelMetric label="Cached" value={formatTokens(totalCached)} detail="input reuse" />
                <ModelMetric label="Reasoning" value={formatTokens(totalReasoning)} detail="thinking tokens" />
                <ModelMetric label="Cost" value={formatPricingValue(totalCost)} detail={totalCost > 0 ? "priced usage" : "no pricing signal"} />
              </div>
              <div className={`${DASHED_EMPTY_CLASS} mt-4 py-3 text-left text-xs leading-relaxed ${TEXT_DETAIL_CLASS}`}>
                {sampledModels === 0
                  ? "No model has duration samples yet; latency highlights and p50/p95 cells stay intentionally empty."
                  : `${sampledModels.toLocaleString()} of ${models.length.toLocaleString()} models have duration samples. Highlights prefer models with at least ${LOW_SAMPLE_THRESHOLD} calls.`}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--stats-label-color)]">Model Leaderboard</div>
                <div className="mt-2 text-sm leading-relaxed text-[color:var(--stats-detail-color)]">
                  Ranked by token volume, then model label. Each entry keeps reliability, p50/p95 latency, speed, cache, reasoning, and token anatomy visible for comparison.
                </div>
              </div>
              <div className={`self-start px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)] ${CHIP_CLASS}`}>
                Sort: tokens desc
              </div>
            </div>
            {totalTokens === 0 ? (
              <div className={`${DASHED_EMPTY_CLASS} py-5 text-left text-sm ${TEXT_DETAIL_CLASS}`}>
                Models are present, but none reported token volume in this window. Ranking falls back to labels until usage totals arrive.
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {sorted.map((model, index) => (
                <ModelCard
                  key={model.id}
                  model={model}
                  rank={index + 1}
                  shareOfTotal={totalTokens > 0 ? (model.usage.totalTokens / totalTokens) * 100 : 0}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
};
