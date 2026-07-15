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
import { useStatsI18n, type StatsI18nValue, type StatsMessageKey } from "../../stats-i18n.js";

export type CostLedgerView = "tasks" | "sprints";
export type CostLedgerSortKey = "spend" | "tokens" | "calls" | "costPerCall" | "recency" | "name";
type SortDirection = "asc" | "desc";

export interface CostEntityLedgersProps {
  tasks: CostDetailRow[];
  sprints: CostDetailRow[];
  averageCostPerTask: CostAverage;
  averageCostPerSprint: CostAverage;
}

const SORT_OPTIONS: ReadonlyArray<{ key: CostLedgerSortKey; labelKey: StatsMessageKey }> = [
  { key: "spend", labelKey: "spend" },
  { key: "tokens", labelKey: "tokens" },
  { key: "calls", labelKey: "calls" },
  { key: "costPerCall", labelKey: "costPerCall" },
  { key: "recency", labelKey: "recent" },
  { key: "name", labelKey: "name" },
];

const COVERAGE_COPY: Record<CostCoverageState, { labelKey: StatsMessageKey; detailKey: StatsMessageKey; tone: string }> = {
  complete: { labelKey: "fullCoverage", detailKey: "fullCoverageDetail", tone: STATUS_TONE_CLASS.positive },
  partial: { labelKey: "partialCoverage", detailKey: "partialCoverageDetail", tone: STATUS_TONE_CLASS.warning },
  unpriced: { labelKey: "unpriced", detailKey: "unpricedRowDetail", tone: STATUS_TONE_CLASS.negative },
  unknown: { labelKey: "coverageUnknown", detailKey: "legacyCoverageUnknown", tone: STATUS_TONE_CLASS.neutral },
  unavailable: { labelKey: "noUsage", detailKey: "noPricedInvocation", tone: STATUS_TONE_CLASS.neutral },
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
  const i18n = useStatsI18n();
  const coverage = COVERAGE_COPY[amount.provenance.state];
  const covered = amount.provenance.configuredPricingInvocationCount
    + amount.provenance.providerReportedCostInvocationCount;
  const countDetail = amount.provenance.invocationCount > 0
    ? ` ${i18n.text("callsCovered", { covered: i18n.formatNumber(covered), total: i18n.formatNumber(amount.provenance.invocationCount) })}`
    : "";
  return (
    <span
      className={`${styles.badge} ${coverage.tone}`}
      title={`${i18n.text(coverage.detailKey)}${countDetail}`}
      aria-label={`${i18n.text(coverage.labelKey)}.${countDetail}`.trim()}
    >
      {i18n.text(coverage.labelKey)}
    </span>
  );
};

const Summary: FunctionComponent<{
  total: CostAmount;
  average: CostAverage;
  kind: "task" | "sprint";
  matchCount: number;
}> = ({ total, average, kind, matchCount }) => {
  const i18n = useStatsI18n();
  return (
  <div className={styles.summary} aria-label={i18n.text("costLedgerSummary", { kind: i18n.text(kind) })}>
    <div className={styles.summaryItem}>
      <span>{i18n.text("filteredSpend")}</span>
      <strong>{formatAdaptiveCurrency(total, i18n.locale)}</strong>
      <small>{i18n.plural(kind === "task" ? "matchingTasks" : "matchingSprints", matchCount, { count: i18n.formatNumber(matchCount) })}</small>
    </div>
    <div className={styles.summaryItem}>
      <span>{i18n.text("averageByKind", { kind: i18n.text(kind) })}</span>
      <strong>{formatAdaptiveCurrency(average, i18n.locale)}</strong>
      <small>{i18n.plural(kind === "task" ? "allActiveTasks" : "allActiveSprints", average.entityCount, { count: i18n.formatNumber(average.entityCount) })}</small>
    </div>
    <div className={styles.summaryItem}>
      <span>{i18n.text("pricingProvenance")}</span>
      <CoverageBadge amount={total} />
      <small>{i18n.text(COVERAGE_COPY[total.provenance.state].detailKey)}</small>
    </div>
  </div>
  );
};

