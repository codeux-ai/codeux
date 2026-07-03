import type { FunctionComponent } from "preact";
import {
  Brain,
  Activity,
  Clock3,
  Cpu,
  Database,
  Gauge,
  ShieldCheck,
  TrendingUp,
  Zap,
} from "lucide-preact";
import type { ExecutionModelStatsSummary, ProjectExecutionStatsSnapshot } from "../../../types.js";
import { formatStatsDuration, formatTokens, formatDateTime, formatPercent } from "../stats-utils.js";
import {
  PANEL_CLASS,
  SUBPANEL_CLASS,
  CHIP_CLASS,
  DonutCard,
  StudioHeader,
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

const SUCCESS_TONE_CLASS: Record<ReturnType<typeof getSuccessTone>, string> = {
  strong: "border-status-green/20 bg-status-green/[0.08] text-status-green",
  warn: "border-amber-500/22 bg-amber-500/[0.08] text-amber-700 dark:text-amber-300",
  critical: "border-rose-500/22 bg-rose-500/[0.08] text-rose-700 dark:text-rose-300",
  neutral: "border-slate-500/20 bg-slate-500/10 text-slate-500 dark:text-slate-400",
};

const HighlightTile: FunctionComponent<{
  icon: typeof Zap;
  label: string;
  highlight: ModelHighlight | null;
  tone: string;
}> = ({ icon: Icon, label, highlight, tone }) => (
  <div className={`${SUBPANEL_CLASS} p-4`} aria-label={`${label}: ${highlight ? `${highlight.model.label}, ${highlight.value}` : "not enough telemetry yet"}`}>
    <div className={`inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] ${tone}`}>
      <Icon className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
      {label}
    </div>
    <div className="mt-3 break-words text-lg font-black text-slate-900 dark:text-white">
      {highlight ? highlight.model.label : "—"}
    </div>
    <div className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
      {highlight ? highlight.value : "Not enough telemetry yet"}
    </div>
    {highlight?.detail ? <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{highlight.detail}</div> : null}
  </div>
);

const ModelMetric: FunctionComponent<{
  label: string;
  value: string;
  detail?: string;
  tone?: string;
}> = ({ label, value, detail, tone = "text-slate-400" }) => (
  <div className={`${SUBPANEL_CLASS} p-4`} aria-label={`${label}: ${value}${detail ? `. ${detail}` : ""}`}>
    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{label}</div>
    <div className={`mt-2 text-lg font-black text-slate-900 dark:text-white ${tone}`}>{value}</div>
    {detail ? <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{detail}</div> : null}
  </div>
);

const ModelCard: FunctionComponent<{
  model: ExecutionModelStatsSummary;
  rank: number;
  shareOfTotal: number;
}> = ({ model, rank, shareOfTotal }) => {
  const { icon: Icon, bg, text } = getProviderIcon(model.provider);
  const efficiency = computeUsageEfficiency(model.usage);
  const successTone = getSuccessTone(model.successRate);
  const successToneText = successTone === "strong"
    ? "text-status-green dark:text-status-green"
    : successTone === "warn"
      ? "text-amber-600 dark:text-amber-400"
      : successTone === "critical"
        ? "text-rose-600 dark:text-rose-400"
        : "text-slate-500 dark:text-slate-400";
  const statusSummary = `${model.statusCounts.completed} completed · ${model.statusCounts.failed} failed · ${model.statusCounts.running} running · ${model.statusCounts.cancelled} cancelled`;
  const outputVelocity = model.usage.outputTokens > 0 && model.usage.activeTimeMs > 0
    ? Math.round(model.usage.outputTokens / (model.usage.activeTimeMs / 1000))
    : null;

  return (
    <article className={`${PANEL_CLASS} p-4 md:p-5`} aria-label={`${model.label} model comparison. ${formatTokens(model.usage.totalTokens)} tokens, ${formatSuccessRate(model.successRate)} success.`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className={`rounded-xl p-2 ${bg} ${text}`}>
            <Icon className="h-4 w-4" strokeWidth={2.1} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">#{rank}</span>
              <span className="min-w-0 break-all text-base font-black leading-tight text-slate-900 dark:text-white" title={model.label}>{model.label}</span>
            </div>
            <div className="mt-1 break-words text-sm text-slate-500 dark:text-slate-400 capitalize">
              {model.provider} · {shareOfTotal > 0 ? `${shareOfTotal.toFixed(1)}% of window volume` : "no token volume"}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start">
          <div className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${CHIP_CLASS}`}>
            #{rank} by volume
          </div>
          <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] ${CHIP_CLASS}`}>
            <span className="text-base font-black normal-case tracking-tight text-slate-900 dark:text-white">
              {formatTokens(model.usage.totalTokens)}
            </span>
            <span className="text-slate-400">tokens</span>
          </div>
          <div className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${SUCCESS_TONE_CLASS[successTone]}`}>
            <ShieldCheck className="h-3 w-3" strokeWidth={2.4} />
            {formatSuccessRate(model.successRate)}
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <ModelMetric
          label="Invocations"
          value={model.usage.invocationCount.toLocaleString()}
          detail={model.statusCounts.failed > 0 ? `${model.statusCounts.failed} failed` : "no failures"}
        />
        <ModelMetric
          label="Median Latency"
          value={model.duration.sampleCount > 0 ? formatStatsDuration(model.duration.p50Ms) : "—"}
          detail={model.duration.sampleCount > 0 ? `p95 ${formatStatsDuration(model.duration.p95Ms)}` : "no samples"}
          tone={model.duration.sampleCount > 0 ? "text-cyan-600 dark:text-cyan-400" : "text-slate-500 dark:text-slate-400"}
        />
        <ModelMetric
          label="Success Rate"
          value={formatSuccessRate(model.successRate)}
          detail={statusSummary}
          tone={successToneText}
        />
        <ModelMetric
          label="Cache Hit Rate"
          value={efficiency.cacheHitRate !== null ? `${Math.round(efficiency.cacheHitRate * 100)}%` : "—"}
          detail={`${formatTokens(model.usage.cachedInputTokens)} cached`}
          tone="text-amber-600 dark:text-amber-400"
        />
        <ModelMetric
          label="Token Volume"
          value={formatTokens(model.usage.totalTokens)}
          detail={shareOfTotal > 0 ? `${shareOfTotal.toFixed(1)}% of window` : "no token volume"}
          tone="text-signal-600 dark:text-signal-400"
        />
        <ModelMetric
          label="Tokens / Call"
          value={efficiency.tokensPerCall !== null ? formatTokens(Math.round(efficiency.tokensPerCall)) : "—"}
          detail="avg per invocation"
        />
        <ModelMetric
          label="Output Velocity"
          value={outputVelocity !== null ? `${formatTokens(outputVelocity)} tok/s` : "—"}
          detail="tok/s output"
          tone="text-cyan-600 dark:text-cyan-400"
        />
        <ModelMetric
          label="Reasoning Share"
          value={model.usage.reasoningOutputTokens > 0 && model.usage.outputTokens > 0 ? formatPercent((model.usage.reasoningOutputTokens / model.usage.outputTokens) * 100) : "—"}
          detail="of output"
          tone="text-rose-600 dark:text-rose-400"
        />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className={`${SUBPANEL_CLASS} p-4`}>
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Status Counts</div>
          <div className="mt-2 text-sm font-black text-slate-900 dark:text-white">{statusSummary}</div>
        </div>
        <div className={`${SUBPANEL_CLASS} p-4`}>
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Latency Span</div>
          <div className="mt-2 text-sm font-black text-slate-900 dark:text-white">
            {model.duration.sampleCount > 0 ? `${formatStatsDuration(model.duration.p50Ms)} median` : "No samples"}
          </div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            {model.duration.sampleCount > 0 ? `p95 ${formatStatsDuration(model.duration.p95Ms)}` : "duration unavailable"}
          </div>
        </div>
      </div>

      <div className="mt-5">
        <TokenFlowBar
          input={model.usage.inputTokens}
          cached={model.usage.cachedInputTokens}
          output={model.usage.outputTokens}
          reasoning={model.usage.reasoningOutputTokens}
          total={model.usage.totalTokens}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-status-green ${CHIP_CLASS}`}>
            {model.statusCounts.completed} completed
          </span>
          {model.statusCounts.failed > 0 ? (
            <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-rose-700 dark:text-rose-300 ${CHIP_CLASS}`}>
              {model.statusCounts.failed} failed
            </span>
          ) : null}
          {model.statusCounts.running > 0 ? (
            <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-700 dark:text-signal-300 ${CHIP_CLASS}`}>
              {model.statusCounts.running} running
            </span>
          ) : null}
          {model.statusCounts.cancelled > 0 ? (
            <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 ${CHIP_CLASS}`}>
              {model.statusCounts.cancelled} cancelled
            </span>
          ) : null}
        </div>
        <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
          Last active {formatDateTime(model.lastActivityAt)}
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
  const totalInvocations = models.reduce((sum, model) => sum + model.usage.invocationCount, 0);
  const durationSamples = models.reduce((sum, model) => sum + model.duration.sampleCount, 0);
  const weightedLatencyMs = durationSamples > 0
    ? models.reduce((sum, model) => sum + model.duration.p50Ms * model.duration.sampleCount, 0) / durationSamples
    : null;
  const completed = models.reduce((sum, model) => sum + model.statusCounts.completed, 0);
  const failed = models.reduce((sum, model) => sum + model.statusCounts.failed, 0);
  const cancelled = models.reduce((sum, model) => sum + model.statusCounts.cancelled, 0);
  const finished = completed + failed + cancelled;
  const aggregateSuccess = finished > 0 ? completed / finished : null;
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
        <div className="rounded-2xl border border-dashed border-black/[0.08] px-4 py-12 text-center text-sm text-slate-400 dark:border-white/[0.08]">
          No model telemetry landed in this window yet.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <ModelMetric label="Model Count" value={models.length.toLocaleString()} detail={`${totalInvocations.toLocaleString()} invocations`} tone="text-signal-600 dark:text-signal-400" />
            <ModelMetric label="Window Success" value={formatSuccessRate(aggregateSuccess)} detail={finished > 0 ? `${failed.toLocaleString()} failed of ${finished.toLocaleString()}` : "nothing finished"} tone={aggregateSuccess !== null ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500 dark:text-slate-400"} />
            <ModelMetric label="Median Latency" value={weightedLatencyMs !== null ? formatStatsDuration(weightedLatencyMs) : "—"} detail={durationSamples > 0 ? `${durationSamples.toLocaleString()} duration samples` : "no duration samples"} tone="text-cyan-600 dark:text-cyan-400" />
            <ModelMetric label="Token Volume" value={formatTokens(totalTokens)} detail="across ranked models" tone="text-amber-600 dark:text-amber-400" />
          </div>

          <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1.05fr_0.95fr]">
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
                <Gauge className="h-4 w-4 text-signal-500" strokeWidth={2} />
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Efficiency Highlights</div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <HighlightTile
                  icon={TrendingUp}
                  label="Busiest"
                  highlight={highlights.busiest}
                  tone="text-signal-600 dark:text-signal-400"
                />
                <HighlightTile
                  icon={Clock3}
                  label="Fastest"
                  highlight={highlights.fastest}
                  tone="text-cyan-600 dark:text-cyan-400"
                />
                <HighlightTile
                  icon={ShieldCheck}
                  label="Most Reliable"
                  highlight={highlights.mostReliable}
                  tone="text-emerald-600 dark:text-emerald-400"
                />
                <HighlightTile
                  icon={Database}
                  label="Best Cache Efficiency"
                  highlight={highlights.bestCache}
                  tone="text-amber-600 dark:text-amber-400"
                />
                <HighlightTile
                  icon={Zap}
                  label="Highest Velocity"
                  highlight={highlights.highestVelocity}
                  tone="text-cyan-600 dark:text-cyan-400"
                />
                <HighlightTile
                  icon={Brain}
                  label="Highest Reasoning"
                  highlight={highlights.strongestReasoning}
                  tone="text-rose-600 dark:text-rose-400"
                />
              </div>
              <div className={`${SUBPANEL_CLASS} mt-4 p-4`}>
                <div className="flex items-center justify-between gap-4">
                  <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                    <Activity className="h-3.5 w-3.5" strokeWidth={2.2} />
                    Window Volume
                  </div>
                  <div className="text-lg font-black text-slate-900 dark:text-white">{formatTokens(totalTokens)} tokens</div>
                </div>
                <div className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  Highlights prefer models with at least 3 invocations so a single lucky call can't win a category.
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Model Leaderboard</div>
              <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                Every model ranked by token volume, with reliability, latency percentiles, and efficiency anatomy per model.
              </div>
            </div>
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
