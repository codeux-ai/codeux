import type { FunctionComponent, JSX } from "preact";
import type {
  CostAmount,
  CostDimensionRow,
  CostModelRow,
  CostProvenance,
  CostSpendSegment,
  CostTokenSegment,
} from "../../cost-insights.js";
import { formatAdaptiveCurrency } from "../../cost-insights.js";
import { useStatsI18n, type StatsI18nValue } from "../../stats-i18n.js";
import {
  CHIP_CLASS,
  CONTROL_FOCUS_CLASS,
  DASHED_EMPTY_CLASS,
  PANEL_CLASS,
  STATUS_TONE_CLASS,
  SUBPANEL_CLASS,
  TRACK_CLASS,
  TokenFlowBar,
} from "../stats-ui-primitives.js";
import styles from "./CostAllocationPanels.module.css";

const TOP_ROW_COUNT = 6;

export interface CostAllocationPanelsProps {
  totalSpend: CostAmount;
  totalTokens: number;
  tokenSegments: CostTokenSegment[];
  spendSegments: CostSpendSegment[];
  models: CostModelRow[];
  purposes: CostDimensionRow[];
}

interface GroupedDimensionRow extends CostDimensionRow {
  groupedRows?: CostDimensionRow[];
}

function formatShare(share: number, locale: StatsI18nValue["locale"]): string {
  const percentage = Math.max(0, share) * 100;
  return `${percentage.toLocaleString(locale, {
    minimumFractionDigits: percentage > 0 && percentage < 0.1 ? 2 : 1,
    maximumFractionDigits: percentage > 0 && percentage < 0.1 ? 2 : 1,
  })}%`;
}

function formatExactTokens(tokens: number, i18n: StatsI18nValue): string {
  return i18n.text("exactTokens", { count: i18n.formatNumber(tokens) });
}

function sumProvenance(rows: CostDimensionRow[]): CostProvenance {
  const totals = rows.reduce<CostProvenance>((sum, row) => ({
    state: sum.state,
    invocationCount: sum.invocationCount + row.amount.provenance.invocationCount,
    configuredPricingInvocationCount: sum.configuredPricingInvocationCount
      + row.amount.provenance.configuredPricingInvocationCount,
    providerReportedCostInvocationCount: sum.providerReportedCostInvocationCount
      + row.amount.provenance.providerReportedCostInvocationCount,
    unpricedInvocationCount: sum.unpricedInvocationCount
      + row.amount.provenance.unpricedInvocationCount,
    unknownInvocationCount: sum.unknownInvocationCount
      + row.amount.provenance.unknownInvocationCount,
  }), {
    state: "unavailable",
    invocationCount: 0,
    configuredPricingInvocationCount: 0,
    providerReportedCostInvocationCount: 0,
    unpricedInvocationCount: 0,
    unknownInvocationCount: 0,
  });

  const covered = totals.configuredPricingInvocationCount
    + totals.providerReportedCostInvocationCount;
  if (totals.unknownInvocationCount > 0) totals.state = "unknown";
  else if (rows.some((row) => row.amount.provenance.state === "partial")) totals.state = "partial";
  else if (covered > 0 && totals.unpricedInvocationCount > 0) totals.state = "partial";
  else if (covered === 0 && totals.unpricedInvocationCount > 0) totals.state = "unpriced";
  else if (totals.invocationCount > 0) totals.state = "complete";
  return totals;
}

function groupDimensionRows(rows: CostDimensionRow[], otherLabel: string): GroupedDimensionRow[] {
  if (rows.length <= TOP_ROW_COUNT) return rows;

  const groupedRows = rows.slice(TOP_ROW_COUNT);
  const provenance = sumProvenance(groupedRows);
  const hasUnavailableAmount = groupedRows.some((row) => (
    row.amount.usd === null || row.amount.provenance.state === "unavailable"
  ));
  const usd = hasUnavailableAmount
    ? null
    : groupedRows.reduce((sum, row) => sum + (row.amount.usd ?? 0), 0);
  const calls = groupedRows.reduce((sum, row) => sum + row.calls, 0);
  const amount: CostAmount = { usd, provenance };
  const costPerCall: CostAmount = calls > 0 && usd !== null
    ? { usd: usd / calls, provenance }
    : { usd: null, provenance: { ...provenance, state: "unavailable" } };

  return [
    ...rows.slice(0, TOP_ROW_COUNT),
    {
      id: "__other__",
      label: otherLabel,
      amount,
      spendShare: groupedRows.reduce((sum, row) => sum + row.spendShare, 0),
      tokenShare: groupedRows.reduce((sum, row) => sum + row.tokenShare, 0),
      calls,
      costPerCall,
      tokens: groupedRows.reduce((sum, row) => sum + row.tokens, 0),
      groupedRows,
    },
  ];
}