const CostRow: FunctionComponent<{ row: CostDetailRow; kind: "task" | "sprint"; rank: number }> = ({ row, kind, rank }) => {
  const i18n = useStatsI18n();
  const kindLabel = i18n.text(kind === "task" ? "taskKind" : "sprintKind");
  const segments = Object.fromEntries(row.tokenSegments.map((segment) => [segment.id, segment.tokens]));
  const status = row.status?.replaceAll("_", " ") ?? i18n.text("statusUnavailable");
  return (
    <article className={styles.row} aria-label={i18n.text("entityCostRow", { label: row.label, kind: kindLabel })} data-cost-row-id={row.id}>
      <div className={styles.identity}>
        <span className={styles.rank} aria-label={i18n.text("rank", { rank: i18n.formatNumber(rank) })}>{rank}</span>
        <div className={styles.identityCopy}>
          <h3>{row.label}</h3>
          <p>{row.secondaryLabel || i18n.text("noSecondaryContext", { kind: kindLabel })} · {row.recency}</p>
          <div className={styles.badges}>
            <span className={`${styles.badge} ${getStatusTone(row.status)}`}>{status}</span>
            <CoverageBadge amount={row.amount} />
          </div>
        </div>
      </div>

      <dl className={styles.metrics}>
        <div><dt>{i18n.text("spend")}</dt><dd>{formatAdaptiveCurrency(row.amount, i18n.locale)}</dd></div>
        <div><dt>{i18n.text("spendShare")}</dt><dd>{formatPercent(row.spendShare * 100, i18n.locale)}</dd></div>
        <div><dt>{i18n.text("tokens")}</dt><dd>{formatTokens(row.tokens, i18n.locale)}</dd></div>
        <div><dt>{i18n.text("calls")}</dt><dd>{i18n.formatNumber(row.calls)}</dd></div>
        <div><dt>{i18n.text("costPerCall")}</dt><dd>{formatAdaptiveCurrency(row.costPerCall, i18n.locale)}</dd></div>
        <div><dt>{i18n.text("lastActivity")}</dt><dd>{row.recency}</dd></div>
      </dl>

      <div className={styles.tokenMix}>
        <div className={styles.tokenMixHeader}>
          <span>{i18n.text("tokenMix")}</span>
          <span>{i18n.text("valueTotal", { value: formatTokens(row.tokens, i18n.locale) })}</span>
        </div>
        <TokenFlowBar
          input={segments.input ?? 0}
          cached={segments.cached_input ?? 0}
          output={segments.output ?? 0}
          reasoning={segments.reasoning ?? 0}
          total={row.tokens}
        />
        <p>
          <span>{i18n.text("inputValue", { value: formatTokens(segments.input ?? 0, i18n.locale) })}</span>
          <span>{i18n.text("cachedValue", { value: formatTokens(segments.cached_input ?? 0, i18n.locale) })}</span>
          <span>{i18n.text("outputValue", { value: formatTokens(segments.output ?? 0, i18n.locale) })}</span>
          <span>{i18n.text("reasoningValue", { value: formatTokens(segments.reasoning ?? 0, i18n.locale) })}</span>
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
  const i18n = useStatsI18n();
  const [activeView, setActiveView] = useState<CostLedgerView>("tasks");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<CostLedgerSortKey>("spend");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const tabRefs = useRef<Record<CostLedgerView, HTMLButtonElement | null>>({ tasks: null, sprints: null });
  const views = [
    { id: "tasks" as const, label: i18n.text("tasks"), rows: tasks },
    { id: "sprints" as const, label: i18n.text("sprints"), rows: sprints },
  ];
  const active = views.find((view) => view.id === activeView) ?? views[0];
  const normalizedQuery = query.trim().toLocaleLowerCase(i18n.locale);
  const filteredRows = useMemo(() => {
    const matches = normalizedQuery
      ? active.rows.filter((row) => [
        row.label,
        row.secondaryLabel ?? "",
        row.status ?? "",
        row.recency,
        i18n.text(COVERAGE_COPY[row.amount.provenance.state].labelKey),
      ].join(" ").toLocaleLowerCase(i18n.locale).includes(normalizedQuery))
      : active.rows;
    return [...matches].sort((left, right) => compareRows(left, right, sortKey, sortDirection));
  }, [active.rows, i18n, normalizedQuery, sortDirection, sortKey]);
  const filteredTotal = useMemo(() => aggregateAmount(filteredRows), [filteredRows]);
  const average = activeView === "tasks" ? averageCostPerTask : averageCostPerSprint;
  const kind = activeView === "tasks" ? "task" : "sprint";
  const activeSearchNoun = i18n.text(activeView === "tasks" ? "tasksSearchNoun" : "sprintsSearchNoun");
  const { visibleItems, visibleCount, hasMore, sentinelRef, scrollContainerRef } = useProgressiveList(filteredRows, {
    initialCount: 12,
    stepCount: 8,
  });
  const queryActive = normalizedQuery.length > 0;
  const sortLabel = i18n.text(SORT_OPTIONS.find((option) => option.key === sortKey)?.labelKey ?? "spend");
  const announcement = i18n.text("costLedgerAnnouncement", { ledger: active.label, filter: queryActive ? i18n.text("filterValue", { value: query.trim() }) : i18n.text("noSearchFilter"), sort: sortLabel, direction: i18n.text(sortDirection === "asc" ? "ascending" : "descending"), visible: i18n.formatNumber(visibleCount), total: i18n.formatNumber(filteredRows.length) });

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
            <p>{i18n.text("costLedgers")}</p>
            <h2 id="cost-entity-ledgers-title">{i18n.text("taskAndSprintSpend")}</h2>
            <span>{i18n.text("costLedgersDescription")}</span>
          </div>
        </div>
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
      </div>

      <div role="tablist" aria-label={i18n.text("costLedgers")} onKeyDown={handleTabKeyDown} className={styles.tabs}>
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
              <span>{i18n.formatNumber(view.rows.length)}</span>
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
            <label htmlFor={`cost-${activeView}-search`}>{i18n.text("searchView", { view: activeSearchNoun })}</label>
            <div>
              <Search aria-hidden="true" />
              <input
                id={`cost-${activeView}-search`}
                type="search"
                value={query}
                onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
                placeholder={i18n.text("searchView", { view: activeSearchNoun })}
                className={`${INPUT_CLASS} ${styles.searchInput}`}
              />
              {queryActive ? (
                <button type="button" onClick={() => setQuery("")} aria-label={i18n.text("clearCostLedgerSearch")} className={CONTROL_FOCUS_CLASS}>
                  <X aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
          <div className={styles.sorts} role="group" aria-label={i18n.text("sortCostLedger", { view: active.label })}>
            {SORT_OPTIONS.map((option) => (
              <SortButton
                key={option.key}
                label={i18n.text(option.labelKey)}
                active={sortKey === option.key}
                direction={sortKey === option.key ? sortDirection : null}
                onClick={() => handleSort(option.key)}
              />
            ))}
          </div>
        </div>

        {active.rows.length > 0 ? <Summary total={filteredTotal} average={average} kind={kind} matchCount={filteredRows.length} /> : null}

        {filteredRows.length > 0 ? (
          <div ref={scrollContainerRef} className={styles.rows} aria-label={i18n.text("costRows", { view: active.label })}>
            {visibleItems.map((row, index) => <CostRow key={row.id} row={row} kind={kind} rank={index + 1} />)}
            {hasMore ? (
              <div ref={sentinelRef} className={styles.sentinel} role="status">
                {i18n.text("showingRows", { visible: i18n.formatNumber(visibleCount), total: i18n.formatNumber(filteredRows.length) })}
              </div>
            ) : null}
          </div>
        ) : active.rows.length === 0 ? (
          <div className={DASHED_EMPTY_CLASS}>{i18n.text(activeView === "tasks" ? "noTasksCostTelemetry" : "noSprintsCostTelemetry")}</div>
        ) : (
          <div className={`${DASHED_EMPTY_CLASS} ${styles.empty}`}>
            <p>{i18n.text(activeView === "tasks" ? "noTasksMatch" : "noSprintsMatch", { query: query.trim() })}</p>
            <button type="button" onClick={() => setQuery("")} className={CONTROL_FOCUS_CLASS}>{i18n.text("clearSearch")}</button>
          </div>
        )}
      </div>
    </section>
  );
};
