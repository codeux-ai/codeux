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
import { useStatsI18n } from "../stats-i18n.js";
import type { DashboardLocale } from "../../../i18n/index.js";

const LOW_SAMPLE_THRESHOLD = 3;

export const SUCCESS_TONE_CLASS: Record<ReturnType<typeof getSuccessTone>, string> = {
  strong: STATUS_TONE_CLASS.positive,
  warn: STATUS_TONE_CLASS.warning,
  critical: STATUS_TONE_CLASS.negative,
  neutral: STATUS_TONE_CLASS.neutral,
};

const formatEfficiencyPercent = (value: number | null, locale: DashboardLocale): string => (
  value === null ? "—" : formatPercent(value * 100, locale)
);

const formatMetricTokens = (value: number | null, locale: DashboardLocale): string => (
  value === null ? "—" : formatTokens(Math.round(value), locale)
);

const formatVelocity = (value: number | null, locale: DashboardLocale): string => (
  value === null || value <= 0 ? "—" : `${formatTokens(Math.round(value), locale)} Tok./s`
);

const formatPricingValue = (value: number | null, locale: DashboardLocale): string => (
  value === null || value <= 0 ? "—" : formatCost(value, locale)
);

const formatShare = (value: number, locale: DashboardLocale): string => (
  value > 0 ? `${formatPercent(value, locale, 1)} ${locale === "de" ? "Anteil" : "share"}` : locale === "de" ? "kein Token-Anteil" : "no token share"
);

const getInvocationSignal = (count: number, locale: DashboardLocale): string => {
  if (count === 0) {
    return locale === "de" ? "Noch keine Aufrufe" : "No calls yet";
  }
  if (count < LOW_SAMPLE_THRESHOLD) {
    return locale === "de" ? "Kleine Stichprobe" : "Low sample";
  }
  return `${new Intl.NumberFormat(locale).format(count)} ${locale === "de" ? "Aufrufe" : "calls"}`;
};

export const HighlightTile: FunctionComponent<{
  icon: LucideIcon;
  label: string;
  highlight: ModelHighlight | null;
  tone: string;
}> = ({ icon: Icon, label, highlight, tone }) => {
  const { locale } = useStatsI18n();
  return (
  <div className={`${SUBPANEL_CLASS} min-w-0 p-3`}>
    <div className="flex min-w-0 items-center justify-between gap-3">
      <div className={`min-w-0 break-words text-[10px] font-bold uppercase tracking-[0.16em] ${TEXT_LABEL_CLASS}`}>
        {label}
      </div>
      <Icon className={`h-3.5 w-3.5 shrink-0 ${tone}`} strokeWidth={2.2} aria-hidden="true" />
    </div>
    <div className={`mt-3 break-words text-sm font-semibold ${TEXT_VALUE_CLASS}`} title={highlight?.model.label}>
      {highlight ? highlight.model.label : "—"}
    </div>
    <div className={`mt-1 text-xs font-medium ${TEXT_DETAIL_CLASS}`}>
      {highlight ? highlight.value : locale === "de" ? "Noch nicht genügend Telemetrie" : "Not enough telemetry yet"}
    </div>
    {highlight?.detail ? <div className={`mt-1 text-[10px] font-bold uppercase tracking-[0.14em] ${TEXT_LABEL_CLASS}`}>{highlight.detail}</div> : null}
  </div>
  );
};

export const ModelMetric: FunctionComponent<{
  label: string;
  value: string;
  detail?: string;
}> = ({ label, value, detail }) => (
  <div className={`${SUBPANEL_CLASS} min-w-0 p-3`}>
    <div className={`break-words text-[10px] font-bold uppercase tracking-[0.14em] ${TEXT_LABEL_CLASS}`}>{label}</div>
    <div className={`mt-2 break-words text-sm font-semibold ${value === "—" ? TEXT_DETAIL_CLASS : TEXT_VALUE_CLASS}`}>{value}</div>
    {detail ? <div className={`mt-1 text-[10px] font-bold uppercase tracking-[0.14em] ${TEXT_LABEL_CLASS}`}>{detail}</div> : null}
  </div>
);