function humanizePurpose(label: string, fallback: string): string {
  const normalized = label.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return normalized.length > 0
    ? `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`
    : fallback;
}

function coverageMessage(totalSpend: CostAmount, totalTokens: number, i18n: StatsI18nValue): string {
  const provenance = totalSpend.provenance;
  if (provenance.invocationCount === 0 && totalTokens === 0) {
    return i18n.text("costCoverageEmpty");
  }
  if (provenance.state === "unpriced") {
    return i18n.text("costCoverageUnpriced", { count: i18n.formatNumber(provenance.unpricedInvocationCount) });
  }
  if (provenance.state === "partial") {
    return i18n.text("costCoveragePartial", { unpriced: i18n.formatNumber(provenance.unpricedInvocationCount), total: i18n.formatNumber(provenance.invocationCount) });
  }
  if (provenance.state === "unknown") {
    return i18n.text("costCoverageUnknown", { unknown: i18n.formatNumber(provenance.unknownInvocationCount), total: i18n.formatNumber(provenance.invocationCount) });
  }
  if (provenance.state === "unavailable") {
    return i18n.text("costCoverageUnavailable");
  }
  if (totalSpend.usd === 0) {
    const configuredOnly = provenance.configuredPricingInvocationCount > 0
      && provenance.providerReportedCostInvocationCount === 0;
    return configuredOnly
      ? i18n.text("configuredFreeUsage")
      : i18n.text("coveredZeroCostUsage");
  }
  return i18n.text("costCoverageComplete", { count: i18n.formatNumber(provenance.invocationCount) });
}

function coverageTone(
  totalSpend: CostAmount,
  totalTokens: number,
): keyof typeof STATUS_TONE_CLASS {
  if (totalSpend.provenance.invocationCount === 0 && totalTokens === 0) return "neutral";
  if (totalSpend.provenance.state === "unpriced" || totalSpend.provenance.state === "partial") {
    return "warning";
  }
  if (totalSpend.provenance.state === "unknown") return "cyan";
  if (totalSpend.provenance.state === "unavailable") return "neutral";
  return totalSpend.usd === 0 ? "positive" : "signal";
}

function AllocationHeading({ id, eyebrow, title, description }: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
}): JSX.Element {
  return (
    <header className={styles.panelHeading}>
      <div className={styles.eyebrow}>{eyebrow}</div>
      <h2 id={id} className={styles.panelTitle}>{title}</h2>
      <p className={styles.panelDescription}>{description}</p>
    </header>
  );
}

const TokenAllocation: FunctionComponent<{
  totalTokens: number;
  segments: CostTokenSegment[];
}> = ({ totalTokens, segments }) => {
  const i18n = useStatsI18n();
  const byId = new Map(segments.map((segment) => [segment.id, segment]));
  const getTokens = (id: CostTokenSegment["id"]): number => byId.get(id)?.tokens ?? 0;

  return (
    <article className={`${PANEL_CLASS} ${styles.allocationPanel}`} aria-labelledby="cost-token-allocation-title">
      <AllocationHeading
        id="cost-token-allocation-title"
        eyebrow={i18n.text("tokenAllocation")}
        title={i18n.text("whatConsumedTokens")}
        description={i18n.text("tokenAllocationDescription")}
      />
      <div className={styles.totalLine}>
        <span>{i18n.text("totalTokenVolume")}</span>
        <strong>{formatExactTokens(totalTokens, i18n)}</strong>
      </div>
      <TokenFlowBar
        input={getTokens("input")}
        cached={getTokens("cached_input")}
        output={getTokens("output")}
        reasoning={getTokens("reasoning")}
        total={totalTokens}
      />
      {totalTokens === 0 ? (
        <p className={styles.allocationSummary} role="status">{i18n.text("zeroTokenAllocation")}</p>
      ) : (
        <p className={styles.allocationSummary}>
          {i18n.text("leadingTokenLane", { lane: segments[0]?.label ?? i18n.text("tokenLanes"), share: formatShare(segments[0]?.share ?? 0, i18n.locale) })}
        </p>
      )}
      <ul className={styles.legend} aria-label={i18n.text("exactTokenAllocationValues")}>
        {segments.map((segment) => (
          <li
            key={segment.id}
            className={`${styles.legendRow} ${CONTROL_FOCUS_CLASS}`}
            tabIndex={0}
          >
            <span className={`${styles.swatch} ${styles[`segment_${segment.id}`]}`} aria-hidden="true" />
            <span className={styles.legendLabel}>{segment.label}</span>
            <strong className={styles.legendValue}>{formatExactTokens(segment.tokens, i18n)}</strong>
            <span className={styles.legendShare}>{formatShare(segment.share, i18n.locale)}</span>
          </li>
        ))}
      </ul>
    </article>
  );
};

