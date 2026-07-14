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
import { NUMBER_FORMATTER } from "../../stats-utils.js";
import {
  DASHED_EMPTY_CLASS,
  PANEL_CLASS,
  SUBPANEL_CLASS,
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

function formatShare(share: number): string {
  const percentage = Math.max(0, share) * 100;
  return `${percentage.toLocaleString("en-US", {
    minimumFractionDigits: percentage > 0 && percentage < 0.1 ? 2 : 1,
    maximumFractionDigits: percentage > 0 && percentage < 0.1 ? 2 : 1,
  })}%`;
}

function formatExactTokens(tokens: number): string {
  return `${NUMBER_FORMATTER.format(tokens)} tokens`;
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

function groupDimensionRows(rows: CostDimensionRow[]): GroupedDimensionRow[] {
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
      label: "Other",
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

function humanizePurpose(label: string): string {
  const normalized = label.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return normalized.length > 0
    ? `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`
    : "Unclassified purpose";
}

function coverageMessage(totalSpend: CostAmount, totalTokens: number): string {
  const provenance = totalSpend.provenance;
  if (provenance.invocationCount === 0 && totalTokens === 0) {
    return "Empty window — no calls or token usage were recorded.";
  }
  if (provenance.state === "unpriced") {
    return `Unpriced usage — ${NUMBER_FORMATTER.format(provenance.unpricedInvocationCount)} calls have usage telemetry but no usable price.`;
  }
  if (provenance.state === "partial") {
    return `Partial cost coverage — ${NUMBER_FORMATTER.format(provenance.unpricedInvocationCount)} of ${NUMBER_FORMATTER.format(provenance.invocationCount)} calls remain unpriced; shown spend is a minimum.`;
  }
  if (provenance.state === "unknown") {
    return `Coverage unknown — ${NUMBER_FORMATTER.format(provenance.unknownInvocationCount)} of ${NUMBER_FORMATTER.format(provenance.invocationCount)} calls lack cost-source metadata.`;
  }
  if (provenance.state === "unavailable") {
    return "Spend unavailable — this window does not contain enough cost data to price usage.";
  }
  if (totalSpend.usd === 0) {
    const configuredOnly = provenance.configuredPricingInvocationCount > 0
      && provenance.providerReportedCostInvocationCount === 0;
    return configuredOnly
      ? "Configured free usage — covered calls reconcile to $0.00 and are not unpriced."
      : "Covered zero-cost usage — covered calls reconcile to $0.00 and are not unpriced.";
  }
  return `Complete cost coverage — all ${NUMBER_FORMATTER.format(provenance.invocationCount)} calls have a usable cost source.`;
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
  const byId = new Map(segments.map((segment) => [segment.id, segment]));
  const getTokens = (id: CostTokenSegment["id"]): number => byId.get(id)?.tokens ?? 0;

  return (
    <article className={`${PANEL_CLASS} ${styles.allocationPanel}`} aria-labelledby="cost-token-allocation-title">
      <AllocationHeading
        id="cost-token-allocation-title"
        eyebrow="Token allocation"
        title="What consumed tokens"
        description="Prompt, cache, generation, and reasoning lanes reconcile to the selected snapshot."
      />
      <div className={styles.totalLine}>
        <span>Total token volume</span>
        <strong>{formatExactTokens(totalTokens)}</strong>
      </div>
      <TokenFlowBar
        input={getTokens("input")}
        cached={getTokens("cached_input")}
        output={getTokens("output")}
        reasoning={getTokens("reasoning")}
        total={totalTokens}
      />
      {totalTokens === 0 ? (
        <p className={styles.allocationSummary} role="status">Zero total tokens — no token allocation is available.</p>
      ) : (
        <p className={styles.allocationSummary}>
          {segments[0]?.label ?? "Token lanes"} accounts for {formatShare(segments[0]?.share ?? 0)} of recorded volume.
        </p>
      )}
      <ul className={styles.legend} aria-label="Exact token allocation values">
        {segments.map((segment) => (
          <li key={segment.id} className={styles.legendRow} tabIndex={0}>
            <span className={`${styles.swatch} ${styles[`segment_${segment.id}`]}`} aria-hidden="true" />
            <span className={styles.legendLabel}>{segment.label}</span>
            <strong className={styles.legendValue}>{formatExactTokens(segment.tokens)}</strong>
            <span className={styles.legendShare}>{formatShare(segment.share)}</span>
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
  const hasVisualSpend = totalSpend.usd !== null && totalSpend.usd > 0;
  const leadingSegment = segments.reduce<CostSpendSegment | null>((leader, segment) => (
    leader === null || segment.share > leader.share ? segment : leader
  ), null);
  const chartLabel = hasVisualSpend
    ? `Spend allocation. ${segments.map((segment) => `${segment.label}: ${formatAdaptiveCurrency(segment.amount)}, ${formatShare(segment.share)}`).join("; ")}. Total: ${formatAdaptiveCurrency(totalSpend)}.`
    : `Spend allocation unavailable. Total: ${formatAdaptiveCurrency(totalSpend)}.`;

  return (
    <article className={`${PANEL_CLASS} ${styles.allocationPanel}`} aria-labelledby="cost-spend-allocation-title">
      <AllocationHeading
        id="cost-spend-allocation-title"
        eyebrow="Spend allocation"
        title="Where spend landed"
        description="Token-priced input, output, cache, and provider-reported fallback remain distinct."
      />
      <div className={styles.totalLine}>
        <span>Total recorded spend</span>
        <strong>{formatAdaptiveCurrency(totalSpend)}</strong>
      </div>
      <div className={styles.spendBar} role="img" aria-label={chartLabel}>
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
          ? `${leadingSegment.label} accounts for ${formatShare(leadingSegment.share)} of recorded spend.`
          : totalTokens > 0
            ? "No positive priced spend lanes are available; consult the coverage state above."
            : "No spend allocation is available for this empty window."}
      </p>
      <ul className={styles.legend} aria-label="Exact spend allocation values">
        {segments.map((segment) => (
          <li key={segment.id} className={styles.legendRow} tabIndex={0}>
            <span className={`${styles.swatch} ${styles[`segment_${segment.id}`]}`} aria-hidden="true" />
            <span className={styles.legendLabel}>{segment.label}</span>
            <strong className={styles.legendValue}>{formatAdaptiveCurrency(segment.amount)}</strong>
            <span className={styles.legendShare}>{formatShare(segment.share)}</span>
          </li>
        ))}
      </ul>
    </article>
  );
};

const DimensionMetrics: FunctionComponent<{ row: CostDimensionRow }> = ({ row }) => (
  <dl className={styles.metrics}>
    <div><dt>Total cost</dt><dd>{formatAdaptiveCurrency(row.amount)}</dd></div>
    <div><dt>Spend share</dt><dd>{formatShare(row.spendShare)}</dd></div>
    <div><dt>Tokens</dt><dd>{NUMBER_FORMATTER.format(row.tokens)}</dd></div>
    <div><dt>Token share</dt><dd>{formatShare(row.tokenShare)}</dd></div>
    <div><dt>Calls</dt><dd>{NUMBER_FORMATTER.format(row.calls)}</dd></div>
    <div><dt>Cost / call</dt><dd>{formatAdaptiveCurrency(row.costPerCall)}</dd></div>
  </dl>
);

function modelIdentity(row: CostModelRow): string {
  return `${row.provider} · ${row.model ?? "Model not reported"}`;
}

const DimensionRow: FunctionComponent<{
  row: GroupedDimensionRow;
  rank: number;
  kind: "model" | "purpose";
}> = ({ row, rank, kind }) => {
  const model = kind === "model" && row.id !== "__other__" ? row as CostModelRow : null;
  const title = row.id === "__other__"
    ? `Other (${row.groupedRows?.length ?? 0})`
    : kind === "purpose" ? humanizePurpose(row.label) : model?.model ?? "Model not reported";
  const identity = model ? modelIdentity(model) : null;
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
      <li className={`${SUBPANEL_CLASS} ${styles.dimensionRow}`} tabIndex={0} aria-label={`${title} ranked ${rank}`}>
        {content}
      </li>
    );
  }

  return (
    <li
      className={`${SUBPANEL_CLASS} ${styles.dimensionRow}`}
      tabIndex={0}
      aria-label={`Other ${kind} entries, ${row.groupedRows.length} rows, ranked ${rank}`}
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
  const groupedRows = groupDimensionRows(rows);
  const titleId = `cost-${kind}-breakdown-title`;

  return (
    <section className={`${PANEL_CLASS} ${styles.breakdownPanel}`} aria-labelledby={titleId}>
      <AllocationHeading id={titleId} eyebrow={`${kind} ranking`} title={title} description={description} />
      {rows.length === 0 ? (
        <div className={DASHED_EMPTY_CLASS} role="status">
          No {kind} cost allocation is available for this window.
        </div>
      ) : (
        <ol className={styles.dimensionList} aria-label={`Ranked ${kind} cost allocation`}>
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
}) => (
  <section className={styles.root} aria-label="Cost allocation">
    <div className={styles.coverageNotice} role="status">
      {coverageMessage(totalSpend, totalTokens)}
    </div>
    <div className={styles.allocationGrid}>
      <TokenAllocation totalTokens={totalTokens} segments={tokenSegments} />
      <SpendAllocation totalSpend={totalSpend} totalTokens={totalTokens} segments={spendSegments} />
    </div>
    <div className={styles.breakdownGrid}>
      <DimensionBreakdown
        title="Models driving spend"
        description="Provider and model identities stay separate while cost and token shares remain comparable."
        rows={models}
        kind="model"
      />
      <DimensionBreakdown
        title="Execution purposes driving spend"
        description="Human-readable workflow intent with cost, volume, call count, and per-call context."
        rows={purposes}
        kind="purpose"
      />
    </div>
  </section>
);
