import type { FunctionComponent } from "preact";
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
import { formatTokens, formatDuration, formatDateTime } from "../../stats-utils.js";
import { DEFAULT_LIST_WINDOW, resolveListWindow } from "../../../../lib/list-window.js";
import {
  LEDGER_ROW_MODERN_CLASS,
  CHIP_CLASS,
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
    if (sort.key !== key) return <ArrowUpDown className="ml-1 h-3 w-3" />;
    return sort.dir === "asc" ? (
      <ArrowUp className="ml-1 h-3 w-3 text-signal-500" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3 text-signal-500" />
    );
  };

  const renderStatusChip = (status: string) => {
    switch (status) {
      case "running":
        return (
          <div className={`${CHIP_CLASS} flex items-center gap-1.5 border-blue-500/40 bg-blue-500/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-300`}>
            <div className="h-2 w-2 rounded-full bg-blue-500" />
            <Loader2 className="h-3 w-3 animate-spin" />
            Running
          </div>
        );
      case "completed":
        return (
          <div className={`${CHIP_CLASS} flex items-center gap-1.5 border-emerald-500/40 bg-emerald-500/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-300`}>
            <div className="h-2 w-2 rounded-full bg-emerald-500" />
            <CheckCircle2 className="h-3 w-3" />
            Completed
          </div>
        );
      case "failed":
        return (
          <div className={`${CHIP_CLASS} flex items-center gap-1.5 border-red-500/40 bg-red-500/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-300`}>
            <div className="h-2 w-2 rounded-full bg-red-500" />
            <XCircle className="h-3 w-3" />
            Failed
          </div>
        );
      case "cancelled":
        return (
          <div className={`${CHIP_CLASS} flex items-center gap-1.5 border-slate-500/40 bg-slate-500/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300`}>
            <div className="h-2 w-2 rounded-full bg-slate-500" />
            <MinusCircle className="h-3 w-3" />
            Cancelled
          </div>
        );
      case "paused":
        return (
          <div className={`${CHIP_CLASS} flex items-center gap-1.5 border-amber-500/40 bg-amber-500/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-300`}>
            <div className="h-2 w-2 rounded-full bg-amber-500" />
            <PauseCircle className="h-3 w-3" />
            Paused
          </div>
        );
      default:
        return (
          <div className={`${CHIP_CLASS} px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400`}>
            {status}
          </div>
        );
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`${LEDGER_ROW_MODERN_CLASS} h-20 animate-pulse bg-slate-100/50 dark:bg-white/5`} />
        ))}
      </div>
    );
  }

  if (invocations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500">
        <AlertTriangle className="mb-4 h-10 w-10 opacity-20" />
        <div className="text-sm font-medium">No invocations match the current filters</div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-y-2 block lg:table">
        <thead className="sticky top-0 z-10 bg-white/90 backdrop-blur-sm dark:bg-void-900/80 hidden lg:table-header-group">
          <tr className="text-left text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
            <th className="pb-2 pl-6">
              <button
                type="button"
                onClick={() => handleSort("startedAt")}
                className="flex items-center hover:text-slate-900 dark:hover:text-white"
              >
                Time {renderSortIcon("startedAt")}
              </button>
            </th>
            <th className="pb-2">Status</th>
            <th className="pb-2">Type</th>
            <th className="pb-2">Model</th>
            <th className="pb-2">
              <button
                type="button"
                onClick={() => handleSort("inputTokens")}
                className="flex items-center hover:text-slate-900 dark:hover:text-white"
              >
                In {renderSortIcon("inputTokens")}
              </button>
            </th>
            <th className="pb-2">
              <button
                type="button"
                onClick={() => handleSort("outputTokens")}
                className="flex items-center hover:text-slate-900 dark:hover:text-white"
              >
                Out {renderSortIcon("outputTokens")}
              </button>
            </th>
            <th className="pb-2">Cached</th>
            <th className="pb-2">
              <button
                type="button"
                onClick={() => handleSort("totalTokens")}
                className="flex items-center hover:text-slate-900 dark:hover:text-white"
              >
                Total {renderSortIcon("totalTokens")}
              </button>
            </th>
            <th className="hidden pb-2 md:table-cell">
              <button
                type="button"
                onClick={() => handleSort("durationMs")}
                className="flex items-center hover:text-slate-900 dark:hover:text-white"
              >
                Avg Duration {renderSortIcon("durationMs")}
              </button>
            </th>
            <th className="pb-2">Context</th>
            <th className="pb-2 pr-6 text-right">Expand</th>
          </tr>
        </thead>
        <tbody className="block lg:table-row-group">
          {visibleInvocations.map((invocation) => {
            const isExpanded = expandedId === invocation.id;
            const { icon: ProviderIcon, bg: providerBg, text: providerText } = getProviderIcon(invocation.provider);
            const duration = invocation.finishedAt
              ? formatDuration(Date.parse(invocation.finishedAt) - Date.parse(invocation.startedAt))
              : "running";

            return (
              <>
                <tr key={invocation.id} className="block lg:table-row">
                  <td colSpan={11} className="p-0 block lg:table-cell">
                    <div className={`${LEDGER_ROW_MODERN_CLASS} flex items-center p-4 lg:p-6 ${invocation.status === "running" ? "border-l-2 border-l-blue-400 bg-blue-500/[0.02]" : invocation.status === "failed" ? "border-l-2 border-l-red-400 bg-red-500/[0.02]" : ""}`}>
                      <div className="flex flex-col gap-3 lg:grid lg:w-full lg:grid-cols-[1.2fr_1fr_1fr_1.4fr_0.6fr_0.6fr_0.6fr_0.8fr_0.8fr_1fr_0.4fr] lg:items-center lg:gap-2">
                        {/* Header Row: Time and Expand */}
                        <div className="flex items-center justify-between lg:contents">
                          {/* Time */}
                          <div className="text-[11px] font-mono text-slate-400">

                          {formatDateTime(invocation.startedAt)}

                          </div>
                          {/* Expand Toggle Mobile */}
                          <div className="flex justify-end lg:hidden">
                            <button
                              type="button"
                              onClick={() => onRowExpand(isExpanded ? null : invocation.id)}
                              aria-label={isExpanded ? `Collapse invocation ${invocation.id}` : `Expand invocation ${invocation.id}`}
                              className={`rounded-full p-2 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/5 ${
                                isExpanded ? "text-signal-500" : "text-slate-400"
                              }`}
                            >
                              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                          </div>
                        </div>

                        {/* Status & Type Row */}
                        <div className="flex items-center gap-2 lg:contents">
                          {/* Status */}
                          <div>{renderStatusChip(invocation.status)}</div>

                        {/* Type */}
                          <div className="flex">

                          <div className={`${CHIP_CLASS} px-2 py-0.5 text-[10px] font-medium text-slate-500`}>
                            {invocation.type?.replace(/_/g, " ") || "unknown"}
                          </div>
                        </div>
                        </div>

                        {/* Model & Duration Row */}
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between lg:contents">
                          {/* Model */}
                          <div className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">

                          <div className={`rounded-lg p-1.5 ${providerBg} ${providerText}`}>
                            <ProviderIcon className="h-3 w-3" strokeWidth={2.5} />
                          </div>
                          <span className="truncate">{invocation.model || "—"}</span>
                          </div>

                        {/* Token Stats Row */}
                        <div className="grid grid-cols-4 gap-2 rounded-lg border border-slate-200/60 bg-slate-50 p-2 dark:border-white/5 dark:bg-white/[0.02] lg:contents lg:border-0 lg:bg-transparent lg:p-0">
                          {/* In Tokens */}
                          <div>
                            <div className="mb-1 text-[9px] font-bold uppercase text-slate-400 lg:hidden">In</div>
                            <div className="text-[11px] text-blue-600 dark:text-blue-400">

                          {formatTokens(invocation.inputTokens ?? 0)}
                        </div>
                          </div>

                        {/* Out Tokens */}
                          <div>
                            <div className="mb-1 text-[9px] font-bold uppercase text-slate-400 lg:hidden">Out</div>
                            <div className="text-[11px] text-emerald-600 dark:text-emerald-400">

                          {formatTokens(invocation.outputTokens ?? 0)}
                        </div>
                          </div>

                        {/* Cached Tokens */}
                          <div>
                            <div className="mb-1 text-[9px] font-bold uppercase text-slate-400 lg:hidden">Cached</div>
                            <div className="text-[11px] text-purple-600 dark:text-purple-400">

                          {formatTokens(invocation.cachedInputTokens ?? 0)}
                        </div>
                          </div>

                        {/* Total Tokens */}
                          <div>
                            <div className="mb-1 text-[9px] font-bold uppercase text-slate-400 lg:hidden">Total</div>
                            <div className="text-[11px] font-bold text-slate-900 dark:text-white">

                          {formatTokens(invocation.totalTokens ?? 0)}
                        </div>
                          </div>
                        </div>

                        {/* Duration */}
                          <div className={`hidden md:block text-[11px] ${invocation.finishedAt ? "text-slate-600 dark:text-slate-300" : "text-blue-600 dark:text-blue-400"}`}>

                          {duration}
                        </div>
                        </div>

                        {/* Context Chips */}
                        <div className="flex flex-wrap gap-1 lg:contents">
                          <div className="flex flex-wrap gap-1">
                          {(invocation.sprintNumber !== null || invocation.taskKey !== null) && (
                            <>
                              {invocation.sprintNumber !== null && (
                                <div className={`${CHIP_CLASS} px-1.5 py-0.5 text-[9px] font-bold text-slate-400`}>
                                  S{invocation.sprintNumber}
                                </div>
                              )}
                              {invocation.taskKey !== null && (
                                <div className={`${CHIP_CLASS} px-1.5 py-0.5 text-[9px] font-bold text-slate-400`}>
                                  {invocation.taskKey}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                        </div>

                        {/* Expand Toggle Desktop */}
                        <div className="hidden lg:flex lg:justify-end">

                          <button
                            type="button"
                            onClick={() => onRowExpand(isExpanded ? null : invocation.id)}
                            aria-label={isExpanded ? `Collapse invocation ${invocation.id}` : `Expand invocation ${invocation.id}`}
                            className={`rounded-full p-2 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/5 ${
                              isExpanded ? "text-signal-500" : "text-slate-400"
                            }`}
                          >
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Error Sub-row inside main card if failed */}
                    {invocation.status === "failed" && (invocation.lastErrorMessage || invocation.errorMessage) && (
                      <div className="mt-[-8px] px-6 pb-4">
                        <div className="flex items-center gap-1.5 text-[11px] text-red-600 dark:text-red-400">
                          <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                          <span>{invocation.lastErrorMessage || invocation.errorMessage}</span>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>

                {/* Expanded Detail Row */}
                {isExpanded && expandedInvocation ? (
                  <tr key={`${invocation.id}-detail`} className="block lg:table-row">
                    <td colSpan={11} className="px-0 pb-2 lg:px-6 block lg:table-cell">
                      <InvocationMessagesPanel invocation={expandedInvocation} />
                    </td>
                  </tr>
                ) : null}
              </>
            );
          })}
        </tbody>
      </table>
      {hasMore && (
        <div className="mt-4 flex justify-center pb-4">
          <button
            type="button"
            onClick={revealMore}
            className="rounded-full bg-slate-100 px-4 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-200 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
          >
            Show more invocations
          </button>
        </div>
      )}
    </div>
  );
};
