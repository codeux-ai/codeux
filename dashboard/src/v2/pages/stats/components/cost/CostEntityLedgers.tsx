import type { FunctionComponent, JSX } from "preact";
import { useMemo, useRef, useState } from "preact/hooks";
import { Coins, Search, X } from "lucide-preact";
import { useProgressiveList } from "../../../../../hooks/use-progressive-list.js";
import { formatPercent, formatTokens } from "../../stats-utils.js";
import {
  type CostAmount,
  type CostAverage,
  type CostCoverageState,
  type CostDetailRow,
  formatAdaptiveCurrency,
} from "../../cost-insights.js";
import {
  CONTROL_FOCUS_CLASS,
  DASHED_EMPTY_CLASS,
  INPUT_CLASS,
  PANEL_CLASS,
  STATUS_TONE_CLASS,
  SortButton,
  TAB_ACTIVE_CLASS,
  TAB_IDLE_CLASS,
  TokenFlowBar,
} from "../StatsShared.js";
import styles from "./CostEntityLedgers.module.css";

export type CostLedgerView = "tasks" | "sprints";
export type CostLedgerSortKey = "spend" | "tokens" | "calls" | "costPerCall" | "recency" | "name";
type SortDirection = "asc" | "desc";

export interface CostEntityLedgersProps {
  tasks: CostDetailRow[];
  sprints: CostDetailRow[];
  averageCostPerTask: CostAverage;
  averageCostPerSprint: CostAverage;
}

const SORT_OPTIONS: ReadonlyArray<{ key: CostLedgerSortKey; label: string }> = [
  { key: "spend", label: "Spend" },
  { key: "tokens", label: "Tokens" },
  { key: "calls", label: "Calls" },
  { key: "costPerCall", label: "Cost / call" },
  { key: "recency", label: "Recent" },
  { key: "name", label: "Name" },
];

const COVERAGE_COPY: Record<CostCoverageState, { label: string; detail: string; tone: string }> = {
  complete: {
    label: "Full coverage",
    detail: "Every invocation has configured or provider-reported pricing.",
    tone: STATUS_TONE_CLASS.positive,
  },
  partial: {
    label: "Partial coverage",
    detail: "Spend excludes one or more unpriced invocations.",
    tone: STATUS_TONE_CLASS.warning,
  },
  unpriced: {
    label: "Unpriced",
    detail: "No invocation in this row has usable pricing.",
    tone: STATUS_TONE_CLASS.negative,
  },
  unknown: {
    label: "Coverage unknown",
    detail: "Legacy telemetry does not contain pricing coverage.",
    tone: STATUS_TONE_CLASS.neutral,
  },
  unavailable: {
    label: "No usage",
    detail: "No priced invocation is available for this row.",
    tone: STATUS_TONE_CLASS.neutral,
  },
};

function getStatusTone(status: string | null): string {
  const normalized = status?.toLowerCase() ?? "";
  if (/complete|done|merged/.test(normalized)) return STATUS_TONE_CLASS.positive;
  if (/fail|error|blocked/.test(normalized)) return STATUS_TONE_CLASS.negative;
  if (/running|progress|active/.test(normalized)) return STATUS_TONE_CLASS.signal;
  if (/cancel|paused/.test(normalized)) return STATUS_TONE_CLASS.warning;
  return STATUS_TONE_CLASS.neutral;
}

function aggregateAmount(rows: CostDetailRow[]): CostAmount {
  if (rows.length === 0) {
    return {
      usd: null,
      provenance: {
        state: "unavailable",
        invocationCount: 0,
        configuredPricingInvocationCount: 0,
        providerReportedCostInvocationCount: 0,
        unpricedInvocationCount: 0,
        unknownInvocationCount: 0,
      },
    };
  }

  const totals = rows.reduce((result, row) => ({
    usd: result.usd + (row.amount.usd ?? 0),
    invocationCount: result.invocationCount + row.amount.provenance.invocationCount,
    configured: result.configured + row.amount.provenance.configuredPricingInvocationCount,
    providerReported: result.providerReported + row.amount.provenance.providerReportedCostInvocationCount,
    unpriced: result.unpriced + row.amount.provenance.unpricedInvocationCount,
    unknown: result.unknown + row.amount.provenance.unknownInvocationCount,
  }), { usd: 0, invocationCount: 0, configured: 0, providerReported: 0, unpriced: 0, unknown: 0 });
  const covered = totals.configured + totals.providerReported;
  let state: CostCoverageState = "unavailable";
  if (totals.invocationCount > 0) {
    if (totals.unknown > 0) state = "unknown";
    else if (covered === 0) state = "unpriced";
    else if (totals.unpriced > 0) state = "partial";
    else state = "complete";
  }

  return {
    usd: totals.usd,
    provenance: {
      state,
      invocationCount: totals.invocationCount,
      configuredPricingInvocationCount: totals.configured,
      providerReportedCostInvocationCount: totals.providerReported,
      unpricedInvocationCount: totals.unpriced,
      unknownInvocationCount: totals.unknown,
    },
  };
}

