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

function formatCount(value: number): string {
  const normalized = Number.isFinite(value) && value > 0 ? value : 0;
  return new Intl.NumberFormat("en-US").format(normalized);
}

function formatExactUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 20,
  }).format(value);
}

function formatNamedCount(value: number, singular: string, plural = `${singular}s`): string {
  const normalized = Number.isFinite(value) && value > 0 ? value : 0;
  return `${formatCount(normalized)} ${normalized === 1 ? singular : plural}`;
}

function formatExactAmount(amount: CostAmount): string {
  if (amount.usd === null || !Number.isFinite(amount.usd) || amount.provenance.state === "unavailable") {
    return "Unavailable";
  }
  if (amount.provenance.state === "unpriced") return "Unpriced";
  if (amount.provenance.state === "unknown" && amount.usd === 0) return "Coverage unknown";

  const value = formatExactUsd(Math.max(0, amount.usd));
  if (amount.provenance.state === "partial") return `${value}+ (priced subtotal)`;
  if (amount.provenance.state === "unknown") return `${value} (coverage unknown)`;
  return value;
}

function coverageLabel(state: CostCoverageState): string {
  switch (state) {
    case "complete": return "Fully priced";
    case "partial": return "Partial coverage";
    case "unpriced": return "Unpriced usage";
    case "unknown": return "Coverage unknown";
    case "unavailable": return "No usage";
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

function coverageCopy(provenance: CostProvenance, totalSpend: CostAmount): string {
  const calls = formatCount(provenance.invocationCount);
  const invocationLabel = provenance.invocationCount === 1 ? "invocation" : "invocations";
  const configured = formatCount(provenance.configuredPricingInvocationCount);
  const reported = formatCount(provenance.providerReportedCostInvocationCount);
  const unpriced = formatCount(provenance.unpricedInvocationCount);
  const unknown = formatCount(provenance.unknownInvocationCount);

  switch (provenance.state) {
    case "unavailable":
      return "No provider invocations were recorded in this window, so cost metrics are unavailable.";
    case "complete":
      if (totalSpend.usd === 0) {
        return `All ${calls} ${invocationLabel} have a valid pricing source and legitimately total $0.00 (${configured} configured, ${reported} provider reported).`;
      }
      return `All ${calls} ${invocationLabel} are priced: ${configured} from configured rates and ${reported} from provider-reported cost.`;
    case "partial":
      return `${configured} configured and ${reported} provider-reported invocations are included; ${unpriced} unpriced invocations are excluded. Dollar values are priced subtotals.`;
    case "unpriced":
      return `None of the ${calls} ${invocationLabel} has a usable pricing source. Dollar totals are unavailable, not zero.`;
    case "unknown":
      return `Coverage metadata is missing for ${unknown} of ${calls} ${invocationLabel}. Displayed dollar values cannot be treated as complete.`;
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

function bucketCoverageContext(row: CostOverTimeRow): string {
  const state = row.amount.provenance.state;
  if (state === "partial") return "Partial pricing; value is a priced subtotal.";
  if (state === "unpriced") return "Usage is unpriced; no zero-dollar value is claimed.";
  if (state === "unknown") return "Pricing coverage is unknown.";
  if (state === "unavailable") return "No cost value is available.";
  if (row.amount.usd === 0 && row.calls > 0) return "Fully priced usage with a legitimate zero-dollar cost.";
  return "Pricing coverage is complete.";
}

function SpendChart({ viewModel }: CostOverviewPanelProps): JSX.Element {
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
    ? "No provider usage was recorded, so there is no spend trend for this window."
    : !hasBuckets
      ? "Provider usage was recorded, but no time buckets are available for this window."
      : totalState === "unpriced"
        ? `${points.length} time ${points.length === 1 ? "bucket contains" : "buckets contain"} usage, but no priced spend is available.`
        : `Spend across ${points.length} time ${points.length === 1 ? "bucket" : "buckets"}. ${peak ? `Peak: ${peak.row.label}, ${formatExactAmount(peak.row.amount)}.` : "No priced bucket values are available."}`;

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
          <p className={styles.eyebrow}>Time series</p>
          <h3 id={titleId} className={styles.chartTitle}>Spend over time</h3>
          <p id={summaryId} className={styles.chartSummary}>{chartSummary}</p>
        </div>
        {hasBuckets ? (
          <div className={styles.chartKey} aria-label="Chart marker key">
            <span><span className={styles.peakCue} aria-hidden="true">◆</span> Peak</span>
            <span><span className={styles.selectedCue} aria-hidden="true">◎</span> Selected</span>
          </div>
        ) : null}
      </div>

      {!hasUsage ? (
        <div className={styles.emptyState} role="status">
          <strong>No usage in this window</strong>
          <span>Cost averages and a spend trend will appear after a provider invocation is recorded.</span>
        </div>
      ) : !hasBuckets ? (
        <div className={styles.emptyState} role="status">
          <strong>No time buckets available</strong>
          <span>The headline usage is preserved, but there is not enough bucket data to draw a trend.</span>
        </div>
      ) : (
        <>
          <div className={styles.chartFrame} data-responsive-safe="true">
            <div className={styles.yAxis} aria-hidden="true">
              <span>{peak ? formatAdaptiveCurrency(peak.row.amount) : "No price"}</span>
              <span>$0</span>
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

              <div className={styles.bucketTargets} aria-label="Spend buckets">
                {points.map((point, index) => {
                  const isSelected = selected?.row.id === point.row.id;
                  const isPeak = peak?.row.id === point.row.id;
                  const exactValue = formatExactAmount(point.row.amount);
                  const accessibleLabel = `${point.row.label}: ${exactValue}; ${formatCount(point.row.calls)} calls; ${formatCount(point.row.tokens)} tokens. ${bucketCoverageContext(point.row)}${isPeak ? " Peak bucket." : ""}`;
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
                <span className={styles.detailLabel}>Focused bucket</span>
                <strong>{selected.row.label}{selected.row.id === peak?.row.id ? " · Peak" : ""}</strong>
              </div>
              <dl>
                <div><dt>Exact spend</dt><dd>{formatExactAmount(selected.row.amount)}</dd></div>
                <div><dt>Calls</dt><dd>{formatCount(selected.row.calls)}</dd></div>
                <div><dt>Tokens</dt><dd>{formatCount(selected.row.tokens)}</dd></div>
                <div><dt>Coverage</dt><dd>{coverageLabel(selected.row.amount.provenance.state)}</dd></div>
              </dl>
              <p>{bucketCoverageContext(selected.row)}</p>
            </div>
          ) : null}

          <div className="sr-only">
            <table>
              <caption>Spend over time data</caption>
              <thead>
                <tr><th scope="col">Bucket</th><th scope="col">Exact spend</th><th scope="col">Pricing coverage</th><th scope="col">Calls</th><th scope="col">Tokens</th></tr>
              </thead>
              <tbody>
                {points.map(({ row }) => (
                  <tr key={row.id}>
                    <th scope="row">{row.label}</th>
                    <td>{formatExactAmount(row.amount)}</td>
                    <td>{coverageLabel(row.amount.provenance.state)}</td>
                    <td>{formatCount(row.calls)}</td>
                    <td>{formatCount(row.tokens)}</td>
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
  const provenance = viewModel.totalSpend.provenance;
  const metrics: MetricDefinition[] = [
    {
      label: "Total spend",
      value: formatAdaptiveCurrency(viewModel.totalSpend),
      detail: provenance.state === "partial" ? "Priced subtotal; unpriced calls excluded" : "Across the selected window",
    },
    {
      label: "Average per task",
      value: formatAdaptiveCurrency(viewModel.averageCostPerTask),
      detail: viewModel.averageCostPerTask.entityCount > 0
        ? `Across ${formatNamedCount(viewModel.averageCostPerTask.entityCount, "task")} with usage`
        : "No tasks with provider usage",
    },
    {
      label: "Average per sprint",
      value: formatAdaptiveCurrency(viewModel.averageCostPerSprint),
      detail: viewModel.averageCostPerSprint.entityCount > 0
        ? `Across ${formatNamedCount(viewModel.averageCostPerSprint.entityCount, "canonical sprint")} with usage`
        : "No sprints with provider usage",
    },
    {
      label: "Cost per invocation",
      value: formatAdaptiveCurrency(viewModel.costPerInvocation),
      detail: viewModel.calls > 0 ? `Across ${formatNamedCount(viewModel.calls, "provider call")}` : "No provider calls",
    },
    {
      label: "Blended cost per million tokens",
      value: formatAdaptiveCurrency(viewModel.costPerMillionTokens),
      detail: viewModel.tokens > 0 ? `Across ${formatCount(viewModel.tokens)} tracked tokens` : "No tracked tokens",
    },
  ];

  return (
    <section className={`${PANEL_CLASS} ${styles.panel}`} aria-label="Cost executive overview" data-responsive-safe="true">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Cost intelligence</p>
          <h2>Executive overview</h2>
          <p>Spend, normalized rates, and pricing confidence from the shared Cost analytics model.</p>
        </div>
        <span className={`${styles.statusBadge} ${coverageTone(provenance.state)}`}>
          {coverageLabel(provenance.state)}
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
          <h3>Pricing coverage</h3>
          <p className={styles.metricValue}>{coverageLabel(provenance.state)}</p>
          <p className={styles.metricDetail}>{coverageCopy(provenance, viewModel.totalSpend)}</p>
        </article>
      </div>

      <SpendChart viewModel={viewModel} />
    </section>
  );
};
