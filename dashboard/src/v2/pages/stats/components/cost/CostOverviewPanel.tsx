import type { FunctionComponent, JSX } from "preact";
import { useId, useState } from "preact/hooks";
import { STATS_COLORS } from "../../../../lib/stats/color-tokens.js";
import type {
  CostAmount,
  CostAnalyticsViewModel,
  CostCoverageState,
  CostOverTimeRow,
  CostProvenance,
} from "../../cost-insights.js";
import { formatAdaptiveCurrency } from "../../cost-insights.js";
import {
  CONTROL_FOCUS_CLASS,
  PANEL_CLASS,
  STATUS_TONE_CLASS,
  SUBPANEL_CLASS,
} from "../stats-ui-primitives.js";
import styles from "./CostOverviewPanel.module.css";
import { useStatsI18n, type StatsI18nValue } from "../../stats-i18n.js";

const CHART_WIDTH = 720;
const CHART_HEIGHT = 240;
const CHART_LEFT = 36;
const CHART_RIGHT = 36;
const CHART_TOP = 20;
const CHART_BOTTOM = 188;

interface ChartPoint {
  row: CostOverTimeRow;
  x: number;
  y: number;
  usd: number | null;
}

interface MetricDefinition {
  label: string;
  value: string;
  detail: string;
}

export interface CostOverviewPanelProps {
  viewModel: CostAnalyticsViewModel;
}

function formatCount(value: number, i18n: StatsI18nValue): string {
  const normalized = Number.isFinite(value) && value > 0 ? value : 0;
  return i18n.formatNumber(normalized);
}

function formatExactUsd(value: number, i18n: StatsI18nValue): string {
  if (!Number.isFinite(value) || value <= 0) return i18n.formatCurrency(0);
  return new Intl.NumberFormat(i18n.locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 20,
  }).format(value);
}

function formatExactAmount(amount: CostAmount, i18n: StatsI18nValue): string {
  if (amount.usd === null || !Number.isFinite(amount.usd) || amount.provenance.state === "unavailable") {
    return i18n.text("unavailable");
  }
  if (amount.provenance.state === "unpriced") return i18n.text("unpriced");
  if (amount.provenance.state === "unknown" && amount.usd === 0) return i18n.text("coverageUnknown");

  const value = formatExactUsd(Math.max(0, amount.usd), i18n);
  if (amount.provenance.state === "partial") return i18n.text("pricedSubtotalValue", { value });
  if (amount.provenance.state === "unknown") return i18n.text("coverageUnknownValue", { value });
  return value;
}

function coverageLabel(state: CostCoverageState, i18n: StatsI18nValue): string {
  switch (state) {
    case "complete": return i18n.text("fullyPriced");
    case "partial": return i18n.text("partialCoverage");
    case "unpriced": return i18n.text("unpricedUsage");
    case "unknown": return i18n.text("coverageUnknown");
    case "unavailable": return i18n.text("noUsage");
  }
}

function coverageTone(state: CostCoverageState): string {
  switch (state) {
    case "complete": return STATUS_TONE_CLASS.positive;
    case "partial":
    case "unpriced":
    case "unknown":
      return STATUS_TONE_CLASS.warning;
    case "unavailable": return STATUS_TONE_CLASS.neutral;
  }
}

function coverageCopy(provenance: CostProvenance, totalSpend: CostAmount, i18n: StatsI18nValue): string {
  const variables = {
    calls: formatCount(provenance.invocationCount, i18n),
    configured: formatCount(provenance.configuredPricingInvocationCount, i18n),
    reported: formatCount(provenance.providerReportedCostInvocationCount, i18n),
    unpriced: formatCount(provenance.unpricedInvocationCount, i18n),
    unknown: formatCount(provenance.unknownInvocationCount, i18n),
  };

  switch (provenance.state) {
    case "unavailable":
      return i18n.text("coverageNoInvocations");
    case "complete":
      if (totalSpend.usd === 0) {
        return i18n.text("coverageCompleteFree", variables);
      }
      return i18n.text("coverageCompleteDetail", variables);
    case "partial":
      return i18n.text("coveragePartialDetail", variables);
    case "unpriced":
      return i18n.text("coverageUnpricedDetail", variables);
    case "unknown":
      return i18n.text("coverageUnknownDetail", variables);
  }
}

function getPlottableUsd(row: CostOverTimeRow): number | null {
  const { usd, provenance } = row.amount;
  if (usd === null || !Number.isFinite(usd) || provenance.state === "unavailable" || provenance.state === "unpriced") {
    return null;
  }
  if (provenance.state === "unknown" && usd === 0) return null;
  return Math.max(0, usd);
}