const SpendAllocation: FunctionComponent<{
  totalSpend: CostAmount;
  totalTokens: number;
  segments: CostSpendSegment[];
}> = ({ totalSpend, totalTokens, segments }) => {
  const i18n = useStatsI18n();
  const hasVisualSpend = totalSpend.usd !== null && totalSpend.usd > 0;
  const leadingSegment = segments.reduce<CostSpendSegment | null>((leader, segment) => (
    leader === null || segment.share > leader.share ? segment : leader
  ), null);
  const chartLabel = `Spend allocation. ${segments.map((segment) => (
    `${segment.label}: ${formatAdaptiveCurrency(segment.amount, i18n.locale)}, ${formatShare(segment.share, i18n.locale)}`
  )).join("; ")}. ${i18n.text("totalValue", { value: formatAdaptiveCurrency(totalSpend, i18n.locale) })}.${hasVisualSpend ? "" : ` ${i18n.text("noPositiveSpendLanes")}`}`;

  return (
    <article className={`${PANEL_CLASS} ${styles.allocationPanel}`} aria-labelledby="cost-spend-allocation-title">
      <AllocationHeading
        id="cost-spend-allocation-title"
        eyebrow={i18n.text("spendAllocation")}
        title={i18n.text("whereSpendLanded")}
        description={i18n.text("spendAllocationDescription")}
      />
      <div className={styles.totalLine}>
        <span>{i18n.text("totalRecordedSpend")}</span>
        <strong>{formatAdaptiveCurrency(totalSpend, i18n.locale)}</strong>
      </div>
      <div className={`${styles.spendBar} ${TRACK_CLASS}`} role="img" aria-label={chartLabel}>
        {hasVisualSpend ? segments.map((segment) => (
          segment.share > 0 ? (
            <span
              key={segment.id}
              className={`${styles.spendSegment} ${styles[`segment_${segment.id}`]}`}
              style={{ width: `${segment.share * 100}%` }}
              aria-hidden="true"
            />
          ) : null
        )) : null}
      </div>
      <p className={styles.allocationSummary}>
        {hasVisualSpend && leadingSegment
          ? i18n.text("leadingSpendLane", { lane: leadingSegment.label, share: formatShare(leadingSegment.share, i18n.locale) })
          : totalTokens > 0
            ? i18n.text("noPositivePricedSpendLanes")
            : i18n.text("noSpendAllocation")}
      </p>
      <ul className={styles.legend} aria-label={i18n.text("exactSpendAllocationValues")}>
        {segments.map((segment) => (
          <li
            key={segment.id}
            className={`${styles.legendRow} ${CONTROL_FOCUS_CLASS}`}
            tabIndex={0}
          >
            <span className={`${styles.swatch} ${styles[`segment_${segment.id}`]}`} aria-hidden="true" />
            <span className={styles.legendLabel}>{segment.label}</span>
            <strong className={styles.legendValue}>{formatAdaptiveCurrency(segment.amount, i18n.locale)}</strong>
            <span className={styles.legendShare}>{formatShare(segment.share, i18n.locale)}</span>
          </li>
        ))}
      </ul>
    </article>
  );
};

const DimensionMetrics: FunctionComponent<{ row: CostDimensionRow }> = ({ row }) => {
  const i18n = useStatsI18n();
  return (
    <dl className={styles.metrics}>
      <div><dt>{i18n.text("totalCost")}</dt><dd>{formatAdaptiveCurrency(row.amount, i18n.locale)}</dd></div>
      <div><dt>{i18n.text("spendShare")}</dt><dd>{formatShare(row.spendShare, i18n.locale)}</dd></div>
      <div><dt>{i18n.text("tokens")}</dt><dd>{i18n.formatNumber(row.tokens)}</dd></div>
      <div><dt>{i18n.text("tokenShare")}</dt><dd>{formatShare(row.tokenShare, i18n.locale)}</dd></div>
      <div><dt>{i18n.text("calls")}</dt><dd>{i18n.formatNumber(row.calls)}</dd></div>
      <div><dt>{i18n.text("costPerCall")}</dt><dd>{formatAdaptiveCurrency(row.costPerCall, i18n.locale)}</dd></div>
    </dl>
  );
};

