import { h, type FunctionComponent } from "preact";
import { AlertCircle, Zap, Activity } from "lucide-preact";
import type { ChatThread } from "../../types.js";
import { buildWorkerOptionIndex } from "../../lib/chat-entity-index.js";
import type { WorkerOption } from "../../lib/project-worker-options.js";

const resolveSelectedRouteId = (thread: ChatThread | null, workerOptions: WorkerOption[]): string => {
  const index = buildWorkerOptionIndex(workerOptions);

  if (!thread) {
    return index.primary?.id || "";
  }

  if (thread.runtimeState?.routeKind === "virtual" && thread.runtimeState.virtualProvider) {
    return index.byProvider.get(thread.runtimeState.virtualProvider)?.id || "";
  }

  if (thread.runtimeState?.routeKind === "worker") {
    if (thread.runtimeState.workerEndpointId) {
      const option = index.byEndpoint.get(thread.runtimeState.workerEndpointId);
      if (option) return option.id;
    }
    if (thread.connectionId) {
      const option = index.byConnection.get(thread.connectionId);
      if (option) return option.id;
    }
  }

  if (thread.connectionId) {
    return index.byConnection.get(thread.connectionId)?.id || "";
  }

  return index.primary?.id || "";
};

interface ChatThreadHeaderProps {
  thread: ChatThread | null;
  workerOptions: WorkerOption[];
  isAssigning: boolean;
  onAssignRoute: (option: WorkerOption) => void;
  onCompact: () => void;
  isCompacting: boolean;
}

export const ChatThreadHeader: FunctionComponent<ChatThreadHeaderProps> = ({
  thread,
  workerOptions,
  isAssigning,
  onAssignRoute,
  onCompact,
  isCompacting,
}) => {
  const selectedRouteId = resolveSelectedRouteId(thread, workerOptions);

  const isReplayRequired = thread?.runtimeState?.replayRequired;
  const hasActiveSession = thread?.runtimeState?.sessionIds && thread.runtimeState.sessionIds.length > 0;
  const isNewOrCompacted = !hasActiveSession || isReplayRequired;

  return (
    <div className="shrink-0 border-b border-black/[0.05] px-6 py-5 dark:border-white/[0.05]">
      <div className="flex items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-2">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-signal-500">Active Thread</div>
            {isReplayRequired && (
              <span className="inline-flex items-center gap-1 rounded-sm border border-status-amber/30 bg-status-amber/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-status-amber">
                <AlertCircle className="h-3 w-3" />
                Replay Required
              </span>
            )}
            {!isReplayRequired && hasActiveSession && (
              <span className="inline-flex items-center gap-1 rounded-sm border border-signal-500/30 bg-signal-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-signal-500">
                <Activity className="h-3 w-3" />
                Active Session
              </span>
            )}
            {isNewOrCompacted && !isReplayRequired && (
              <span className="inline-flex items-center gap-1 rounded-sm border border-slate-500/30 bg-slate-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:border-slate-400/30 dark:text-slate-400">
                New/Compacted
              </span>
            )}
          </div>
          <h2 className="mt-2 font-display text-3xl font-black tracking-tight text-slate-900 dark:text-white">
            {thread?.title || "No Thread Selected"}
          </h2>
        </div>
        <div className="text-right text-[10px] font-mono text-slate-400">
          <div className="mb-2">
            {thread ? `${thread.messageCount} messages` : "0 messages"}
          </div>
          <div className="flex items-center justify-end gap-2">
            {thread && thread.messageCount > 0 && (
              <button
                type="button"
                onClick={onCompact}
                disabled={isCompacting}
                className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white/70 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors hover:bg-black/[0.03] hover:text-slate-900 disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:outline-none"
                title="Compact Conversation"
              >
                <Zap className={`h-3.5 w-3.5 ${isCompacting ? "animate-pulse" : ""}`} />
                {isCompacting ? "Compacting..." : "Compact"}
              </button>
            )}
            <label className="inline-flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Worker:</span>
              <select
                value={selectedRouteId}
                onChange={(event) => {
                  const val = event.currentTarget.value;
                  const option = workerOptions.find((o) => o.id === val);
                  if (option) {
                    onAssignRoute(option);
                  } else if (!val) {
                    onAssignRoute({ id: "", label: "Unassigned", status: "unassigned", isPrimary: false, type: "connection", isSelectable: true, connectionId: null });
                  }
                }}
                disabled={!thread || isAssigning}
                className="rounded-full border border-black/[0.08] bg-white/70 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 outline-none dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300"
              >
                <option value="">Unassigned</option>
                {workerOptions.map((option) => (
                  <option key={option.id} value={option.id} disabled={!option.isSelectable}>
                    {option.label} {option.subLabel ? `· ${option.subLabel}` : ""} {option.status ? `· ${option.status}` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};
