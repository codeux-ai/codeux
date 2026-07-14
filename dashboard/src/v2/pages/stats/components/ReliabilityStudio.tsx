import type { ComponentType, FunctionComponent } from "preact";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  DollarSign,
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
  formatCost,
  formatPercent,
  formatStatsDuration,
  formatTokens,
} from "../stats-utils.js";
import {
  CHIP_CLASS,
  DonutCard,
  PANEL_CLASS,
  STATUS_TONE_CLASS,
  SUBPANEL_CLASS,
  TRACK_CLASS,
  TokenFlowBar,
  getProviderIcon,
} from "./stats-ui-primitives.js";
import {
  buildTelemetrySourceSummary,
  formatSuccessRate,
  getSuccessTone,
} from "../model-insights.js";
import { useStatsI18n } from "../stats-i18n.js";
import type { DashboardLocale } from "../../../i18n/locales.js";

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

const SOURCE_TEXT_CLASS: Record<SourceTone, string> = {
  strong: "text-[color:var(--stats-positive-text)]",
  fallback: "text-[color:var(--stats-warning-text)]",
  critical: "text-[color:var(--stats-negative-text)]",
  neutral: "text-[color:var(--stats-detail-color)]",
};

const SUCCESS_TONE_CLASS: Record<ReturnType<typeof getSuccessTone>, string> = {
  strong: STATUS_TONE_CLASS.positive,
  warn: STATUS_TONE_CLASS.warning,
  critical: STATUS_TONE_CLASS.negative,
  neutral: STATUS_TONE_CLASS.neutral,
};

const FLAT_BADGE_CLASS = `inline-flex items-center gap-2 rounded-[var(--stats-chip-radius)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-detail-color)] ${CHIP_CLASS}`;
const SECTION_TITLE_CLASS = "text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--stats-label-color)]";
const SECTION_COPY_CLASS = "mt-2 text-sm leading-relaxed text-[color:var(--stats-detail-color)]";

const formatPricingValue = (value: number | null, locale: DashboardLocale = "en"): string => (
  value === null || value <= 0 ? "—" : formatCost(value, locale)
);

function getUsageSourceCount(usage: ExecutionUsageTotals, source: TokenUsageSource): number {
  if (source === "reported") return usage.reportedInvocationCount || 0;
  if (source === "estimated") return usage.estimatedInvocationCount || 0;
  if (source === "unavailable") return usage.unavailableInvocationCount || 0;
  return usage.unsupportedInvocationCount || 0;
}

function buildSourceRows(usage: ExecutionUsageTotals, locale: DashboardLocale = "en"): SourceRow[] {
  const knownCount = getUsageSourceCount(usage, "reported")
    + getUsageSourceCount(usage, "estimated")
    + getUsageSourceCount(usage, "unavailable")
    + getUsageSourceCount(usage, "unsupported");
  const unknownCount = Math.max(0, (usage.invocationCount || 0) - knownCount);
  const total = knownCount + unknownCount;

  return (["reported", "estimated", "unavailable", "unsupported", "unknown"] as const).map((source) => {
    const meta = SOURCE_META[source];
    const german = {
      reported: ["Gemeldet", "Provider-native Zählwerte"],
      estimated: ["Geschätzt", "Berechneter Ersatzwert"],
      unavailable: ["Nicht verfügbar", "Provider lief ohne nutzbare Zählwerte"],
      unsupported: ["Nicht unterstützt", "Telemetrie wird nicht unterstützt"],
      unknown: ["Unbekannt", "Kein Quellenzähler wurde erfasst"],
    }[source];
    const count = source === "unknown" ? unknownCount : getUsageSourceCount(usage, source);
    return {
      source,
      label: locale === "de" ? german[0] : meta.label,
      count,
      share: total > 0 ? count / total : null,
      tone: meta.tone,
      detail: locale === "de" ? german[1] : meta.detail,
      icon: meta.icon,
    };
  });
}

