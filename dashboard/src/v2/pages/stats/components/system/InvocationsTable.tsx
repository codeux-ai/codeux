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
  Inbox,
  type LucideIcon,
} from "lucide-preact";
import type { ExecutionInvocationRecord } from "../../../../types.js";
import type { SystemSort, SystemSortKey } from "../../hooks/use-system-view-data.js";
import { formatTokens, formatStatsDuration, formatDateTime } from "../../stats-utils.js";
import { DEFAULT_LIST_WINDOW, resolveListWindow } from "../../../../lib/list-window.js";
import {
  CONTROL_FOCUS_CLASS,
  CHIP_CLASS,
  STATUS_TONE_CLASS,
  SUBPANEL_CLASS,
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

const SystemFeedbackState: FunctionComponent<{
  icon: LucideIcon;
  title: string;
  detail: string;
  role: "status" | "alert";
  ariaLabel: string;
  tone?: keyof typeof STATUS_TONE_CLASS;
  busy?: boolean;
  children?: import("preact").ComponentChildren;
}> = ({ icon: Icon, title, detail, role, ariaLabel, tone = "neutral", busy, children }) => (
  <div
    role={role}
    aria-label={ariaLabel}
    aria-live={role === "status" ? "polite" : undefined}
    aria-busy={busy ? "true" : undefined}
    className={`${SUBPANEL_CLASS} flex min-w-0 flex-col gap-4 p-4 text-left sm:flex-row sm:items-start`}
  >
    <div className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--stats-chip-radius)] ${STATUS_TONE_CLASS[tone]}`}>
      <Icon className={busy ? "h-4 w-4 motion-safe:animate-spin" : "h-4 w-4"} strokeWidth={2.2} aria-hidden="true" />
    </div>
    <div className="min-w-0 flex-1">
      <div className="text-sm font-bold text-[color:var(--stats-value-color)]">{title}</div>
      <div className="mt-1 text-sm leading-relaxed text-[color:var(--stats-detail-color)]">{detail}</div>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  </div>
);

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

  const getAriaSort = (key: SystemSortKey): "ascending" | "descending" | undefined => {
    if (sort.key !== key) {
      return undefined;
    }

    return sort.dir === "asc" ? "ascending" : "descending";
  };

  const getSortButtonLabel = (label: string, key: SystemSortKey): string => {
    if (sort.key !== key) {
      return `Sort invocations by ${label}`;
    }

    return `Sort invocations by ${label}, currently sorted ${sort.dir === "asc" ? "ascending" : "descending"}`;
  };

  const renderSortIcon = (key: SystemSortKey) => {
    if (sort.key !== key) return <ArrowUpDown aria-hidden="true" className="h-3.5 w-3.5" />;
    return sort.dir === "asc" ? (
      <ArrowUp aria-hidden="true" className="h-3.5 w-3.5 text-[color:var(--stats-signal-text)]" />
    ) : (
      <ArrowDown aria-hidden="true" className="h-3.5 w-3.5 text-[color:var(--stats-signal-text)]" />
    );
  };

  const statusChipClass = `inline-flex max-w-full items-center gap-1.5 rounded-[var(--stats-chip-radius)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.13em] ${CONTROL_FOCUS_CLASS}`;
  const statusDotClass = "h-1.5 w-1.5 shrink-0 rounded-full";

  const renderStatusChip = (status: ExecutionInvocationRecord["status"]) => {
    switch (status) {
      case "running":
        return (
          <div className={`${CHIP_CLASS} ${statusChipClass} ${STATUS_TONE_CLASS.signal}`}>
            <div className={`${statusDotClass} bg-[color:var(--stats-signal-text)]`} />
            <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
            Running
          </div>
        );
      case "completed":
        return (
          <div className={`${CHIP_CLASS} ${statusChipClass} ${STATUS_TONE_CLASS.positive}`}>
            <div className={`${statusDotClass} bg-[color:var(--stats-positive-text)]`} />
            <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
            Completed
          </div>
        );
      case "failed":
        return (
          <div className={`${CHIP_CLASS} ${statusChipClass} ${STATUS_TONE_CLASS.negative}`}>
            <div className={`${statusDotClass} bg-[color:var(--stats-negative-text)]`} />
            <XCircle aria-hidden="true" className="h-3.5 w-3.5" />
            Failed
          </div>
        );
      case "cancelled":
        return (
          <div className={`${CHIP_CLASS} ${statusChipClass} ${STATUS_TONE_CLASS.neutral}`}>
            <div className={`${statusDotClass} bg-[color:var(--stats-detail-color)]`} />
            <MinusCircle aria-hidden="true" className="h-3.5 w-3.5" />
            Cancelled
          </div>
        );
      case "paused":
        return (
          <div className={`${CHIP_CLASS} ${statusChipClass} ${STATUS_TONE_CLASS.warning}`}>
            <div className={`${statusDotClass} bg-[color:var(--stats-warning-text)]`} />
            <PauseCircle aria-hidden="true" className="h-3.5 w-3.5" />
            Paused
          </div>
        );
    }
  };

  const formatLabel = (value: string | null | undefined): string => {
    const label = (value || "unknown").replace(/[_-]/g, " ").trim();
    return label.length > 0 ? label : "unknown";
  };

  const sortButtonClass = `inline-flex min-h-8 items-center gap-1.5 rounded-[var(--stats-control-radius)] px-2.5 py-1.5 transition-[background-color,border-color,color,box-shadow] duration-200 motion-reduce:transition-none ${TAB_IDLE_CLASS} ${CONTROL_FOCUS_CLASS}`;
  const cellClass = "block min-w-0 break-words px-3 py-2 align-middle [overflow-wrap:anywhere] lg:table-cell lg:border-y lg:border-[color:var(--stats-border-hairline)] lg:bg-[color:var(--stats-surface-panel)] lg:px-3 lg:py-3 lg:group-hover:bg-[color:var(--stats-surface-panel-hover)]";
  const firstCellClass = "lg:rounded-l-[var(--stats-subpanel-radius)] lg:border-l";
  const lastCellClass = "lg:rounded-r-[var(--stats-subpanel-radius)] lg:border-r";
  const mobileLabelClass = "mb-1 text-[9px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)] lg:hidden";
  const numericClass = "font-mono text-[11px] tabular-nums text-[color:var(--stats-detail-color)]";
  const contextChipClass = `${CHIP_CLASS} inline-flex max-w-full items-center rounded-[var(--stats-chip-radius)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[color:var(--stats-label-color)]`;

  if (loading) {
    return (
      <SystemFeedbackState
        icon={Loader2}
        title="Loading invocation records"
        detail="Refreshing the ledger rows and transcript expansion targets."
        role="status"
        ariaLabel="Loading invocation records"
        tone="signal"
        busy
      >
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={`${SUBPANEL_CLASS} h-10 !p-0 motion-safe:animate-pulse ${TRACK_CLASS}`} />
          ))}
        </div>
      </SystemFeedbackState>
    );
  }

  if (error) {
    return (
      <SystemFeedbackState
        icon={AlertTriangle}
        title="Failed to load invocation records"
        detail={error}
        role="alert"
        ariaLabel="Invocation records failed to load"
        tone="negative"
      />
    );
  }

  if (invocations.length === 0) {
    return (
      <SystemFeedbackState
        icon={Inbox}
        title="No invocation records to show"
        detail="No records match the current filters or record view."
        role="status"
        ariaLabel="No invocation records"
      />
    );
  }

  return (
    <div className="min-w-0 overflow-visible">
      <table className="block w-full border-separate border-spacing-y-2 lg:table lg:border-spacing-y-1.5">
        <caption className="sr-only">
          Invocation ledger with sortable time, token, and duration columns. Rows include status, type, model, token counts, context, and transcript expansion controls.
        </caption>
        <thead className="sticky top-0 z-10 hidden bg-[color:var(--stats-surface-panel)] lg:table-header-group">
          <tr className="text-left text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">
            <th id="invocations-time" scope="col" aria-sort={getAriaSort("startedAt")} className="pb-2 pl-3">
              <button
                type="button"
                onClick={() => handleSort("startedAt")}
                aria-label={getSortButtonLabel("time", "startedAt")}
                className={sortButtonClass}
              >
                Time {renderSortIcon("startedAt")}
              </button>
            </th>
            <th id="invocations-status" scope="col" className="pb-2">Status</th>
            <th id="invocations-type" scope="col" className="pb-2">Type</th>
            <th id="invocations-model" scope="col" className="pb-2">Model</th>
            <th id="invocations-input" scope="col" aria-sort={getAriaSort("inputTokens")} className="pb-2">
              <button
                type="button"
                onClick={() => handleSort("inputTokens")}
                aria-label={getSortButtonLabel("input tokens", "inputTokens")}
                className={sortButtonClass}
              >
                In {renderSortIcon("inputTokens")}
              </button>
            </th>
            <th id="invocations-output" scope="col" aria-sort={getAriaSort("outputTokens")} className="pb-2">
              <button
                type="button"
                onClick={() => handleSort("outputTokens")}
                aria-label={getSortButtonLabel("output tokens", "outputTokens")}
                className={sortButtonClass}
              >
                Out {renderSortIcon("outputTokens")}
              </button>
            </th>
            <th id="invocations-cached" scope="col" className="pb-2">Cached</th>
            <th id="invocations-total" scope="col" aria-sort={getAriaSort("totalTokens")} className="pb-2">
              <button
                type="button"
                onClick={() => handleSort("totalTokens")}
                aria-label={getSortButtonLabel("total tokens", "totalTokens")}
                className={sortButtonClass}
              >
                Total {renderSortIcon("totalTokens")}
              </button>
            </th>
            <th id="invocations-duration" scope="col" aria-sort={getAriaSort("durationMs")} className="pb-2">
              <button
                type="button"
                onClick={() => handleSort("durationMs")}
                aria-label={getSortButtonLabel("average duration", "durationMs")}
                className={sortButtonClass}
              >
                Avg Duration {renderSortIcon("durationMs")}
              </button>
            </th>
            <th id="invocations-context" scope="col" className="pb-2">Context</th>
            <th id="invocations-expand" scope="col" className="pb-2 pr-3 text-right">Expand</th>
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
                  className={`${SUBPANEL_CLASS} group block overflow-hidden !p-0 transition-[background-color,border-color,box-shadow] duration-200 hover:border-[color:var(--stats-border-strong)] hover:bg-[color:var(--stats-surface-subpanel-hover)] motion-reduce:transition-none lg:table-row lg:border-0 lg:bg-transparent lg:shadow-none ${
                    invocation.status === "running"
                      ? "border-l-2 border-l-[color:var(--stats-signal-text)]"
                      : invocation.status === "failed"
                        ? "border-l-2 border-l-[color:var(--stats-negative-text)]"
                        : ""
                  }`}
                >
                  <td headers="invocations-time" className={`${cellClass} ${firstCellClass} ${
                    invocation.status === "running"
                      ? "lg:border-l-2 lg:border-l-[color:var(--stats-signal-text)]"
                      : invocation.status === "failed"
                        ? "lg:border-l-2 lg:border-l-[color:var(--stats-negative-text)]"
                        : ""
                  }`}>
                    <div className={mobileLabelClass}>Time</div>
                    <div className="font-mono text-[11px] leading-5 tabular-nums text-[color:var(--stats-label-color)]">{formatDateTime(invocation.startedAt)}</div>
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
                    <div className={`${CHIP_CLASS} inline-flex max-w-full rounded-[var(--stats-chip-radius)] px-2 py-0.5 text-[10px] font-bold capitalize tracking-[0.04em] text-[color:var(--stats-detail-color)]`}>
                      <span className="min-w-0 truncate">{formatLabel(invocation.type)}</span>
                    </div>
                  </td>
                  <td headers="invocations-model" className={cellClass}>
                    <div className={mobileLabelClass}>Model</div>
                    <div className="flex min-w-0 items-center gap-2 rounded-[var(--stats-control-radius)] border border-[color:var(--stats-border-hairline)] bg-[color:var(--stats-surface-chip)] px-2 py-1.5 text-[11px] text-[color:var(--stats-detail-color)]">
                      <div className={`shrink-0 rounded-[0.65rem] p-1.5 ${providerBg} ${providerText}`}>
                        <ProviderIcon aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </div>
                      <div className="min-w-0 leading-4">
                        <div className="truncate font-bold capitalize text-[color:var(--stats-value-color)]">{formatLabel(invocation.provider)}</div>
                        <div className="min-w-0 break-words font-mono text-[10px] leading-4 text-[color:var(--stats-detail-color)] [overflow-wrap:anywhere]">{invocation.model || "—"}</div>
                      </div>
                    </div>
                  </td>
                  <td headers="invocations-input" className={cellClass}>
                    <div className={mobileLabelClass}>In</div>
                    <div className={numericClass}>{formatTokens(invocation.inputTokens ?? 0)}</div>
                  </td>
                  <td headers="invocations-output" className={cellClass}>
                    <div className={mobileLabelClass}>Out</div>
                    <div className={numericClass}>{formatTokens(invocation.outputTokens ?? 0)}</div>
                  </td>
                  <td headers="invocations-cached" className={cellClass}>
                    <div className={mobileLabelClass}>Cached</div>
                    <div className={numericClass}>{formatTokens(invocation.cachedInputTokens ?? 0)}</div>
                  </td>
                  <td headers="invocations-total" className={cellClass}>
                    <div className={mobileLabelClass}>Total</div>
                    <div className="font-mono text-[11px] font-bold tabular-nums text-[color:var(--stats-value-color)]">{formatTokens(invocation.totalTokens ?? 0)}</div>
                  </td>
                  <td headers="invocations-duration" className={cellClass}>
                    <div className={mobileLabelClass}>Duration</div>
                    <div className={`font-mono text-[11px] tabular-nums ${invocation.finishedAt ? "text-[color:var(--stats-detail-color)]" : "text-[color:var(--stats-signal-text)]"}`}>
                      {duration}
                    </div>
                  </td>
                  <td headers="invocations-context" className={cellClass}>
                    <div className={mobileLabelClass}>Context</div>
                    <div className="flex min-w-0 flex-wrap gap-1">
                      {invocation.sprintNumber !== null && invocation.sprintNumber !== undefined ? (
                        <div className={contextChipClass}>
                          S{invocation.sprintNumber}
                        </div>
                      ) : null}
                      {invocation.taskKey !== null && invocation.taskKey !== undefined ? (
                        <div className={contextChipClass}>
                          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{invocation.taskKey}</span>
                        </div>
                      ) : null}
                      {invocation.sprintNumber == null && invocation.taskKey == null ? (
                        <span className="text-[11px] text-[color:var(--stats-label-color)]">—</span>
                      ) : null}
                    </div>
                  </td>
                  <td headers="invocations-expand" className={`${cellClass} ${lastCellClass} lg:pr-3 lg:text-right`}>
                    <div className={mobileLabelClass}>Expand</div>
                    <button
                      type="button"
                      onClick={() => onRowExpand(isExpanded ? null : invocation.id)}
                      aria-expanded={isExpanded}
                      aria-controls={`invocation-messages-${invocation.id}`}
                      aria-label={isExpanded ? `Collapse invocation ${invocation.id}` : `Expand invocation ${invocation.id}`}
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-[var(--stats-chip-radius)] border border-[color:var(--stats-border-hairline)] bg-[color:var(--stats-surface-chip)] transition-[background-color,border-color,color,box-shadow] duration-200 hover:border-[color:var(--stats-border-strong)] hover:bg-[color:var(--stats-surface-chip-hover)] motion-reduce:transition-none ${CONTROL_FOCUS_CLASS} ${
                        isExpanded ? "text-[color:var(--stats-signal-text)]" : "text-[color:var(--stats-label-color)]"
                      }`}
                    >
                      {isExpanded ? <ChevronDown aria-hidden="true" className="h-4 w-4" /> : <ChevronRight aria-hidden="true" className="h-4 w-4" />}
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
            className={`${CHIP_CLASS} rounded-[var(--stats-chip-radius)] px-4 py-2 text-xs font-bold text-[color:var(--stats-detail-color)] transition-colors hover:bg-[color:var(--stats-surface-chip-hover)] ${CONTROL_FOCUS_CLASS}`}
          >
            Show more invocations
          </button>
        </div>
      )}
    </div>
  );
};