function timestamp(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function numericSortValue(row: CostDetailRow, key: Exclude<CostLedgerSortKey, "name">): number {
  if (key === "spend") return row.amount.usd ?? Number.NEGATIVE_INFINITY;
  if (key === "tokens") return row.tokens;
  if (key === "calls") return row.calls;
  if (key === "costPerCall") return row.costPerCall.usd ?? Number.NEGATIVE_INFINITY;
  return timestamp(row.lastActivityAt);
}

function stableCompare(left: CostDetailRow, right: CostDetailRow): number {
  const spend = (right.amount.usd ?? 0) - (left.amount.usd ?? 0);
  if (spend !== 0) return spend;
  if (right.tokens !== left.tokens) return right.tokens - left.tokens;
  if (right.calls !== left.calls) return right.calls - left.calls;
  const label = left.label.localeCompare(right.label, "en");
  return label || left.id.localeCompare(right.id, "en");
}

function compareRows(
  left: CostDetailRow,
  right: CostDetailRow,
  key: CostLedgerSortKey,
  direction: SortDirection,
): number {
  let primary = key === "name"
    ? left.label.localeCompare(right.label, "en")
    : numericSortValue(left, key) - numericSortValue(right, key);
  if (!Number.isFinite(primary)) {
    primary = primary === Number.POSITIVE_INFINITY ? 1 : primary === Number.NEGATIVE_INFINITY ? -1 : 0;
  }
  if (primary !== 0) return direction === "asc" ? primary : -primary;
  return stableCompare(left, right);
}

const CoverageBadge: FunctionComponent<{ amount: CostAmount }> = ({ amount }) => {
  const coverage = COVERAGE_COPY[amount.provenance.state];
  const covered = amount.provenance.configuredPricingInvocationCount
    + amount.provenance.providerReportedCostInvocationCount;
  const countDetail = amount.provenance.invocationCount > 0
    ? ` ${covered.toLocaleString()} of ${amount.provenance.invocationCount.toLocaleString()} calls covered.`
    : "";
  return (
    <span
      className={`${styles.badge} ${coverage.tone}`}
      title={`${coverage.detail}${countDetail}`}
      aria-label={`${coverage.label}.${countDetail}`.trim()}
    >
      {coverage.label}
    </span>
  );
};

const Summary: FunctionComponent<{
  total: CostAmount;
  average: CostAverage;
  kind: "task" | "sprint";
  matchCount: number;
}> = ({ total, average, kind, matchCount }) => (
  <div className={styles.summary} aria-label={`${kind} cost ledger summary`}>
    <div className={styles.summaryItem}>
      <span>Filtered spend</span>
      <strong>{formatAdaptiveCurrency(total)}</strong>
      <small>{matchCount.toLocaleString()} matching {matchCount === 1 ? kind : `${kind}s`}</small>
    </div>
    <div className={styles.summaryItem}>
      <span>Average / {kind}</span>
      <strong>{formatAdaptiveCurrency(average)}</strong>
      <small>All {average.entityCount.toLocaleString()} active {average.entityCount === 1 ? kind : `${kind}s`}</small>
    </div>
    <div className={styles.summaryItem}>
      <span>Pricing provenance</span>
      <CoverageBadge amount={total} />
      <small>{COVERAGE_COPY[total.provenance.state].detail}</small>
    </div>
  </div>
);

const CostRow: FunctionComponent<{ row: CostDetailRow; kind: "task" | "sprint"; rank: number }> = ({ row, kind, rank }) => {
  const segments = Object.fromEntries(row.tokenSegments.map((segment) => [segment.id, segment.tokens]));
  const status = row.status?.replaceAll("_", " ") ?? "Status unavailable";
  return (
    <article className={styles.row} aria-label={`${row.label} ${kind} cost row`} data-cost-row-id={row.id}>
      <div className={styles.identity}>
        <span className={styles.rank} aria-label={`Rank ${rank}`}>{rank}</span>
        <div className={styles.identityCopy}>
          <h3>{row.label}</h3>
          <p>{row.secondaryLabel || `No secondary ${kind} context`} · {row.recency}</p>
          <div className={styles.badges}>
            <span className={`${styles.badge} ${getStatusTone(row.status)}`}>{status}</span>
            <CoverageBadge amount={row.amount} />
          </div>
        </div>
      </div>

      <dl className={styles.metrics}>
        <div><dt>Spend</dt><dd>{formatAdaptiveCurrency(row.amount)}</dd></div>
        <div><dt>Spend share</dt><dd>{formatPercent(row.spendShare * 100)}</dd></div>
        <div><dt>Tokens</dt><dd>{formatTokens(row.tokens)}</dd></div>
        <div><dt>Calls</dt><dd>{row.calls.toLocaleString()}</dd></div>
        <div><dt>Cost / call</dt><dd>{formatAdaptiveCurrency(row.costPerCall)}</dd></div>
        <div><dt>Last activity</dt><dd>{row.recency}</dd></div>
      </dl>

      <div className={styles.tokenMix}>
        <div className={styles.tokenMixHeader}>
          <span>Token mix</span>
          <span>{formatTokens(row.tokens)} total</span>
        </div>
        <TokenFlowBar
          input={segments.input ?? 0}
          cached={segments.cached_input ?? 0}
          output={segments.output ?? 0}
          reasoning={segments.reasoning ?? 0}
          total={row.tokens}
        />
        <p>
          <span>Input {formatTokens(segments.input ?? 0)}</span>
          <span>Cached {formatTokens(segments.cached_input ?? 0)}</span>
          <span>Output {formatTokens(segments.output ?? 0)}</span>
          <span>Reasoning {formatTokens(segments.reasoning ?? 0)}</span>
        </p>
      </div>
    </article>
  );
};

export const CostEntityLedgers: FunctionComponent<CostEntityLedgersProps> = ({
  tasks,
  sprints,
  averageCostPerTask,
  averageCostPerSprint,
}) => {
  const [activeView, setActiveView] = useState<CostLedgerView>("tasks");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<CostLedgerSortKey>("spend");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const tabRefs = useRef<Record<CostLedgerView, HTMLButtonElement | null>>({ tasks: null, sprints: null });
  const views = [
    { id: "tasks" as const, label: "Tasks", rows: tasks },
    { id: "sprints" as const, label: "Sprints", rows: sprints },
  ];
  const active = views.find((view) => view.id === activeView) ?? views[0];
  const normalizedQuery = query.trim().toLocaleLowerCase("en");
  const filteredRows = useMemo(() => {
    const matches = normalizedQuery
      ? active.rows.filter((row) => [
        row.label,
        row.secondaryLabel ?? "",
        row.status ?? "",
        row.recency,
        COVERAGE_COPY[row.amount.provenance.state].label,
      ].join(" ").toLocaleLowerCase("en").includes(normalizedQuery))
      : active.rows;
    return [...matches].sort((left, right) => compareRows(left, right, sortKey, sortDirection));
  }, [active.rows, normalizedQuery, sortDirection, sortKey]);
  const filteredTotal = useMemo(() => aggregateAmount(filteredRows), [filteredRows]);
  const average = activeView === "tasks" ? averageCostPerTask : averageCostPerSprint;
  const kind = activeView === "tasks" ? "task" : "sprint";
  const { visibleItems, visibleCount, hasMore, sentinelRef, scrollContainerRef } = useProgressiveList(filteredRows, {
    initialCount: 12,
    stepCount: 8,
  });
  const queryActive = normalizedQuery.length > 0;
  const sortLabel = SORT_OPTIONS.find((option) => option.key === sortKey)?.label ?? sortKey;
  const announcement = `${active.label} cost ledger. ${queryActive ? `Filter ${query.trim()}.` : "No search filter."} Sorted by ${sortLabel} ${sortDirection === "asc" ? "ascending" : "descending"}. ${visibleCount.toLocaleString()} of ${filteredRows.length.toLocaleString()} matching rows displayed.`;

  const selectView = (view: CostLedgerView) => {
    setActiveView(view);
    setQuery("");
  };
  const focusView = (view: CostLedgerView) => {
    selectView(view);
    tabRefs.current[view]?.focus();
  };
  const handleTabKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") return focusView("tasks");
    if (event.key === "End") return focusView("sprints");
    focusView(activeView === "tasks" ? "sprints" : "tasks");
  };
  const handleSort = (key: CostLedgerSortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => current === "desc" ? "asc" : "desc");
      return;
    }
    setSortKey(key);
    setSortDirection(key === "name" ? "asc" : "desc");
  };

  return (
    <section className={`${PANEL_CLASS} ${styles.ledger}`} aria-labelledby="cost-entity-ledgers-title">
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <span className={styles.icon}><Coins aria-hidden="true" /></span>
          <div>
            <p>Cost ledgers</p>
            <h2 id="cost-entity-ledgers-title">Task and sprint spend</h2>
            <span>Find expensive work and audit pricing coverage without splitting conceptual sprint reruns.</span>
          </div>
        </div>
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
      </div>

      <div role="tablist" aria-label="Cost ledgers" onKeyDown={handleTabKeyDown} className={styles.tabs}>
        {views.map((view) => {
          const selected = view.id === activeView;
          return (
            <button
              key={view.id}
              id={`cost-ledger-tab-${view.id}`}
              ref={(node) => { tabRefs.current[view.id] = node; }}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`cost-ledger-panel-${view.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectView(view.id)}
              className={`${styles.tab} ${CONTROL_FOCUS_CLASS} ${selected ? TAB_ACTIVE_CLASS : TAB_IDLE_CLASS}`}
            >
              <span>{view.label}</span>
              <span>{view.rows.length.toLocaleString()}</span>
            </button>
          );
        })}
      </div>

      <div
        id={`cost-ledger-panel-${activeView}`}
        role="tabpanel"
        aria-labelledby={`cost-ledger-tab-${activeView}`}
        tabIndex={0}
        className={`${styles.panel} ${CONTROL_FOCUS_CLASS}`}
      >
        <div className={styles.controls}>
          <div className={styles.search}>
            <label htmlFor={`cost-${activeView}-search`}>Search {activeView}</label>
            <div>
              <Search aria-hidden="true" />
              <input
                id={`cost-${activeView}-search`}
                type="search"
                value={query}
                onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
                placeholder={`Search ${activeView}`}
                className={`${INPUT_CLASS} ${styles.searchInput}`}
              />
              {queryActive ? (
                <button type="button" onClick={() => setQuery("")} aria-label="Clear cost ledger search" className={CONTROL_FOCUS_CLASS}>
                  <X aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
          <div className={styles.sorts} role="group" aria-label={`Sort ${activeView} cost ledger`}>
            {SORT_OPTIONS.map((option) => (
              <SortButton
                key={option.key}
                label={option.label}
                active={sortKey === option.key}
                direction={sortKey === option.key ? sortDirection : null}
                onClick={() => handleSort(option.key)}
              />
            ))}
          </div>
        </div>

        {active.rows.length > 0 ? <Summary total={filteredTotal} average={average} kind={kind} matchCount={filteredRows.length} /> : null}

        {filteredRows.length > 0 ? (
          <div ref={scrollContainerRef} className={styles.rows} aria-label={`${active.label} cost rows`}>
            {visibleItems.map((row, index) => <CostRow key={row.id} row={row} kind={kind} rank={index + 1} />)}
            {hasMore ? (
              <div ref={sentinelRef} className={styles.sentinel} role="status">
                Showing {visibleCount.toLocaleString()} of {filteredRows.length.toLocaleString()} rows. More rows load as you scroll.
              </div>
            ) : null}
          </div>
        ) : active.rows.length === 0 ? (
          <div className={DASHED_EMPTY_CLASS}>No {activeView} have cost telemetry in this window.</div>
        ) : (
          <div className={`${DASHED_EMPTY_CLASS} ${styles.empty}`}>
            <p>No {activeView} match “{query.trim()}”.</p>
            <button type="button" onClick={() => setQuery("")} className={CONTROL_FOCUS_CLASS}>Clear search</button>
          </div>
        )}
      </div>
    </section>
  );
};