function summarizeSourceRows(rows: SourceRow[], locale: DashboardLocale = "en"): {
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
      label: locale === "de" ? "Kein Quellensignal" : "No source signal",
      detail: locale === "de" ? "Keine Aufrufquellenzähler" : "No invocation source counters",
      tone: "neutral",
      total,
      fallbackCount,
      failureRiskCount,
    };
  }

  if (reported === total) {
    return {
      label: locale === "de" ? "Gemeldet" : "Reported",
      detail: `${new Intl.NumberFormat(locale).format(reported)} ${locale === "de" ? "gemeldete Aufrufe" : "reported calls"}`,
      tone: "strong",
      total,
      fallbackCount,
      failureRiskCount,
    };
  }

  if (failureRiskCount > 0 && reported === 0 && estimated === 0) {
    return {
      label: locale === "de" ? "Nicht verfügbar" : "Unavailable",
      detail: `${new Intl.NumberFormat(locale).format(failureRiskCount)} ${locale === "de" ? "nicht verfügbar oder nicht unterstützt" : "unavailable or unsupported"}`,
      tone: "critical",
      total,
      fallbackCount,
      failureRiskCount,
    };
  }

  if (failureRiskCount > 0) {
    return {
      label: locale === "de" ? "Gemischte Quellen" : "Mixed sources",
      detail: `${new Intl.NumberFormat(locale).format(reported)} ${locale === "de" ? "gemeldet" : "reported"} · ${new Intl.NumberFormat(locale).format(fallbackCount)} ${locale === "de" ? "Ersatzwerte" : "fallback"} · ${new Intl.NumberFormat(locale).format(failureRiskCount)} ${locale === "de" ? "nicht verfügbar" : "unavailable"}`,
      tone: "critical",
      total,
      fallbackCount,
      failureRiskCount,
    };
  }

  if (fallbackCount > 0) {
    return {
      label: reported > 0 ? (locale === "de" ? "Gemeldet + Ersatzwerte" : "Reported + fallback") : (locale === "de" ? "Geschätzt" : "Estimated"),
      detail: `${new Intl.NumberFormat(locale).format(reported)} ${locale === "de" ? "gemeldet" : "reported"} · ${new Intl.NumberFormat(locale).format(fallbackCount)} ${locale === "de" ? "Ersatzwerte" : "fallback"}`,
      tone: "fallback",
      total,
      fallbackCount,
      failureRiskCount,
    };
  }

  return {
    label: locale === "de" ? "Unbekannt" : "Unknown",
    detail: `${new Intl.NumberFormat(locale).format(unknown)} ${locale === "de" ? "unbekannte Aufrufe" : "unknown calls"}`,
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

function buildProviderRows(stats: ProjectExecutionStatsSnapshot, locale: DashboardLocale = "en"): ProviderReliabilityRow[] {
  return [...(stats.providers || [])].map((provider) => {
    const providerModels = (stats.models || []).filter((model) => model.provider === provider.id);
    const completedCount = providerModels.reduce((sum, model) => sum + model.statusCounts.completed, 0);
    const failedCount = providerModels.reduce((sum, model) => sum + model.statusCounts.failed, 0);
    const cancelledCount = providerModels.reduce((sum, model) => sum + model.statusCounts.cancelled, 0);
    const runningCount = providerModels.reduce((sum, model) => sum + model.statusCounts.running, 0);
    const finishedCount = completedCount + failedCount + cancelledCount;
    const successRate = finishedCount > 0 ? completedCount / finishedCount : null;
    const sourceRows = buildSourceRows(provider.usage, locale);
    const sourceSummary = summarizeSourceRows(sourceRows, locale);
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
}> = ({ label, value, detail, toneClass = "text-[color:var(--stats-detail-color)]", icon: Icon }) => (
  <div className={`${SUBPANEL_CLASS} p-4`}>
    <div className="flex items-center justify-between gap-3">
      <div className={`text-[10px] font-bold uppercase tracking-[0.18em] ${toneClass}`}>{label}</div>
      {Icon ? <Icon className={`h-3.5 w-3.5 ${toneClass}`} strokeWidth={2.2} aria-hidden="true" /> : null}
    </div>
    <div className="mt-2 break-words text-lg font-semibold text-[color:var(--stats-value-color)]">{value}</div>
    <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)]">{detail}</div>
  </div>
);

const EmptyTelemetryPanel: FunctionComponent<{
  title: string;
  detail: string;
}> = ({ title, detail }) => (
  <div className={`${SUBPANEL_CLASS} border-dashed px-4 py-10 text-center`}>
    <div className="text-sm font-semibold text-[color:var(--stats-value-color)]">{title}</div>
    <div className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-[color:var(--stats-detail-color)]">{detail}</div>
  </div>
);

const SourceCountCard: FunctionComponent<{
  row: SourceRow;
}> = ({ row }) => {
  const { locale, formatNumber } = useStatsI18n();
  const Icon = row.icon;
  return (
    <div className={`${SUBPANEL_CLASS} p-4`}>
      <div className="flex items-center justify-between gap-3">
        <div className={`inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] ${SOURCE_TEXT_CLASS[row.tone]}`}>
          <Icon className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
          {row.label}
        </div>
        <div className="text-[11px] font-mono text-[color:var(--stats-label-color)]">
          {row.share !== null ? formatPercent(row.share * 100, locale) : "—"}
        </div>
      </div>
      <div className="mt-3 text-xl font-semibold text-[color:var(--stats-value-color)]">{formatNumber(row.count)}</div>
      <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)]">{row.detail}</div>
      <div className={`mt-3 h-1.5 overflow-hidden rounded-full ${TRACK_CLASS}`}>
        <div
          className={`h-full rounded-full ${row.tone === "strong"
            ? "bg-[color:var(--stats-positive-text)]"
            : row.tone === "fallback"
              ? "bg-[color:var(--stats-warning-text)]"
              : row.tone === "critical"
                ? "bg-[color:var(--stats-negative-text)]"
                : "bg-[color:var(--stats-detail-color)]"}`}
          style={{ width: `${row.share !== null ? Math.max(4, row.share * 100) : 0}%` }}
        />
      </div>
    </div>
  );
};