function buildChartPoints(rows: CostOverTimeRow[]): ChartPoint[] {
  const values = rows.map(getPlottableUsd);
  const maximum = Math.max(0, ...values.filter((value): value is number => value !== null));
  const plotWidth = CHART_WIDTH - CHART_LEFT - CHART_RIGHT;
  const plotHeight = CHART_BOTTOM - CHART_TOP;

  return rows.map((row, index) => {
    const usd = values[index] ?? null;
    const x = rows.length === 1
      ? CHART_WIDTH / 2
      : CHART_LEFT + (index / Math.max(1, rows.length - 1)) * plotWidth;
    const y = usd === null || maximum === 0
      ? CHART_BOTTOM
      : CHART_BOTTOM - (usd / maximum) * plotHeight;
    return { row, x, y, usd };
  });
}

function buildLinePath(points: ChartPoint[]): string {
  let drawing = false;
  return points.map((point) => {
    if (point.usd === null) {
      drawing = false;
      return "";
    }
    const command = drawing ? "L" : "M";
    drawing = true;
    return `${command}${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }).filter(Boolean).join(" ");
}

function getPeakPoint(points: ChartPoint[]): ChartPoint | null {
  return points.reduce<ChartPoint | null>((peak, point) => {
    if (point.usd === null) return peak;
    if (!peak || peak.usd === null || point.usd > peak.usd) return point;
    return peak;
  }, null);
}

function bucketCoverageContext(row: CostOverTimeRow, i18n: StatsI18nValue): string {
  const state = row.amount.provenance.state;
  if (state === "partial") return i18n.text("bucketPartialPricing");
  if (state === "unpriced") return i18n.text("bucketUnpriced");
  if (state === "unknown") return i18n.text("bucketCoverageUnknown");
  if (state === "unavailable") return i18n.text("bucketNoCost");
  if (row.amount.usd === 0 && row.calls > 0) return i18n.text("bucketFreeUsage");
  return i18n.text("bucketCompletePricing");
}

function SpendChart({ viewModel }: CostOverviewPanelProps): JSX.Element {
  const i18n = useStatsI18n();
  const titleId = useId();
  const summaryId = useId();
  const points = buildChartPoints(viewModel.costOverTime);
  const peak = getPeakPoint(points);
  const fallbackSelection = peak ?? points[0] ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(() => fallbackSelection?.row.id ?? null);
  const selected = points.find((point) => point.row.id === selectedId) ?? fallbackSelection;
  const linePath = buildLinePath(points);
  const hasUsage = viewModel.calls > 0;
  const hasBuckets = points.length > 0;
  const totalState = viewModel.totalSpend.provenance.state;
  const chartSummary = !hasUsage
    ? i18n.text("noSpendTrend")
    : !hasBuckets
      ? i18n.text("noSpendBuckets")
      : totalState === "unpriced"
        ? i18n.plural("unpricedTimeBuckets", points.length, { count: i18n.formatNumber(points.length) })
        : i18n.plural("spendAcrossBuckets", points.length, { count: i18n.formatNumber(points.length), detail: peak ? i18n.text("peakBucketDetail", { label: peak.row.label, value: formatExactAmount(peak.row.amount, i18n) }) : i18n.text("noPricedBucketValues") });

  const handleBucketKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = Math.min(points.length - 1, index + 1);
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = Math.max(0, index - 1);
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = points.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const bucketButtons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button");
    bucketButtons?.item(nextIndex).focus();
  };

  return (
    <section className={styles.chartSection} aria-labelledby={titleId} aria-describedby={summaryId}>
      <div className={styles.chartHeader}>
        <div>
          <p className={styles.eyebrow}>{i18n.text("timeSeries")}</p>
          <h3 id={titleId} className={styles.chartTitle}>{i18n.text("spendOverTime")}</h3>
          <p id={summaryId} className={styles.chartSummary}>{chartSummary}</p>
        </div>
        {hasBuckets ? (
          <div className={styles.chartKey} aria-label={i18n.text("chartMarkerKey")}>
            <span><span className={styles.peakCue} aria-hidden="true">◆</span> {i18n.text("peak")}</span>
            <span><span className={styles.selectedCue} aria-hidden="true">◎</span> {i18n.text("selected")}</span>
          </div>
        ) : null}
      </div>

      {!hasUsage ? (
        <div className={styles.emptyState} role="status">
          <strong>{i18n.text("noUsageInWindow")}</strong>
          <span>{i18n.text("costAppearsAfterInvocation")}</span>
        </div>
      ) : !hasBuckets ? (
        <div className={styles.emptyState} role="status">
          <strong>{i18n.text("noTimeBucketsAvailable")}</strong>
          <span>{i18n.text("notEnoughBucketData")}</span>
        </div>
      ) : (
        <>
          <div className={styles.chartFrame} data-responsive-safe="true">
            <div className={styles.yAxis} aria-hidden="true">
              <span>{peak ? formatAdaptiveCurrency(peak.row.amount, i18n.locale) : i18n.text("noPrice")}</span>
              <span>{i18n.formatNumber(0, { style: "currency", currency: "USD", maximumFractionDigits: 0 })}</span>
            </div>
            <div className={styles.plot}>
              <svg
                className={styles.svg}
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                preserveAspectRatio="none"
                aria-hidden="true"
                focusable="false"
              >
                <line className={styles.gridLine} x1={CHART_LEFT} x2={CHART_WIDTH - CHART_RIGHT} y1={CHART_TOP} y2={CHART_TOP} />
                <line className={styles.gridLine} x1={CHART_LEFT} x2={CHART_WIDTH - CHART_RIGHT} y1={(CHART_TOP + CHART_BOTTOM) / 2} y2={(CHART_TOP + CHART_BOTTOM) / 2} />
                <line className={styles.axisLine} x1={CHART_LEFT} x2={CHART_WIDTH - CHART_RIGHT} y1={CHART_BOTTOM} y2={CHART_BOTTOM} />
                {linePath ? (
                  <path
                    className={styles.spendLine}
                    d={linePath}
                    fill="none"
                    stroke={STATS_COLORS.signal}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                {points.map((point) => point.usd === null ? (
                  <g key={point.row.id} className={styles.unpricedGlyph} aria-hidden="true">
                    <line x1={point.x - 5} x2={point.x + 5} y1={point.y - 5} y2={point.y + 5} vectorEffect="non-scaling-stroke" />
                    <line x1={point.x - 5} x2={point.x + 5} y1={point.y + 5} y2={point.y - 5} vectorEffect="non-scaling-stroke" />
                  </g>
                ) : point.row.id === peak?.row.id ? (
                  <rect
                    key={point.row.id}
                    className={styles.peakGlyph}
                    x={point.x - 5}
                    y={point.y - 5}
                    width="10"
                    height="10"
                    transform={`rotate(45 ${point.x} ${point.y})`}
                    fill={STATS_COLORS.amber}
                    vectorEffect="non-scaling-stroke"
                    aria-hidden="true"
                  />
                ) : (
                  <circle key={point.row.id} className={styles.pointGlyph} cx={point.x} cy={point.y} r="4" aria-hidden="true" />
                ))}
              </svg>

              <div className={styles.bucketTargets} aria-label={i18n.text("spendBuckets")}>
                {points.map((point, index) => {
                  const isSelected = selected?.row.id === point.row.id;
                  const isPeak = peak?.row.id === point.row.id;
                  const exactValue = formatExactAmount(point.row.amount, i18n);
                  const accessibleLabel = i18n.text("spendBucketAccessible", { label: point.row.label, value: exactValue, calls: formatCount(point.row.calls, i18n), tokens: formatCount(point.row.tokens, i18n), coverage: bucketCoverageContext(point.row, i18n), peak: isPeak ? i18n.text("peakBucketSuffix") : "" });
                  return (
                    <button
                      key={point.row.id}
                      type="button"
                      className={`${styles.bucketTarget} ${CONTROL_FOCUS_CLASS}`}
                      style={{
                        left: `${(point.x / CHART_WIDTH) * 100}%`,
                        top: `${(point.y / CHART_HEIGHT) * 100}%`,
                      }}
                      aria-label={accessibleLabel}
                      aria-pressed={isSelected}
                      data-peak={isPeak ? "true" : undefined}
                      data-unpriced={point.usd === null ? "true" : undefined}
                      title={accessibleLabel}
                      onFocus={() => setSelectedId(point.row.id)}
                      onClick={() => setSelectedId(point.row.id)}
                      onKeyDown={(event) => handleBucketKeyDown(event, index)}
                    >
                      <span aria-hidden="true" />
                    </button>
                  );
                })}
              </div>

              <div className={styles.xAxis} aria-hidden="true">
                <span>{points[0]?.row.label}</span>
                {points.length > 1 ? <span>{points[points.length - 1]?.row.label}</span> : null}
              </div>
            </div>
          </div>

          {selected ? (
            <div className={`${SUBPANEL_CLASS} ${styles.bucketDetail}`} role="status" aria-live="polite">
              <div>
                <span className={styles.detailLabel}>{i18n.text("focusedBucket")}</span>
                <strong>{selected.row.label}{selected.row.id === peak?.row.id ? ` · ${i18n.text("peak")}` : ""}</strong>
              </div>
              <dl>
                <div><dt>{i18n.text("exactSpend")}</dt><dd>{formatExactAmount(selected.row.amount, i18n)}</dd></div>
                <div><dt>{i18n.text("calls")}</dt><dd>{formatCount(selected.row.calls, i18n)}</dd></div>
                <div><dt>{i18n.text("tokens")}</dt><dd>{formatCount(selected.row.tokens, i18n)}</dd></div>
                <div><dt>{i18n.text("coverage")}</dt><dd>{coverageLabel(selected.row.amount.provenance.state, i18n)}</dd></div>
              </dl>
              <p>{bucketCoverageContext(selected.row, i18n)}</p>
            </div>
          ) : null}

          <div className="sr-only">
            <table>
              <caption>{i18n.text("spendOverTimeData")}</caption>
              <thead>
                <tr><th scope="col">{i18n.text("bucket")}</th><th scope="col">{i18n.text("exactSpend")}</th><th scope="col">{i18n.text("pricingCoverage")}</th><th scope="col">{i18n.text("calls")}</th><th scope="col">{i18n.text("tokens")}</th></tr>
              </thead>
              <tbody>
                {points.map(({ row }) => (
                  <tr key={row.id}>
                    <th scope="row">{row.label}</th>
                    <td>{formatExactAmount(row.amount, i18n)}</td>
                    <td>{coverageLabel(row.amount.provenance.state, i18n)}</td>
                    <td>{formatCount(row.calls, i18n)}</td>
                    <td>{formatCount(row.tokens, i18n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export const CostOverviewPanel: FunctionComponent<CostOverviewPanelProps> = ({ viewModel }) => {
  const i18n = useStatsI18n();
  const provenance = viewModel.totalSpend.provenance;
  const metrics: MetricDefinition[] = [
    {
      label: i18n.text("totalSpend"),
      value: formatAdaptiveCurrency(viewModel.totalSpend, i18n.locale),
      detail: provenance.state === "partial" ? i18n.text("pricedSubtotalCallsExcluded") : i18n.text("acrossSelectedWindow"),
    },
    {
      label: i18n.text("averagePerTask"),
      value: formatAdaptiveCurrency(viewModel.averageCostPerTask, i18n.locale),
      detail: viewModel.averageCostPerTask.entityCount > 0
        ? i18n.plural("acrossTasksWithUsage", viewModel.averageCostPerTask.entityCount, { count: i18n.formatNumber(viewModel.averageCostPerTask.entityCount) })
        : i18n.text("noTasksWithProviderUsage"),
    },
    {
      label: i18n.text("averagePerSprint"),
      value: formatAdaptiveCurrency(viewModel.averageCostPerSprint, i18n.locale),
      detail: viewModel.averageCostPerSprint.entityCount > 0
        ? i18n.plural("acrossCanonicalSprintsWithUsage", viewModel.averageCostPerSprint.entityCount, { count: i18n.formatNumber(viewModel.averageCostPerSprint.entityCount) })
        : i18n.text("noSprintsWithProviderUsage"),
    },
    {
      label: i18n.text("costPerInvocation"),
      value: formatAdaptiveCurrency(viewModel.costPerInvocation, i18n.locale),
      detail: viewModel.calls > 0 ? i18n.plural("acrossProviderCalls", viewModel.calls, { count: i18n.formatNumber(viewModel.calls) }) : i18n.text("noProviderCalls"),
    },
    {
      label: i18n.text("blendedCostPerMillionTokens"),
      value: formatAdaptiveCurrency(viewModel.costPerMillionTokens, i18n.locale),
      detail: viewModel.tokens > 0 ? i18n.text("acrossTrackedTokens", { count: formatCount(viewModel.tokens, i18n) }) : i18n.text("noTrackedTokens"),
    },
  ];

  return (
    <section className={`${PANEL_CLASS} ${styles.panel}`} aria-label={i18n.text("costExecutiveOverview")} data-responsive-safe="true">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{i18n.text("costIntelligence")}</p>
          <h2>{i18n.text("executiveOverview")}</h2>
          <p>{i18n.text("executiveOverviewDescription")}</p>
        </div>
        <span className={`${styles.statusBadge} ${coverageTone(provenance.state)}`}>
          {coverageLabel(provenance.state, i18n)}
        </span>
      </header>

      <div className={styles.metricGrid}>
        {metrics.map((metric) => (
          <article key={metric.label} className={`${SUBPANEL_CLASS} ${styles.metric}`}>
            <h3>{metric.label}</h3>
            <p className={styles.metricValue}>{metric.value}</p>
            <p className={styles.metricDetail}>{metric.detail}</p>
          </article>
        ))}
        <article className={`${SUBPANEL_CLASS} ${styles.metric} ${styles.coverageMetric}`}>
          <h3>{i18n.text("pricingCoverage")}</h3>
          <p className={styles.metricValue}>{coverageLabel(provenance.state, i18n)}</p>
          <p className={styles.metricDetail}>{coverageCopy(provenance, viewModel.totalSpend, i18n)}</p>
        </article>
      </div>

      <SpendChart viewModel={viewModel} />
    </section>
  );
};
