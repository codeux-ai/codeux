import { Fragment, type FunctionComponent } from "preact";
import { useState, useMemo } from "preact/hooks";
import {
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  XCircle,
  Loader2,
  PauseCircle,
  MinusCircle,
  AlertTriangle,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-preact";
import type { ExecutionInvocationRecord } from "../../../../types.js";
import type { SystemSort, SystemSortKey } from "../../hooks/use-system-view-data.js";
import { formatTokens, formatStatsDuration, formatDateTime } from "../../stats-utils.js";
import { DEFAULT_LIST_WINDOW, resolveListWindow } from "../../../../lib/list-window.js";
import {
  LEDGER_ROW_MODERN_CLASS,
  CHIP_CLASS,
  STATUS_TONE_CLASS,
  TAB_IDLE_CLASS,
  TRACK_CLASS,
  getProviderIcon,
} from "../StatsShared.js";
import { InvocationMessagesPanel } from "./InvocationMessagesPanel.js";

export interface InvocationsTableProps {
  invocations: ExecutionInvocationRecord[];
  sort: SystemSort;
  onSortChange: (sort: SystemSort) => void;
  expandedId: string | null;
  onRowExpand: (id: string | null) => void;
  loading?: boolean;
  error?: string | null;
}

export function useInvocationsWindow(
  invocations: ExecutionInvocationRecord[],
  expandedId: string | null,
  initialWindow = DEFAULT_LIST_WINDOW
) {
  const initialCount = typeof initialWindow === "number" ? initialWindow : resolveListWindow(initialWindow, invocations.length);
  const [visibleCount, setVisibleCount] = useState(initialCount);

  const visibleInvocations = useMemo(() => {
    let visible = invocations.slice(0, visibleCount);
    if (expandedId) {
      const isVisible = visible.some((i) => i.id === expandedId);
      if (!isVisible) {
        const expandedItem = invocations.find((i) => i.id === expandedId);
        if (expandedItem) {
          visible = [...visible, expandedItem];
        }
      }
    }
    return visible;
  }, [invocations, visibleCount, expandedId]);

  return {
    visibleInvocations,
    hasMore: visibleCount < invocations.length,
    revealMore: () => setVisibleCount((c: number) => c + (typeof initialWindow === "number" ? initialWindow : 20)),
  };
}

export const InvocationsTable: FunctionComponent<InvocationsTableProps> = ({
  invocations,
  sort,
  onSortChange,
  expandedId,
  onRowExpand,
  loading,
  error,
  }) => {
  const expandedInvocation = expandedId === null
    ? null
    : invocations.find((invocation) => invocation.id === expandedId) ?? null;

  const { visibleInvocations, hasMore, revealMore } = useInvocationsWindow(invocations, expandedId);

  const handleSort = (key: SystemSortKey) => {
    if (sort.key === key) {
      onSortChange({ key, dir: sort.dir === "asc" ? "desc" : "asc" });
    } else {
      onSortChange({ key, dir: "desc" });
    }
  };

  const renderSortIcon = (key: SystemSortKey) => {
    if (sort.key !== key) return <ArrowUpDown aria-label="sortable" className="ml-1 h-3 w-3" />;
    return sort.dir === "asc" ? (
      <ArrowUp aria-label="sorted ascending" className="ml-1 h-3 w-3 text-[color:var(--stats-signal-text)]" />
    ) : (
      <ArrowDown aria-label="sorted descending" className="ml-1 h-3 w-3 text-[color:var(--stats-signal-text)]" />
    );
  };

  const renderStatusChip = (status: string) => {
    switch (status) {
      case "running":
        return (
          <div className={`${CHIP_CLASS} flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${STATUS_TONE_CLASS.signal}`}>
            <div className="h-2 w-2 rounded-full bg-[color:var(--stats-signal-text)]" />
            <Loader2 className="h-3 w-3 animate-spin" />
            Running
          </div>
        );
      case "completed":
        return (
          <div className={`${CHIP_CLASS} flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${STATUS_TONE_CLASS.positive}`}>
            <div className="h-2 w-2 rounded-full bg-[color:var(--stats-positive-text)]" />
            <CheckCircle2 className="h-3 w-3" />
            Completed
          </div>
        );
      case "failed":
        return (
          <div className={`${CHIP_CLASS} flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${STATUS_TONE_CLASS.negative}`}>
            <div className="h-2 w-2 rounded-full bg-[color:var(--stats-negative-text)]" />
            <XCircle className="h-3 w-3" />
            Failed
          </div>
        );
      case "cancelled":
        return (
          <div className={`${CHIP_CLASS} flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${STATUS_TONE_CLASS.neutral}`}>
            <div className="h-2 w-2 rounded-full bg-[color:var(--stats-detail-color)]" />
            <MinusCircle className="h-3 w-3" />
            Cancelled
          </div>
        );
      case "paused":
        return (
          <div className={`${CHIP_CLASS} flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${STATUS_TONE_CLASS.warning}`}>
            <div className="h-2 w-2 rounded-full bg-[color:var(--stats-warning-text)]" />
            <PauseCircle className="h-3 w-3" />
            Paused
          </div>
        );
      default:
        return (
          <div className={`${CHIP_CLASS} px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[color:var(--stats-label-color)]`}>
            {status}
          </div>
        );
    }
  };

  const formatLabel = (value: string | null | undefined): string => {
    const label = (value || "unknown").replace(/[_-]/g, " ").trim();
    return label.length > 0 ? label : "unknown";
  };

  const cellClass = "block px-3 py-2 align-middle lg:table-cell lg:px-2 lg:py-3";
  const mobileLabelClass = "mb-1 text-[9px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)] lg:hidden";

  if (loading) {
    return (
      <div role="status" aria-label="Loading invocations" className="space-y-3">
        <span className="sr-only" aria-live="polite">Loading invocations</span>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`${LEDGER_ROW_MODERN_CLASS} h-20 motion-safe:animate-pulse ${TRACK_CLASS}`} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className={`rounded-2xl px-4 py-4 text-sm ${STATUS_TONE_CLASS.negative}`}>
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <div className="font-bold">Failed to load invocation records</div>
            <div className="mt-1 break-words">{error}</div>
          </div>
        </div>
      </div>
    );
  }

  if (invocations.length === 0) {
    return (
      <div role="status" aria-live="polite" aria-label="Empty invocations table" className="flex flex-col items-center justify-center py-20 text-[color:var(--stats-detail-color)]">
        <AlertTriangle className="mb-4 h-10 w-10 opacity-20" />
        <div className="text-sm font-medium">No invocations match the current filters</div>
      </div>
    );
  }

  return (
    <div className="min-w-0 overflow-visible">
      <table className="block w-full border-separate border-spacing-y-2 lg:table">
        <thead className="sticky top-0 z-10 hidden bg-[color:var(--stats-surface-panel)] backdrop-blur-sm lg:table-header-group">
          <tr className="text-left text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--stats-label-color)]">
            <th id="invocations-time" scope="col" className="pb-2 pl-6">
              <button
                type="button"
                onClick={() => handleSort("startedAt")}
                className={`flex items-center ${TAB_IDLE_CLASS}`}
              >
                Time {renderSortIcon("startedAt")}
              </button>
            </th>
            <th id="invocations-status" scope="col" className="pb-2">Status</th>
            <th id="invocations-type" scope="col" className="pb-2">Type</th>
            <th id="invocations-model" scope="col" className="pb-2">Model</th>
            <th id="invocations-input" scope="col" className="pb-2">
              <button
                type="button"
                onClick={() => handleSort("inputTokens")}
                className={`flex items-center ${TAB_IDLE_CLASS}`}
              >
                In {renderSortIcon("inputTokens")}
              </button>
            </th>
            <th id="invocations-output" scope="col" className="pb-2">
              <button
                type="button"
                onClick={() => handleSort("outputTokens")}
                className={`flex items-center ${TAB_IDLE_CLASS}`}
              >
                Out {renderSortIcon("outputTokens")}
              </button>
            </th>
            <th id="invocations-cached" scope="col" className="pb-2">Cached</th>
            <th id="invocations-total" scope="col" className="pb-2">
              <button
                type="button"
                onClick={() => handleSort("totalTokens")}
                className={`flex items-center ${TAB_IDLE_CLASS}`}
              >
                Total {renderSortIcon("totalTokens")}
              </button>
            </th>
            <th id="invocations-duration" scope="col" className="pb-2">
              <button
                type="button"
                onClick={() => handleSort("durationMs")}
                className={`flex items-center ${TAB_IDLE_CLASS}`}
              >
                Avg Duration {renderSortIcon("durationMs")}
              </button>
            </th>
            <th id="invocations-context" scope="col" className="pb-2">Context</th>
            <th id="invocations-expand" scope="col" className="pb-2 pr-6 text-right">Expand</th>
          </tr>
        </thead>
        <tbody className="block lg:table-row-group">
          {visibleInvocations.map((invocation) => {
            const isExpanded = expandedId === invocation.id;
            const { icon: ProviderIcon, bg: providerBg, text: providerText } = getProviderIcon(invocation.provider);
            const duration = invocation.finishedAt
              ? formatStatsDuration(Date.parse(invocation.finishedAt) - Date.parse(invocation.startedAt))
              : "running";

            return (
              <Fragment key={invocation.id}>
                <tr
                  key={invocation.id}
                  className={`${LEDGER_ROW_MODERN_CLASS} block overflow-hidden lg:table-row ${
                    invocation.status === "running"
                      ? "border-l-2 border-l-[color:var(--stats-signal-text)]"
                      : invocation.status === "failed"
                        ? "border-l-2 border-l-[color:var(--stats-negative-text)]"
                        : ""
                  }`}
                >
                  <td headers="invocations-time" className={`${cellClass} lg:pl-6`}>
                    <div className={mobileLabelClass}>Time</div>
                    <div className="text-[11px] font-mono text-[color:var(--stats-label-color)]">{formatDateTime(invocation.startedAt)}</div>
                  </td>
                  <td headers="invocations-status" className={cellClass}>
                    <div className={mobileLabelClass}>Status</div>
                    {renderStatusChip(invocation.status)}
                    {invocation.status === "failed" && (invocation.lastErrorMessage || invocation.errorMessage) ? (
                      <div className="mt-2 flex min-w-0 items-start gap-1.5 text-[11px] text-[color:var(--stats-negative-text)]">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        <span className="min-w-0 break-words [overflow-wrap:anywhere]">{invocation.lastErrorMessage || invocation.errorMessage}</span>
                      </div>
                    ) : null}
                  </td>
                  <td headers="invocations-type" className={cellClass}>
                    <div className={mobileLabelClass}>Type</div>
                    <div className={`${CHIP_CLASS} max-w-full px-2 py-0.5 text-[10px] font-medium capitalize text-[color:var(--stats-detail-color)]`}>
                      <span className="block truncate">{formatLabel(invocation.type)}</span>
                    </div>
                  </td>
                  <td headers="invocations-model" className={cellClass}>
                    <div className={mobileLabelClass}>Model</div>
                    <div className="flex min-w-0 items-center gap-2 text-[11px] text-[color:var(--stats-detail-color)]">
                      <div className={`shrink-0 rounded-lg p-1.5 ${providerBg} ${providerText}`}>
                        <ProviderIcon className="h-3 w-3" strokeWidth={2.5} />
                      </div>
                      <span className="min-w-0 truncate">
                        <span className="font-bold capitalize text-[color:var(--stats-value-color)]">{formatLabel(invocation.provider)}</span>
                        <span className="mx-1 text-[color:var(--stats-label-color)]">·</span>
                        {invocation.model || "—"}
                      </span>
                    </div>
                  </td>
                  <td headers="invocations-input" className={cellClass}>
                    <div className={mobileLabelClass}>In</div>
                    <div className="text-[11px] text-[color:var(--stats-detail-color)]">{formatTokens(invocation.inputTokens ?? 0)}</div>
                  </td>
                  <td headers="invocations-output" className={cellClass}>
                    <div className={mobileLabelClass}>Out</div>
                    <div className="text-[11px] text-[color:var(--stats-detail-color)]">{formatTokens(invocation.outputTokens ?? 0)}</div>
                  </td>
                  <td headers="invocations-cached" className={cellClass}>
                    <div className={mobileLabelClass}>Cached</div>
                    <div className="text-[11px] text-[color:var(--stats-detail-color)]">{formatTokens(invocation.cachedInputTokens ?? 0)}</div>
                  </td>
                  <td headers="invocations-total" className={cellClass}>
                    <div className={mobileLabelClass}>Total</div>
                    <div className="text-[11px] font-bold text-[color:var(--stats-value-color)]">{formatTokens(invocation.totalTokens ?? 0)}</div>
                  </td>
                  <td headers="invocations-duration" className={cellClass}>
                    <div className={mobileLabelClass}>Duration</div>
                    <div className={`text-[11px] ${invocation.finishedAt ? "text-[color:var(--stats-detail-color)]" : "text-[color:var(--stats-signal-text)]"}`}>
                      {duration}
                    </div>
                  </td>
                  <td headers="invocations-context" className={cellClass}>
                    <div className={mobileLabelClass}>Context</div>
                    <div className="flex min-w-0 flex-wrap gap-1">
                      {invocation.sprintNumber !== null && invocation.sprintNumber !== undefined ? (
                        <div className={`${CHIP_CLASS} px-1.5 py-0.5 text-[9px] font-bold text-[color:var(--stats-label-color)]`}>
                          S{invocation.sprintNumber}
                        </div>
                      ) : null}
                      {invocation.taskKey !== null && invocation.taskKey !== undefined ? (
                        <div className={`${CHIP_CLASS} px-1.5 py-0.5 text-[9px] font-bold text-[color:var(--stats-label-color)]`}>
                          {invocation.taskKey}
                        </div>
                      ) : null}
                      {invocation.sprintNumber == null && invocation.taskKey == null ? (
                        <span className="text-[11px] text-[color:var(--stats-label-color)]">—</span>
                      ) : null}
                    </div>
                  </td>
                  <td headers="invocations-expand" className={`${cellClass} lg:pr-6 lg:text-right`}>
                    <div className={mobileLabelClass}>Messages</div>
                    <button
                      type="button"
                      onClick={() => onRowExpand(isExpanded ? null : invocation.id)}
                      aria-expanded={isExpanded}
                      aria-controls={`invocation-messages-${invocation.id}`}
                      aria-label={isExpanded ? `Collapse invocation ${invocation.id}` : `Expand invocation ${invocation.id}`}
                      className={`rounded-full p-2 transition-colors hover:bg-[color:var(--stats-surface-chip-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--stats-focus-ring)] ${
                        isExpanded ? "text-[color:var(--stats-signal-text)]" : "text-[color:var(--stats-label-color)]"
                      }`}
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </td>
                </tr>

                {/* Expanded Detail Row */}
                {isExpanded && expandedInvocation ? (
                  <tr key={`${invocation.id}-detail`} className="block lg:table-row">
                    <td colSpan={11} className="block px-0 pb-2 lg:table-cell lg:px-6">
                      <InvocationMessagesPanel invocation={expandedInvocation} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {hasMore && (
        <div className="mt-4 flex justify-center pb-4">
          <button
            type="button"
            onClick={revealMore}
            className="rounded-full bg-[color:var(--stats-surface-chip)] px-4 py-2 text-xs font-bold text-[color:var(--stats-detail-color)] transition-colors hover:bg-[color:var(--stats-surface-chip-hover)]"
          >
            Show more invocations
          </button>
        </div>
      )}
    </div>
  );
};
