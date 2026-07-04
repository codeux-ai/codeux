import type { FunctionComponent } from "preact";
import { RefreshCw, Trash2, MessageCircle, AlertCircle, Activity, MessageSquare } from "lucide-preact";
import type { ChatThread } from "../../types.js";
import { formatRelativeChatTime } from "../../lib/chat-time.js";
import { ChatAvatar } from "./ChatAvatar.js";
import { ChatRuntimeBadge } from "./ChatRuntimeBadge.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";

const statusTone = (pendingCount: number): string => (
  pendingCount > 0 ? "text-status-amber" : "text-slate-400 dark:text-slate-500"
);

const STATUS_PILL: Record<string, { dot: string; text: string; bg: string; border: string }> = {
  replay: {
    dot: "bg-status-amber shadow-[0_0_6px_rgba(245,158,11,0.4)]",
    text: "text-status-amber",
    bg: "bg-status-amber/[0.08]",
    border: "border-status-amber/20",
  },
  active: {
    dot: "bg-signal-500 shadow-[0_0_8px_rgba(0,224,160,0.6)] animate-pulse",
    text: "text-signal-500",
    bg: "bg-signal-500/[0.08]",
    border: "border-signal-500/20",
  },
};

export const ThreadListCard: FunctionComponent<{
  threads: ChatThread[];
  selectedThreadId: string | null;
  onSelect: (threadId: string) => void;
  onDelete: (threadId: string) => void;
  deletingThreadId: string | null;
}> = ({ threads, selectedThreadId, onSelect, onDelete, deletingThreadId }) => {
  const interactionTokens = useInteractionTokens();

  return (
    <div className="space-y-2.5">
      {threads.map((thread) => {
        const isSelected = selectedThreadId === thread.id;
        const isActive = !!(thread.runtimeState?.sessionIds && thread.runtimeState.sessionIds.length > 0 && !thread.runtimeState?.replayRequired);
        const isReplay = !!thread.runtimeState?.replayRequired;

        return (
          <div key={thread.id} className="group relative overflow-hidden rounded-[1.25rem]">
            <button
              type="button"
              aria-selected={isSelected ? "true" : "false"}
              onClick={() => onSelect(thread.id)}
              style={{
                transitionProperty: "all",
                transitionDuration: interactionTokens.controlFeedback.duration,
                transitionTimingFunction: interactionTokens.controlFeedback.ease,
              }}
              className={`w-full rounded-[1.25rem] border p-4 pr-14 text-left
                bg-white/64 dark:bg-white/[0.035] backdrop-blur-2xl
                shadow-[0_10px_28px_rgba(15,23,42,0.045)] dark:shadow-[0_12px_34px_rgba(0,0,0,0.18)]
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900
                ${isSelected
                  ? "border-signal-500/55 bg-signal-500/[0.065] shadow-[0_14px_34px_rgba(0,224,160,0.10)]"
                  : thread.pendingMessageCount > 0
                    ? "border-status-amber/26 bg-status-amber/[0.055] dark:border-status-amber/25"
                    : isReplay
                      ? "border-status-amber/22 bg-white/68 dark:border-status-amber/20 dark:bg-white/[0.035]"
                      : "border-black/[0.06] dark:border-white/[0.06] hover:border-slate-300 dark:hover:border-white/[0.14]"
                }`}
            >
            <div
              aria-hidden
              className="absolute inset-y-4 left-0 w-[3px] rounded-r-full bg-transparent pointer-events-none"
              style={{ backgroundColor: isSelected ? "#00E0A0" : thread.pendingMessageCount > 0 || isReplay ? "#F59E0B" : "transparent" }}
            />
            <div
              aria-hidden
              className="absolute -right-2 -top-3 font-black font-display text-[4.25rem] leading-none tracking-tighter text-black/[0.018] dark:text-white/[0.014] pointer-events-none select-none"
            >
              {thread.id.slice(0, 6)}
            </div>

            <div className="relative z-10">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3.5 min-w-0 flex-1">
                  {/* Avatar with runtime badge overlay */}
                  <div className="relative shrink-0 mt-0.5">
                    <ChatAvatar role="user" />
                    <div className="absolute -bottom-1 -right-1 rounded-full bg-white dark:bg-void-900 p-[2px]">
                      <ChatRuntimeBadge status={thread.pendingMessageCount > 0 ? "running" : "completed"} />
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    {/* Badges row */}
                    <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-mono text-[10px] font-semibold text-slate-400">
                        {thread.id.slice(0, 8)}
                      </span>
                      {isReplay && (
                        <span className={`inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em] ${STATUS_PILL.replay.text}`}>
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${STATUS_PILL.replay.dot}`} />
                          <AlertCircle className="h-2.5 w-2.5" />
                          Replay Req
                        </span>
                      )}
                      {isActive && (
                        <span className={`inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em] ${STATUS_PILL.active.text}`}>
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${STATUS_PILL.active.dot}`} />
                          <Activity className="h-2.5 w-2.5" />
                          Active
                        </span>
                      )}
                    </div>

                    {/* Title */}
                    <h3 className="truncate font-display text-[16px] font-black leading-snug tracking-tight text-slate-900 dark:text-white">
                      {thread.title}
                    </h3>

                    {/* Preview */}
                    <div className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-500 [overflow-wrap:anywhere] dark:text-slate-400">
                      {thread.lastMessagePreview || "No messages yet."}
                    </div>
                  </div>
                </div>

                {/* Right column */}
                <div className="shrink-0 flex flex-col items-end gap-1.5 pt-0.5">
                  <div className={`text-[10px] font-bold uppercase tracking-[0.14em] ${statusTone(thread.pendingMessageCount)}`}>
                    {thread.pendingMessageCount > 0 ? (
                      <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-signal-500 animate-pulse" /> pending</span>
                    ) : (
                      "synced"
                    )}
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                    {formatRelativeChatTime(thread.lastMessageAt)}
                  </div>
                  {thread.messageCount > 0 && (
                    <div className="flex items-center gap-1 text-[10px] font-mono text-slate-400 dark:text-slate-500">
                      <MessageSquare className="w-3 h-3" strokeWidth={2} />
                      {thread.messageCount}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </button>

            {/* Delete slide-out */}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDelete(thread.id);
              }}
              disabled={deletingThreadId === thread.id}
              aria-label={`Delete ${thread.title}`}
              style={{
                transitionProperty: "all",
                transitionDuration: interactionTokens.controlFeedback.duration,
                transitionTimingFunction: interactionTokens.controlFeedback.ease,
              }}
              className={`absolute inset-y-0 right-0 flex w-12 translate-x-full items-center justify-center rounded-r-[1.25rem] border-l border-status-red/15 bg-status-red/10 text-status-red opacity-0 group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100 ${deletingThreadId === thread.id ? "translate-x-0 opacity-100 cursor-wait" : ""}`}
            >
              {deletingThreadId === thread.id
                ? <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2.1} />
                : <Trash2 className="h-4 w-4" strokeWidth={2.1} />}
            </button>
          </div>
        );
      })}
    </div>
  );
};
