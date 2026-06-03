import type { FunctionComponent } from "preact";
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
          <div className={`${CHIP_CLASS} flex items-center gap-1.5 border-blue-500/40 bg-blue-500/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-300`}>
            <Loader2 className="h-3 w-3 animate-spin" />
            Running
          </div>
        );
      case "completed":
        return (
          <div className={`${CHIP_CLASS} flex items-center gap-1.5 border-emerald-500/40 bg-emerald-500/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300`}>
            <CheckCircle2 className="h-3 w-3" />
            Completed
          </div>
        );
      case "failed":
        return (
          <div className={`${CHIP_CLASS} flex items-center gap-1.5 border-red-500/40 bg-red-500/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-red-300`}>
            <XCircle className="h-3 w-3" />
            Failed
          </div>
        );
      case "cancelled":
        return (
          <div className={`${CHIP_CLASS} flex items-center gap-1.5 border-slate-500/40 bg-slate-500/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-300`}>
            <MinusCircle className="h-3 w-3" />
            Cancelled
          </div>
        );
      case "paused":
        return (
          <div className={`${CHIP_CLASS} flex items-center gap-1.5 border-amber-500/40 bg-amber-500/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-300`}>
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
      <table className="w-full border-separate border-spacing-y-2">
        <thead className="sticky top-0 z-10 bg-[#0E0C0A]/80 backdrop-blur-md">
          <tr className="text-left text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
            <th className="pb-2 pl-6">
              <button
                type="button"
                onClick={() => handleSort("startedAt")}
                className="flex items-center hover:text-white"
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
                className="flex items-center hover:text-white"
              >
                In {renderSortIcon("inputTokens")}
              </button>
            </th>
            <th className="pb-2">
              <button
                type="button"
                onClick={() => handleSort("outputTokens")}
                className="flex items-center hover:text-white"
              >
                Out {renderSortIcon("outputTokens")}
              </button>
            </th>
            <th className="pb-2">Cached</th>
            <th className="pb-2">
              <button
                type="button"
                onClick={() => handleSort("totalTokens")}
                className="flex items-center hover:text-white"
              >
                Total {renderSortIcon("totalTokens")}
              </button>
            </th>
            <th className="pb-2">
              <button
                type="button"
                onClick={() => handleSort("durationMs")}
                className="flex items-center hover:text-white"
              >
                Duration {renderSortIcon("durationMs")}
              </button>
            </th>
            <th className="pb-2">Context</th>
            <th className="pb-2 pr-6 text-right">Expand</th>
          </tr>
        </thead>
        <tbody>
          {invocations.map((invocation) => {
            const isExpanded = expandedId === invocation.id;
            const { icon: ProviderIcon, bg: providerBg, text: providerText } = getProviderIcon(invocation.provider);
            const duration = invocation.finishedAt
              ? formatDuration(Date.parse(invocation.finishedAt) - Date.parse(invocation.startedAt))
              : "running";

            return (
              <>
                <tr key={invocation.id}>
                  <td colSpan={11} className="p-0">
                    <div className={`${LEDGER_ROW_MODERN_CLASS} flex items-center p-4 lg:p-6`}>
                      <div className="grid w-full grid-cols-2 gap-4 lg:grid-cols-[1.2fr_1fr_1fr_1.4fr_0.6fr_0.6fr_0.6fr_0.8fr_0.8fr_1fr_0.4fr] lg:items-center lg:gap-2">
                        {/* Time */}
                        <div className="text-[11px] font-mono text-slate-400">
                          {formatDateTime(invocation.startedAt)}
                        </div>

                        {/* Status */}
                        <div>{renderStatusChip(invocation.status)}</div>

                        {/* Type */}
                        <div className="flex">
                          <div className={`${CHIP_CLASS} px-2 py-0.5 text-[10px] font-medium text-slate-500`}>
                            {invocation.type?.replace(/_/g, " ") || "unknown"}
                          </div>
                        </div>

                        {/* Model */}
                        <div className="flex items-center gap-2 text-[11px] text-slate-300">
                          <div className={`rounded-lg p-1.5 ${providerBg} ${providerText}`}>
                            <ProviderIcon className="h-3 w-3" strokeWidth={2.5} />
                          </div>
                          <span className="truncate">{invocation.model || "—"}</span>
                        </div>

                        {/* In Tokens */}
                        <div className="text-[11px] text-blue-400">
                          {formatTokens(invocation.inputTokens ?? 0)}
                        </div>

                        {/* Out Tokens */}
                        <div className="text-[11px] text-emerald-400">
                          {formatTokens(invocation.outputTokens ?? 0)}
                        </div>

                        {/* Cached Tokens */}
                        <div className="text-[11px] text-purple-400">
                          {formatTokens(invocation.cachedInputTokens ?? 0)}
                        </div>

                        {/* Total Tokens */}
                        <div className="text-[11px] font-bold text-white">
                          {formatTokens(invocation.totalTokens ?? 0)}
                        </div>

                        {/* Duration */}
                        <div className={`text-[11px] ${invocation.finishedAt ? "text-slate-300" : "text-blue-400"}`}>
                          {duration}
                        </div>

                        {/* Context Chips */}
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

                        {/* Expand Toggle */}
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => onRowExpand(isExpanded ? null : invocation.id)}
                            aria-label={isExpanded ? `Collapse invocation ${invocation.id}` : `Expand invocation ${invocation.id}`}
                            className={`rounded-full p-2 transition-colors hover:bg-white/5 ${
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
                        <div className="flex items-center gap-1.5 text-[11px] text-red-400">
                          <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                          <span>{invocation.lastErrorMessage || invocation.errorMessage}</span>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>

                {/* Expanded Detail Row */}
                {isExpanded && expandedInvocation ? (
                  <tr key={`${invocation.id}-detail`}>
                    <td colSpan={11} className="px-6 pb-2">
                      <InvocationMessagesPanel invocation={expandedInvocation} />
                    </td>
                  </tr>
                ) : null}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
