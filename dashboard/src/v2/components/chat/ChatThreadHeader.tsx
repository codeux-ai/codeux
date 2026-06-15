import { h, type FunctionComponent } from "preact";
import { AlertCircle, Zap, Activity } from "lucide-preact";
import type { ChatThread } from "../../types.js";

const resolveAssignedLabel = (thread: ChatThread | null): string => {
  if (!thread) {
    return "Unassigned";
  }

  if (thread.runtimeState?.routeKind === "virtual" && thread.runtimeState.virtualProvider) {
    return `Virtual ${thread.runtimeState.virtualProvider}`;
  }

  if (thread.runtimeState?.routeKind === "worker") {
    if (thread.runtimeState.workerEndpointId) {
      return thread.runtimeState.workerEndpointId;
    }
    if (thread.connectionId) {
      return thread.connectionId;
    }
  }

  if (thread.connectionId) {
    return thread.connectionId;
  }

  return "Unassigned";
};

interface ChatThreadHeaderProps {
  thread: ChatThread | null;
  onCompact: () => void;
  isCompacting: boolean;
}

export const ChatThreadHeader: FunctionComponent<ChatThreadHeaderProps> = ({
  thread,
  onCompact,
  isCompacting,
}) => {
  const assignedLabel = resolveAssignedLabel(thread);

  const isReplayRequired = thread?.runtimeState?.replayRequired;
  const hasActiveSession = thread?.runtimeState?.sessionIds && thread.runtimeState.sessionIds.length > 0;
  const isNewOrCompacted = !hasActiveSession || isReplayRequired;

  return (
    <div className="shrink-0 border-b border-black/[0.05] px-6 py-5 dark:border-white/[0.05]">
      <div className="flex flex-col sm:flex-row items-start sm:justify-between gap-4 sm:gap-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-signal-500">Active Thread</div>
            {isReplayRequired && (
              <span className="inline-flex items-center gap-1 rounded-sm border border-status-amber/30 bg-status-amber/20 shadow-sm px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-status-amber">
                <AlertCircle className="h-3 w-3" />
                Replay Required
              </span>
            )}
            {!isReplayRequired && hasActiveSession && (
              <span className="inline-flex items-center gap-1 rounded-sm border border-signal-500/30 bg-signal-500/20 shadow-sm px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-signal-500">
                <Activity className="h-3 w-3" />
                Active Session
              </span>
            )}
            {isNewOrCompacted && !isReplayRequired && (
              <span className="inline-flex items-center gap-1 rounded-sm border border-slate-500/30 bg-slate-500/20 shadow-sm px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-600 dark:border-slate-400/30 dark:text-slate-300">
                New/Compacted
              </span>
            )}
          </div>
          <h2 className="mt-2 font-display text-3xl font-black tracking-tight text-slate-900 dark:text-white break-words min-w-0 w-full">
            {thread?.title || "No Thread Selected"}
          </h2>
        </div>
        <div className="text-left sm:text-right text-[10px] font-mono text-slate-400 w-full sm:w-auto">
          <div className="mb-2 w-full">
            {thread ? `${thread.messageCount} messages` : "0 messages"}
          </div>
          <div className="flex flex-wrap items-center sm:justify-end gap-2">
            {thread && thread.messageCount > 0 && (
              <button
                type="button"
                onClick={onCompact}
                disabled={isCompacting}
                className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white/70 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:bg-black/[0.03] hover:text-slate-900 disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white"
                title="Compact Conversation"
              >
                <Zap className={`h-3.5 w-3.5 ${isCompacting ? "animate-pulse text-signal-500" : ""}`} />
                {isCompacting ? "Compacting session..." : "Compact"}
              </button>
            )}
            <div className="inline-flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Worker:</span>
              <span className="rounded-full border border-black/[0.08] bg-white/70 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300">
                {assignedLabel}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