export const ModelCard: FunctionComponent<{
  model: ExecutionModelStatsSummary;
  rank: number;
  shareOfTotal: number;
}> = ({ model, rank, shareOfTotal }) => {
  const { locale, formatNumber, text: translate } = useStatsI18n();
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
  const statusSummary = locale === "de"
    ? `${formatNumber(model.statusCounts.completed)} abgeschlossen · ${formatNumber(model.statusCounts.failed)} fehlgeschlagen · ${formatNumber(model.statusCounts.running)} aktiv · ${formatNumber(model.statusCounts.cancelled)} abgebrochen`
    : `${formatNumber(model.statusCounts.completed)} completed · ${formatNumber(model.statusCounts.failed)} failed · ${formatNumber(model.statusCounts.running)} running · ${formatNumber(model.statusCounts.cancelled)} cancelled`;

  return (
    <article className={`${PANEL_CLASS} p-4`} aria-label={locale === "de" ? `${model.label}, Rang ${formatNumber(rank)} der Modellrangliste` : `${model.label} model leaderboard rank ${formatNumber(rank)}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className={`shrink-0 rounded-[var(--stats-chip-radius)] p-2 ${bg} ${text}`}>
            <Icon className="h-4 w-4" strokeWidth={2.1} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex shrink-0 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${CHIP_CLASS}`}>
                #{rank}
              </span>
              <h3 className="min-w-0 max-w-full break-words text-base font-semibold leading-tight text-[color:var(--stats-value-color)]" title={model.label}>
                {model.label}
              </h3>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-[color:var(--stats-detail-color)]">
              <span className="capitalize">{model.provider}</span>
              <span aria-hidden="true">·</span>
              <span>{formatShare(shareOfTotal, locale)}</span>
              <span aria-hidden="true">·</span>
              <span>{getInvocationSignal(model.usage.invocationCount, locale)}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start">
          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${CHIP_CLASS}`}>
            {locale === "de" ? "Volumenrang" : "Volume rank"}
          </div>
          <div className={`inline-flex items-center gap-2 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${CHIP_CLASS}`}>
            <BarChart3 className="h-3.5 w-3.5 text-[color:var(--stats-signal-text)]" strokeWidth={2.2} />
            <span className="text-sm font-semibold normal-case text-[color:var(--stats-value-color)]">
              {formatTokens(model.usage.totalTokens, locale)}
            </span>
            <span className="text-[color:var(--stats-label-color)]">{locale === "de" ? "Token" : "tokens"}</span>
          </div>
          <div className={`inline-flex items-center gap-2 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${CHIP_CLASS}`}>
            <DollarSign className="h-3.5 w-3.5 text-[color:var(--stats-positive-text)]" strokeWidth={2.2} />
            <span className="text-sm font-semibold normal-case text-[color:var(--stats-value-color)]">
              {formatPricingValue(hasCost ? model.usage.totalCostUsd : null, locale)}
            </span>
            <span className="text-[color:var(--stats-label-color)]">{locale === "de" ? "Kosten" : "cost"}</span>
          </div>
          <div className={`inline-flex items-center gap-1.5 rounded-[var(--stats-chip-radius)] border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${SUCCESS_TONE_CLASS[successTone]}`}>
            <ShieldCheck className="h-3 w-3" strokeWidth={2.4} />
            {formatSuccessRate(model.successRate, locale)}
          </div>
        </div>
      </div>

      {hasLowTelemetry || !hasDuration ? (
        <div className={`${DASHED_EMPTY_CLASS} mt-4 py-3 text-left text-xs font-medium ${TEXT_DETAIL_CLASS}`}>
          {hasLowTelemetry ? (locale === "de" ? "Die Ranglistenplatzierung basiert auf begrenzter Aufruftelemetrie." : "Leaderboard placement is based on limited invocation telemetry.") : (locale === "de" ? "Latenzperzentile erscheinen, sobald dieses Modell Laufzeitstichproben erfasst." : "Latency percentiles will appear after this model records duration samples.")}
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-5">
        <ModelMetric
          label={locale === "de" ? "Aufrufe" : "Invocations"}
          value={formatNumber(model.usage.invocationCount)}
          detail={model.statusCounts.failed > 0 ? `${formatNumber(model.statusCounts.failed)} ${locale === "de" ? "fehlgeschlagen" : "failed"}` : locale === "de" ? "keine Fehler" : "no failures"}
        />
        <ModelMetric
          label={locale === "de" ? "Latenz" : "Latency"}
          value={hasDuration ? formatStatsDuration(model.duration.p50Ms, locale) : "—"}
          detail={hasDuration ? `p50 · p95 ${formatStatsDuration(model.duration.p95Ms, locale)}` : locale === "de" ? "keine Laufzeitstichproben" : "no duration samples"}
        />
        <ModelMetric
          label={locale === "de" ? "Tokens/Aufruf" : "Tokens / Call"}
          value={formatMetricTokens(efficiency.tokensPerCall, locale)}
          detail={model.usage.invocationCount > 0 ? (locale === "de" ? "Durchschnittsvolumen" : "avg volume") : locale === "de" ? "keine Aufrufe" : "no calls"}
        />
        <ModelMetric
          label={locale === "de" ? "Erfolg" : "Success"}
          value={formatSuccessRate(model.successRate, locale)}
          detail={model.successRate === null ? (locale === "de" ? "ausstehende Ergebnisse" : "pending outcomes") : statusSummary}
        />
        <ModelMetric
          label={locale === "de" ? "Kosten" : "Cost"}
          value={formatPricingValue(hasCost ? model.usage.totalCostUsd : null, locale)}
          detail={costPerCall !== null ? `${formatCost(costPerCall, locale)}/${locale === "de" ? "Aufruf" : "call"}` : locale === "de" ? "kein Preissignal" : "no pricing signal"}
        />
        <ModelMetric
          label={translate("costPerMillionTokens")}
          value={formatPricingValue(costPerMillionTokens, locale)}
          detail={costPerMillionTokens !== null ? (locale === "de" ? "gemischter Token-Satz" : "blended token rate") : locale === "de" ? "Preis nicht verfügbar" : "pricing unavailable"}
        />
        <ModelMetric
          label={locale === "de" ? "Ausgabegeschwindigkeit" : "Output Velocity"}
          value={formatVelocity(efficiency.outputTokensPerSecond, locale)}
          detail={efficiency.outputTokensPerSecond === null ? (locale === "de" ? "keine aktive Ausgabe" : "no active output") : locale === "de" ? "generierte Ausgabe" : "generated output"}
        />
        <ModelMetric
          label={locale === "de" ? "Cache-Rate" : "Cache Rate"}
          value={formatEfficiencyPercent(efficiency.cacheHitRate, locale)}
          detail={`${formatTokens(model.usage.cachedInputTokens, locale)} ${locale === "de" ? "im Cache" : "cached"}`}
        />
        <ModelMetric
          label={translate("reasoning")}
          value={formatEfficiencyPercent(efficiency.reasoningShare, locale)}
          detail={`${formatTokens(model.usage.reasoningOutputTokens, locale)} ${locale === "de" ? "Schlussfolgerung" : "reasoning"}`}
        />
        <ModelMetric
          label={translate("outputInputRatio")}
          value={efficiency.outputInputRatio !== null ? formatNumber(efficiency.outputInputRatio, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
          detail={locale === "de" ? "Generierungsverhältnis" : "generation ratio"}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[0.85fr_1.15fr]">
        <div className={`${SUBPANEL_CLASS} p-3`}>
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Ergebnismix" : "Outcome Mix"}</div>
          <div className="mt-2 text-sm font-semibold text-[color:var(--stats-value-color)]">{statusSummary}</div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)]">
            {locale === "de" ? "Zuletzt aktiv" : "Last active"} {formatDateTime(model.lastActivityAt, locale)}
          </div>
        </div>
        <div className={`${SUBPANEL_CLASS} p-3`}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Token-Fluss-Struktur" : "Token-Flow Anatomy"}</div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)]">{formatTokens(model.usage.totalTokens, locale)} {locale === "de" ? "gesamt" : "total"}</div>
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
            <span>{locale === "de" ? "Eingabe" : "In"} {formatTokens(model.usage.inputTokens, locale)}</span>
            <span>Cache {formatTokens(model.usage.cachedInputTokens, locale)}</span>
            <span>{locale === "de" ? "Ausgabe" : "Out"} {formatTokens(model.usage.outputTokens, locale)}</span>
            <span>{locale === "de" ? "Denken" : "Think"} {formatTokens(model.usage.reasoningOutputTokens, locale)}</span>
          </div>
        </div>
      </div>
    </article>
  );
};

export const ModelsStudio: FunctionComponent<{
  stats: ProjectExecutionStatsSnapshot;
}> = ({ stats }) => {
  const { locale, formatNumber } = useStatsI18n();
  const models = stats.models || [];
  const segments = buildModelSegments(models, 5, locale);
  const highlights = buildModelHighlights(models, locale);
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
      <div className={`${PANEL_CLASS} p-5 md:p-6`}>
        <div className="flex max-w-4xl items-start gap-4">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center border px-2 ${CHIP_CLASS} text-[color:var(--stats-signal-text)]`}>
            <Cpu className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className={`text-[10px] font-bold uppercase tracking-[0.18em] ${TEXT_LABEL_CLASS}`}>{locale === "de" ? "Modellintelligenz" : "Model Intelligence"}</div>
            <div className={`mt-1 break-words text-xl font-semibold ${TEXT_VALUE_CLASS}`}>{locale === "de" ? "Modellleistung und Effizienz" : "Model performance & efficiency"}</div>
            <div className={`mt-2 max-w-3xl text-sm leading-relaxed ${TEXT_DETAIL_CLASS}`}>
              {locale === "de" ? "Modellbezogene Telemetrie im ausgewählten Zeitraum – Token-Volumen, Zuverlässigkeit, Latenzverteilung, Cache-Effizienz und Ausgabegeschwindigkeit für jedes beteiligte Modell." : "Per-model telemetry across the selected window — token volume, reliability, latency distribution, cache efficiency, and output velocity for every model that participated."}
            </div>
          </div>
        </div>
      </div>

      {models.length === 0 ? (
        <div className={`${PANEL_CLASS} border-dashed p-10 text-center`}>
          <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-[var(--stats-control-radius)] border border-[color:var(--stats-card-border)] bg-[color:var(--stats-surface-chip)] ${TEXT_LABEL_CLASS}`}>
            <Cpu className="h-5 w-5" strokeWidth={2.2} />
          </div>
          <div className="mt-4 text-base font-semibold text-[color:var(--stats-value-color)]">{locale === "de" ? "Noch keine Modelltelemetrie" : "No model telemetry yet"}</div>
          <div className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-[color:var(--stats-detail-color)]">
            {locale === "de" ? "Dieser Zeitraum enthält keine Modelleinträge. Vergleiche zu Volumen, Latenz, Cache und Schlussfolgerung erscheinen, sobald Anbieteraufrufe erfasst wurden." : "This window has no model entries, so volume, latency, cache, and reasoning comparisons will appear after provider invocations are recorded."}
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[0.95fr_1.05fr_0.8fr]">
            <DonutCard
              title={locale === "de" ? "Modellanteil" : "Model Share"}
              eyebrow={locale === "de" ? "Verteilung" : "Distribution"}
              description={locale === "de" ? "Token-Volumen auf die in diesem Zeitraum aktiven Modelle verteilt und in sichtbaren Bereichen gruppiert." : "Token volume split across the models active in this window, grouped into visible lanes."}
              centerValue={formatNumber(models.length)}
              centerLabel={locale === "de" ? (models.length === 1 ? "Modell" : "Modelle") : (models.length === 1 ? "model" : "models")}
              segments={segments}
            />
            <div className={`${PANEL_CLASS} p-6`}>
              <div className="flex items-center gap-3">
                <Gauge className="h-4 w-4 text-[color:var(--stats-signal-text)]" strokeWidth={2} />
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Effizienz-Highlights" : "Efficiency Highlights"}</div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <HighlightTile
                  icon={TrendingUp}
                  label={locale === "de" ? "Volumenführer" : "Volume Leader"}
                  highlight={highlights.busiest}
                  tone="text-[color:var(--stats-signal-text)]"
                />
                <HighlightTile
                  icon={Clock3}
                  label={locale === "de" ? "Schnellstes" : "Fastest"}
                  highlight={highlights.fastest}
                  tone="text-[color:var(--stats-accent-cyan)]"
                />
                <HighlightTile
                  icon={ShieldCheck}
                  label={locale === "de" ? "Zuverlässigstes" : "Most Reliable"}
                  highlight={highlights.mostReliable}
                  tone="text-[color:var(--stats-positive-text)]"
                />
                <HighlightTile
                  icon={Database}
                  label={locale === "de" ? "Beste Cache-Effizienz" : "Best Cache Efficiency"}
                  highlight={highlights.bestCache}
                  tone="text-[color:var(--stats-warning-text)]"
                />
                <HighlightTile
                  icon={Zap}
                  label={locale === "de" ? "Höchste Geschwindigkeit" : "Highest Velocity"}
                  highlight={highlights.highestVelocity}
                  tone="text-[color:var(--stats-accent-cyan)]"
                />
                <HighlightTile
                  icon={Brain}
                  label={locale === "de" ? "Höchster Schlussfolgerungsanteil" : "Highest Reasoning"}
                  highlight={highlights.strongestReasoning}
                  tone="text-[color:var(--stats-negative-text)]"
                />
              </div>
            </div>
            <div className={`${PANEL_CLASS} p-6`}>
              <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--stats-label-color)]">
                <Activity className="h-3.5 w-3.5 text-[color:var(--stats-signal-text)]" strokeWidth={2.2} />
                {locale === "de" ? "Zeitraumvolumen" : "Window Volume"}
              </div>
              <div className="mt-4 break-words text-xl font-semibold text-[color:var(--stats-value-color)]">{formatTokens(totalTokens, locale)}</div>
              <div className="mt-1 text-xs font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Tokens nach Modellvolumen sortiert" : "tokens ranked by model volume"}</div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <ModelMetric label={locale === "de" ? "Aufrufe" : "Calls"} value={formatNumber(totalCalls)} detail={totalCalls < LOW_SAMPLE_THRESHOLD ? (locale === "de" ? "kleine Stichprobe" : "sparse sample") : locale === "de" ? "Aufrufe" : "invocations"} />
                <ModelMetric label={locale === "de" ? "Ausgabe" : "Output"} value={formatTokens(totalOutput, locale)} detail={locale === "de" ? "generiert" : "generated"} />
                <ModelMetric label={locale === "de" ? "Im Cache" : "Cached"} value={formatTokens(totalCached, locale)} detail={locale === "de" ? "Eingabewiederverwendung" : "input reuse"} />
                <ModelMetric label={locale === "de" ? "Schlussfolgerung" : "Reasoning"} value={formatTokens(totalReasoning, locale)} detail={locale === "de" ? "Denk-Tokens" : "thinking tokens"} />
                <ModelMetric label={locale === "de" ? "Kosten" : "Cost"} value={formatPricingValue(totalCost, locale)} detail={totalCost > 0 ? (locale === "de" ? "bepreiste Nutzung" : "priced usage") : locale === "de" ? "kein Preissignal" : "no pricing signal"} />
              </div>
              <div className={`${DASHED_EMPTY_CLASS} mt-4 py-3 text-left text-xs leading-relaxed ${TEXT_DETAIL_CLASS}`}>
                {sampledModels === 0
                  ? (locale === "de" ? "Noch kein Modell hat Laufzeitstichproben; Latenz-Highlights und p50/p95-Felder bleiben absichtlich leer." : "No model has duration samples yet; latency highlights and p50/p95 cells stay intentionally empty.")
                  : (locale === "de" ? `${formatNumber(sampledModels)} von ${formatNumber(models.length)} Modellen haben Laufzeitstichproben. Highlights bevorzugen Modelle mit mindestens ${formatNumber(LOW_SAMPLE_THRESHOLD)} Aufrufen.` : `${formatNumber(sampledModels)} of ${formatNumber(models.length)} models have duration samples. Highlights prefer models with at least ${formatNumber(LOW_SAMPLE_THRESHOLD)} calls.`)}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Modellrangliste" : "Model Leaderboard"}</div>
                <div className="mt-2 text-sm leading-relaxed text-[color:var(--stats-detail-color)]">
                  {locale === "de" ? "Nach Token-Volumen und anschließend Modellbezeichnung sortiert. Jeder Eintrag zeigt Zuverlässigkeit, p50/p95-Latenz, Geschwindigkeit, Cache, Schlussfolgerung und Token-Struktur für den Vergleich." : "Ranked by token volume, then model label. Each entry keeps reliability, p50/p95 latency, speed, cache, reasoning, and token anatomy visible for comparison."}
                </div>
              </div>
              <div className={`self-start px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)] ${CHIP_CLASS}`}>
                {locale === "de" ? "Sortierung: Tokens absteigend" : "Sort: tokens desc"}
              </div>
            </div>
            {totalTokens === 0 ? (
              <div className={`${DASHED_EMPTY_CLASS} py-5 text-left text-sm ${TEXT_DETAIL_CLASS}`}>
                {locale === "de" ? "Modelle sind vorhanden, aber keines hat in diesem Zeitraum Token-Volumen gemeldet. Bis Nutzungssummen eintreffen, erfolgt die Sortierung nach Bezeichnungen." : "Models are present, but none reported token volume in this window. Ranking falls back to labels until usage totals arrive."}
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