const DimensionRow: FunctionComponent<{
  row: GroupedDimensionRow;
  rank: number;
  kind: "model" | "purpose";
}> = ({ row, rank, kind }) => {
  const i18n = useStatsI18n();
  const kindLabel = i18n.text(kind === "model" ? "dimensionModel" : "dimensionPurpose");
  const model = kind === "model" && row.id !== "__other__" ? row as CostModelRow : null;
  const title = row.id === "__other__"
    ? i18n.text("otherCount", { count: i18n.formatNumber(row.groupedRows?.length ?? 0) })
    : kind === "purpose" ? humanizePurpose(row.label, i18n.text("unclassifiedPurpose")) : model?.model ?? i18n.text("modelNotReported");
  const identity = model ? `${model.provider} · ${model.model ?? i18n.text("modelNotReported")}` : null;
  const content = (
    <>
      <div className={styles.rowHeading}>
        <span className={styles.rank} aria-hidden="true">{String(rank).padStart(2, "0")}</span>
        <div className={styles.rowCopy}>
          <h3>{title}</h3>
          {identity ? <p>{identity}</p> : null}
        </div>
      </div>
      <DimensionMetrics row={row} />
    </>
  );

  if (!row.groupedRows) {
    return (
      <li
        className={`${SUBPANEL_CLASS} ${styles.dimensionRow} ${CONTROL_FOCUS_CLASS}`}
        tabIndex={0}
        aria-label={i18n.text("rankedEntry", { title, rank: i18n.formatNumber(rank) })}
      >
        {content}
      </li>
    );
  }

  return (
    <li
      className={`${SUBPANEL_CLASS} ${styles.dimensionRow} ${CONTROL_FOCUS_CLASS}`}
      tabIndex={0}
      aria-label={i18n.text("otherRankedEntries", { kind: kindLabel, count: i18n.formatNumber(row.groupedRows.length), rank: i18n.formatNumber(rank) })}
    >
      {content}
    </li>
  );
};

const DimensionBreakdown: FunctionComponent<{
  title: string;
  description: string;
  rows: CostDimensionRow[];
  kind: "model" | "purpose";
}> = ({ title, description, rows, kind }) => {
  const i18n = useStatsI18n();
  const kindLabel = i18n.text(kind === "model" ? "dimensionModel" : "dimensionPurpose");
  const groupedRows = groupDimensionRows(rows, i18n.text("other"));
  const titleId = `cost-${kind}-breakdown-title`;

  return (
    <section className={`${PANEL_CLASS} ${styles.breakdownPanel}`} aria-labelledby={titleId}>
      <AllocationHeading id={titleId} eyebrow={i18n.text("dimensionRanking", { kind: kindLabel })} title={title} description={description} />
      {rows.length === 0 ? (
        <div className={DASHED_EMPTY_CLASS} role="status">
          {i18n.text("noDimensionCostAllocation", { kind: kindLabel })}
        </div>
      ) : (
        <ol className={styles.dimensionList} aria-label={i18n.text("rankedDimensionCostAllocation", { kind: kindLabel })}>
          {groupedRows.map((row, index) => (
            <DimensionRow key={row.id} row={row} rank={index + 1} kind={kind} />
          ))}
        </ol>
      )}
    </section>
  );
};

export const CostAllocationPanels: FunctionComponent<CostAllocationPanelsProps> = ({
  totalSpend,
  totalTokens,
  tokenSegments,
  spendSegments,
  models,
  purposes,
}) => {
  const i18n = useStatsI18n();
  return (
  <section className={styles.root} aria-label={i18n.text("costAllocation")}>
    <div
      className={`${CHIP_CLASS} ${STATUS_TONE_CLASS[coverageTone(totalSpend, totalTokens)]} ${styles.coverageNotice}`}
      role="status"
    >
      {coverageMessage(totalSpend, totalTokens, i18n)}
    </div>
    <div className={styles.allocationGrid}>
      <TokenAllocation totalTokens={totalTokens} segments={tokenSegments} />
      <SpendAllocation totalSpend={totalSpend} totalTokens={totalTokens} segments={spendSegments} />
    </div>
    <div className={styles.breakdownGrid}>
      <DimensionBreakdown
        title={i18n.text("modelsDrivingSpend")}
        description={i18n.text("modelsDrivingSpendDescription")}
        rows={models}
        kind="model"
      />
      <DimensionBreakdown
        title={i18n.text("purposesDrivingSpend")}
        description={i18n.text("purposesDrivingSpendDescription")}
        rows={purposes}
        kind="purpose"
      />
    </div>
  </section>
  );
};