const ProviderReliabilityCard: FunctionComponent<{
  row: ProviderReliabilityRow;
}> = ({ row }) => {
  const { locale, formatNumber } = useStatsI18n();
  const { provider } = row;
  const { icon: Icon, bg, text } = getProviderIcon(provider.provider);
  const successTone = getSuccessTone(row.successRate);
  const riskLevel = row.riskScore >= 55 ? "high" : row.riskScore >= 25 ? "medium" : "low";
  const providerActiveVsWall = provider.usage.wallTimeMs > 0 ? provider.usage.activeTimeMs / provider.usage.wallTimeMs : null;
  const hasCost = Number.isFinite(provider.usage.totalCostUsd) && provider.usage.totalCostUsd > 0;
  const costPerCall = hasCost && provider.usage.invocationCount > 0
    ? provider.usage.totalCostUsd / provider.usage.invocationCount
    : null;
  const costPerMillionTokens = hasCost && provider.usage.totalTokens > 0
    ? provider.usage.totalCostUsd / (provider.usage.totalTokens / 1_000_000)
    : null;

  return (
    <div className={`${PANEL_CLASS} p-5`}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className={`rounded-xl p-2 ${bg} ${text}`}>
            <Icon className="h-4 w-4" strokeWidth={2.1} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="break-words text-base font-semibold text-[color:var(--stats-value-color)]" title={provider.label}>{provider.label}</div>
            <div className="mt-1 break-words text-sm text-[color:var(--stats-detail-color)]">{provider.secondaryLabel ?? (locale === "de" ? "Keine sekundäre Bezeichnung" : "No secondary label")}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <div className={FLAT_BADGE_CLASS}>
                {row.sourceSummaryLabel}
              </div>
              <div className={FLAT_BADGE_CLASS}>
                {locale === "de" ? ({ high: "Hohes Risiko", medium: "Mittleres Risiko", low: "Niedriges Risiko" } as const)[riskLevel] : `${riskLevel} risk`}
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className={FLAT_BADGE_CLASS}>
            <span className="text-base font-semibold normal-case tracking-tight text-[color:var(--stats-value-color)]">
              {provider.usage.totalTokens > 0 ? formatTokens(provider.usage.totalTokens, locale) : "—"}
            </span>
            <span className="text-[color:var(--stats-label-color)]">{locale === "de" ? "Token" : "tokens"}</span>
          </div>
          <div className={FLAT_BADGE_CLASS}>
            <span className="text-base font-semibold normal-case tracking-tight text-[color:var(--stats-value-color)]">
              {formatNumber(provider.usage.invocationCount)}
            </span>
            <span className="text-[color:var(--stats-label-color)]">{locale === "de" ? "Aufrufe" : "calls"}</span>
          </div>
          <div className={FLAT_BADGE_CLASS}>
            <DollarSign className="h-3.5 w-3.5 text-[color:var(--stats-positive-text)]" strokeWidth={2.2} aria-hidden="true" />
            <span className="text-base font-semibold normal-case tracking-tight text-[color:var(--stats-value-color)]">
              {formatPricingValue(hasCost ? provider.usage.totalCostUsd : null, locale)}
            </span>
            <span className="text-[color:var(--stats-label-color)]">{locale === "de" ? "Kosten" : "cost"}</span>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StudioMetricTile
          label={locale === "de" ? "Fehler" : "Failures"}
          value={formatNumber(row.failedCount)}
          detail={`${formatNumber(row.completedCount)} ${locale === "de" ? "abgeschlossen" : "completed"} · ${formatNumber(row.runningCount)} ${locale === "de" ? "laufend" : "running"} · ${formatNumber(row.cancelledCount)} ${locale === "de" ? "abgebrochen" : "cancelled"}`}
          toneClass={row.failedCount > 0 ? "text-[color:var(--stats-negative-text)]" : "text-[color:var(--stats-positive-text)]"}
          icon={row.failedCount > 0 ? AlertTriangle : CheckCircle2}
        />
        <div className={`${SUBPANEL_CLASS} p-4`}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Erfolgsrate" : "Success Rate"}</div>
            <ShieldCheck className="h-3.5 w-3.5 text-[color:var(--stats-label-color)]" strokeWidth={2.2} aria-hidden="true" />
          </div>
          <div className="mt-2">
            <span className={`inline-flex rounded-[var(--stats-chip-radius)] border px-3 py-1.5 text-base font-semibold ${SUCCESS_TONE_CLASS[successTone]}`}>
              {formatSuccessRate(row.successRate, locale)}
            </span>
          </div>
          <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)]">
            {row.finishedCount > 0 ? `${formatNumber(row.finishedCount)} ${locale === "de" ? "beendete Modellläufe" : "finished model runs"}` : locale === "de" ? "Keine beendeten Modellläufe" : "No finished model runs"}
          </div>
        </div>
        <StudioMetricTile
          label={locale === "de" ? "Token-Volumen" : "Token Volume"}
          value={formatTokens(provider.usage.totalTokens, locale)}
          detail={provider.usage.invocationCount > 0 ? `${formatTokens(Math.round(provider.usage.totalTokens / provider.usage.invocationCount), locale)}/${locale === "de" ? "Aufruf" : "call"}` : locale === "de" ? "Noch keine Aufrufe" : "No calls yet"}
          toneClass="text-[color:var(--stats-signal-text)]"
        />
        <StudioMetricTile
          label={locale === "de" ? "Kosten" : "Cost"}
          value={formatPricingValue(hasCost ? provider.usage.totalCostUsd : null, locale)}
          detail={costPerCall !== null ? `${formatCost(costPerCall, locale)}/${locale === "de" ? "Aufruf" : "call"}` : locale === "de" ? "Kein Preissignal" : "No pricing signal"}
          toneClass="text-[color:var(--stats-positive-text)]"
          icon={DollarSign}
        />
        <StudioMetricTile
          label="$ / 1M Tok"
          value={formatPricingValue(costPerMillionTokens, locale)}
          detail={costPerMillionTokens !== null ? (locale === "de" ? "Gemischter Token-Satz" : "Blended token rate") : (locale === "de" ? "Preise nicht verfügbar" : "Pricing unavailable")}
          toneClass="text-[color:var(--stats-positive-text)]"
        />
        <StudioMetricTile
          label={locale === "de" ? "Aktive Zeit" : "Active Time"}
          value={formatStatsDuration(provider.usage.activeTimeMs, locale)}
          detail={providerActiveVsWall !== null ? `${formatPercent(providerActiveVsWall * 100, locale)} ${locale === "de" ? "aktive Auslastung" : "active utilization"}` : locale === "de" ? "Gesamtzeit nicht erfasst" : "Wall time not tracked"}
          toneClass="text-[color:var(--stats-warning-text)]"
          icon={TimerReset}
        />
        <StudioMetricTile
          label={locale === "de" ? "Dauer" : "Duration"}
          value={row.duration.sampleCount > 0 ? formatStatsDuration(row.duration.p50Ms, locale) : "—"}
          detail={row.duration.sampleCount > 0 ? `${formatNumber(row.duration.sampleCount)} ${locale === "de" ? "Stichproben" : "samples"} · p95 ${formatStatsDuration(row.duration.p95Ms, locale)}` : locale === "de" ? "Keine Dauerstichproben" : "No duration samples"}
          toneClass="text-[color:var(--stats-accent-cyan)]"
          icon={Clock3}
        />
        <StudioMetricTile
          label={locale === "de" ? "Quellenvertrauen" : "Source Confidence"}
          value={row.sourceSummaryLabel}
          detail={row.sourceSummaryDetail}
          toneClass={SOURCE_TEXT_CLASS[row.sourceTone]}
        />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-5">
        {row.sourceRows.map((sourceRow) => (
          <div key={sourceRow.source} className={`${CHIP_CLASS} rounded-[var(--stats-chip-radius)] px-3 py-2 text-[color:var(--stats-detail-color)]`}>
            <div className="text-[9px] font-bold uppercase tracking-[0.14em]">{sourceRow.label}</div>
            <div className="mt-1 text-sm font-semibold text-[color:var(--stats-value-color)]">{formatNumber(sourceRow.count)}</div>
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
  const { locale, formatNumber } = useStatsI18n();
  const sourceSummary = buildTelemetrySourceSummary(stats.usage, locale);
  const sourceRows = buildSourceRows(stats.usage, locale);
  const sourceAudit = summarizeSourceRows(sourceRows, locale);
  const providerRows = buildProviderRows(stats, locale);
  const finishedCount = stats.statusCounts.completed + stats.statusCounts.failed + stats.statusCounts.cancelled;
  const successRate = finishedCount > 0 ? stats.statusCounts.completed / finishedCount : null;
  const successTone = getSuccessTone(successRate);
  const fallbackCount = sourceRows.find((row) => row.source === "estimated")!.count
    + sourceRows.find((row) => row.source === "unknown")!.count;
  const failureRiskCount = sourceRows.find((row) => row.source === "unavailable")!.count
    + sourceRows.find((row) => row.source === "unsupported")!.count;
  const highestRiskProvider = providerRows[0] || null;
  const providerCost = providerRows.reduce((sum, row) => sum + row.provider.usage.totalCostUsd, 0);
  const highestCostProvider = providerRows.reduce<ExecutionStatsEntitySummary | null>((highest, row) => {
    if (!highest || row.provider.usage.totalCostUsd > highest.usage.totalCostUsd) {
      return row.provider;
    }
    return highest;
  }, null);

  return (
    <section className="space-y-6">
      <div className={`${PANEL_CLASS} p-6`}>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <div className="flex max-w-4xl items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--stats-control-radius)] border border-[color:var(--stats-border-hairline)] bg-[color:var(--stats-surface-chip)] text-[color:var(--stats-detail-color)]">
              <ShieldCheck className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Zuverlässigkeitsmodus" : "Reliability Mode"}</div>
              <div className="mt-1 break-words text-xl font-semibold tracking-tight text-[color:var(--stats-value-color)]">{locale === "de" ? "Provider-Vertrauen und Fehlerrisiko" : "Provider confidence & failure risk"}</div>
              <div className="mt-2 text-sm leading-relaxed text-[color:var(--stats-detail-color)]">
                {locale === "de" ? "Telemetrievertrauen, Quellenmix, Provider-Zustand, Ersatzwertnutzung und Fehlerdruck für den ausgewählten Statistikzeitraum." : "Telemetry confidence, source mix, provider health, fallback usage, and failure pressure for the selected Stats window."}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className={FLAT_BADGE_CLASS}>
              {sourceSummary.label} {locale === "de" ? "Vertrauen" : "confidence"}
            </div>
            <div className={FLAT_BADGE_CLASS}>
              {formatSuccessRate(successRate, locale)} {locale === "de" ? "Erfolg" : "success"}
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StudioMetricTile
            label={locale === "de" ? "Telemetrievertrauen" : "Telemetry Confidence"}
            value={sourceSummary.label}
            detail={sourceSummary.detail}
            toneClass={SOURCE_TEXT_CLASS[sourceAudit.tone]}
            icon={ShieldCheck}
          />
          <StudioMetricTile
            label={locale === "de" ? "Ersatzwertnutzung" : "Fallback Usage"}
            value={formatNumber(fallbackCount)}
            detail={`${formatNumber(sourceRows.find((row) => row.source === "estimated")!.count)} ${locale === "de" ? "geschätzt" : "estimated"} · ${formatNumber(sourceRows.find((row) => row.source === "unknown")!.count)} ${locale === "de" ? "unbekannt" : "unknown"}`}
            toneClass="text-[color:var(--stats-warning-text)]"
            icon={Sparkles}
          />
          <StudioMetricTile
            label={locale === "de" ? "Fehlerdruck" : "Failure Pressure"}
            value={formatNumber(stats.statusCounts.failed)}
            detail={`${formatNumber(failureRiskCount)} ${locale === "de" ? "nicht verfügbare oder nicht unterstützte Quellenzähler" : "unavailable or unsupported source counts"}`}
            toneClass={stats.statusCounts.failed > 0 || failureRiskCount > 0 ? "text-[color:var(--stats-negative-text)]" : "text-[color:var(--stats-positive-text)]"}
            icon={stats.statusCounts.failed > 0 || failureRiskCount > 0 ? AlertTriangle : CheckCircle2}
          />
          <StudioMetricTile
            label={locale === "de" ? "Provider-Abdeckung" : "Provider Coverage"}
            value={providerRows.length > 0 ? `${formatNumber(providerRows.length)} Provider` : locale === "de" ? "Keine Provider" : "No providers"}
            detail={highestRiskProvider ? `${locale === "de" ? "Höchstes Risiko" : "Highest risk"}: ${highestRiskProvider.provider.label}` : locale === "de" ? "Keine Provider-Telemetrie eingegangen" : "No provider telemetry landed"}
            toneClass="text-[color:var(--stats-accent-cyan)]"
          />
          <StudioMetricTile
            label={locale === "de" ? "Provider-Kosten" : "Provider Cost"}
            value={formatPricingValue(providerCost, locale)}
            detail={highestCostProvider && highestCostProvider.usage.totalCostUsd > 0 ? `${locale === "de" ? "Höchste Kosten" : "Highest cost"}: ${highestCostProvider.label}` : locale === "de" ? "Kein Preissignal" : "No pricing signal"}
            toneClass="text-[color:var(--stats-positive-text)]"
            icon={DollarSign}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1.02fr_0.98fr]">
        {sourceSegments.length > 0 ? (
          <DonutCard
            title={locale === "de" ? "Telemetriequellenmix" : "Telemetry Source Mix"}
            eyebrow={locale === "de" ? "Quellenvertrauen" : "Source Confidence"}
            description={locale === "de" ? "Gemeldete, geschätzte, nicht verfügbare, nicht unterstützte und unbekannte Aufrufquellenzähler in diesem Zeitraum." : "Reported, estimated, unavailable, unsupported, and unknown invocation-source counts across this window."}
            centerValue={formatNumber(sourceAudit.total)}
            centerLabel={locale === "de" ? "Quellenzähler" : "source counts"}
            segments={sourceSegments}
          />
        ) : (
          <div className={`${PANEL_CLASS} p-6`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Quellenvertrauen" : "Source Confidence"}</div>
            <div className="mt-2 text-xl font-semibold tracking-tight text-[color:var(--stats-value-color)]">{locale === "de" ? "Telemetriequellenmix" : "Telemetry Source Mix"}</div>
            <div className="mt-2 text-sm leading-relaxed text-[color:var(--stats-detail-color)]">
              {locale === "de" ? "Gemeldete, geschätzte, nicht verfügbare, nicht unterstützte und unbekannte Aufrufquellenzähler in diesem Zeitraum." : "Reported, estimated, unavailable, unsupported, and unknown invocation-source counts across this window."}
            </div>
            <div className="mt-6">
              <EmptyTelemetryPanel
                title={locale === "de" ? "Keine Telemetriequellensegmente für diesen Zeitraum." : "No telemetry source segments for this window."}
                detail={locale === "de" ? "Provider-Aufrufzahlen können dennoch vorhanden sein, aber der Snapshot enthält keine darstellbaren Quellensegmente." : "Provider invocation counts may still exist, but the snapshot did not include source-segment lanes to chart."}
              />
            </div>
          </div>
        )}
        {providerSegments.length > 0 ? (
          <DonutCard
            title={locale === "de" ? "Provider-Anteil" : "Provider Share"}
            eyebrow={locale === "de" ? "Volumenkontext" : "Volume Context"}
            description={locale === "de" ? "Token-Volumen nach Provider neben Vertrauens- und Risikosignalen, damit Provider mit hohem Volumen leicht priorisiert werden können." : "Token volume by provider, shown beside confidence and risk signals so high-volume providers stay easy to triage."}
            centerValue={formatTokens(stats.usage.totalTokens, locale)}
            centerLabel={locale === "de" ? "Token-Volumen" : "token volume"}
            segments={providerSegments}
          />
        ) : (
          <div className={`${PANEL_CLASS} p-6`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Volumenkontext" : "Volume Context"}</div>
            <div className="mt-2 text-xl font-semibold tracking-tight text-[color:var(--stats-value-color)]">{locale === "de" ? "Provider-Anteil" : "Provider Share"}</div>
            <div className="mt-2 text-sm leading-relaxed text-[color:var(--stats-detail-color)]">
              {locale === "de" ? "Das Token-Volumen nach Provider erscheint hier, wenn der ausgewählte Zeitraum Provider-Segmente enthält." : "Token volume by provider appears here when the selected window includes provider segments."}
            </div>
            <div className="mt-6">
              <EmptyTelemetryPanel
                title={locale === "de" ? "Keine Provider-Segmente für diesen Zeitraum." : "No provider segments for this window."}
                detail={locale === "de" ? "Provider-Zuverlässigkeitskarten erscheinen weiterhin unten, wenn Provider-Zeilen ohne darstellbaren Token-Anteil vorhanden sind." : "Provider reliability cards will still appear below when provider rows exist without chartable token share."}
              />
            </div>
          </div>
        )}
      </div>

      <div className={`${PANEL_CLASS} p-6`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className={SECTION_TITLE_CLASS}>{locale === "de" ? "Vertrauensübersicht" : "Confidence Board"}</div>
            <div className={SECTION_COPY_CLASS}>
              {locale === "de" ? "Aufrufquellenzähler werden getrennt, damit geschätzte und unbekannte Daten klar erkennbar sind, ohne Ersatzschätzungen als Fehler zu behandeln." : "Invocation-source counts are separated so estimated and unknown data are clear without treating fallback estimates as failures."}
            </div>
          </div>
          <div className={FLAT_BADGE_CLASS}>
            {formatNumber(sourceAudit.total)} {locale === "de" ? "gezählt" : "counted"}
          </div>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5" data-testid="reliability-confidence-board">
          {sourceRows.map((row) => <SourceCountCard key={row.source} row={row} />)}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className={SECTION_TITLE_CLASS}>{locale === "de" ? "Provider-Aufschlüsselung" : "Provider Breakdown"}</div>
            <div className={SECTION_COPY_CLASS}>
              {locale === "de" ? "Provider-Zeilen ordnen Fehlerrisiko, Quellenvertrauen, Token-Volumen, Latenz und Preissignale zur Priorisierung." : "Provider rows rank failure risk, source confidence, token volume, latency, and pricing signals for triage."}
            </div>
          </div>
          <div className={FLAT_BADGE_CLASS}>
            {formatNumber(providerRows.length)} Provider
          </div>
        </div>
        {providerRows.length === 0 ? (
          <EmptyTelemetryPanel
            title={locale === "de" ? "Keine Provider-Telemetrie für diesen Zeitraum." : "No provider telemetry for this window."}
            detail={locale === "de" ? "Provider-Zuverlässigkeit erscheint, sobald erfasste Aufrufe Provider-Nutzung oder Statuszusammenfassungen enthalten." : "Provider reliability appears after tracked invocations record provider usage or status summaries."}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {providerRows.map((row) => <ProviderReliabilityCard key={row.provider.id} row={row} />)}
          </div>
        )}
      </div>

      <div className={`${PANEL_CLASS} p-6`}>
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-[color:var(--stats-detail-color)]" strokeWidth={2} aria-hidden="true" />
          <div className={SECTION_TITLE_CLASS}>{locale === "de" ? "Prüfhinweise" : "Audit Notes"}</div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className={SUBPANEL_CLASS}>
            <div className="text-sm font-semibold text-[color:var(--stats-value-color)]">{locale === "de" ? "Ersatzwertmix" : "Fallback mix"}</div>
            <div className="mt-2 text-sm leading-relaxed text-[color:var(--stats-detail-color)]">
              {fallbackCount > 0
                ? locale === "de" ? `${formatNumber(fallbackCount)} Aufrufe nutzten geschätzte oder unbekannte Quellenzähler. Schätzungen bleiben nutzbar, sind aber weniger präzise als Provider-Meldungen.` : `${formatNumber(fallbackCount)} invocations relied on estimated or unknown source counters. Estimates remain usable, but precision is lower than provider-reported counts.`
                : locale === "de" ? "In diesem Zeitraum wurden keine geschätzten oder unbekannten Aufrufquellenzähler erfasst." : "No estimated or unknown invocation-source counts were recorded in this window."}
            </div>
          </div>
          <div className={SUBPANEL_CLASS}>
            <div className="text-sm font-semibold text-[color:var(--stats-value-color)]">{locale === "de" ? "Fehlerrisiko" : "Failure risk"}</div>
            <div className="mt-2 text-sm leading-relaxed text-[color:var(--stats-detail-color)]">
              {stats.statusCounts.failed > 0 || failureRiskCount > 0
                ? locale === "de" ? `${formatNumber(stats.statusCounts.failed)} Aufrufe schlugen fehl und ${formatNumber(failureRiskCount)} Quellenzähler waren nicht verfügbar oder nicht unterstützt.` : `${formatNumber(stats.statusCounts.failed)} invocations failed and ${formatNumber(failureRiskCount)} source counts were unavailable or unsupported.`
                : locale === "de" ? "In diesem Zeitraum wurden keine fehlgeschlagenen Aufrufe oder nicht verfügbaren Quellenzähler erfasst." : "No failed invocations or unavailable source counts were recorded in this window."}
            </div>
          </div>
          <div className={SUBPANEL_CLASS}>
            <div className="text-sm font-semibold text-[color:var(--stats-value-color)]">{locale === "de" ? "Dauerabdeckung" : "Duration coverage"}</div>
            <div className="mt-2 text-sm leading-relaxed text-[color:var(--stats-detail-color)]">
              {stats.duration.sampleCount > 0
                ? locale === "de" ? `Die Latenz basiert auf ${formatNumber(stats.duration.sampleCount)} Stichproben: p50 ${formatStatsDuration(stats.duration.p50Ms, locale)}, p95 ${formatStatsDuration(stats.duration.p95Ms, locale)}.` : `Latency is backed by ${formatNumber(stats.duration.sampleCount)} samples: p50 ${formatStatsDuration(stats.duration.p50Ms, locale)}, p95 ${formatStatsDuration(stats.duration.p95Ms, locale)}.`
                : locale === "de" ? "Es wurden keine Dauerstichproben erfasst; die Latenz bleibt daher nicht verfügbar, statt abgeleitet zu werden." : "No duration samples were recorded, so latency remains unavailable rather than inferred."}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
