import type { FunctionComponent } from "preact";
import { RefreshCw, Trash2, AlertCircle, Activity } from "lucide-preact";
import type { ChatThread } from "../../types.js";
import { formatRelativeChatTime } from "../../lib/chat-time.js";
import { ChatAvatar } from "./ChatAvatar.js";
import { ChatRuntimeBadge } from "./ChatRuntimeBadge.js";
import { MOTION_TOKENS } from "../../lib/motion/tokens.js";

const statusTone = (pendingCount: number): string => (
  pendingCount > 0 ? "text-status-amber" : "text-slate-400 dark:text-slate-500"
);

export const ThreadListCard: FunctionComponent<{
  threads: ChatThread[];
  selectedThreadId: string | null;
  onSelect: (threadId: string) => void;
  onDelete: (threadId: string) => void;
  deletingThreadId: string | null;
}> = ({ threads, selectedThreadId, onSelect, onDelete, deletingThreadId }) => (
  <div className="space-y-3" role="listbox" aria-label="Chat threads">
    {threads.map((thread) => {
      const isSelected = selectedThreadId === thread.id;
      return (
        <div key={thread.id} className="group relative overflow-hidden rounded-[1.25rem]">
          <button
            type="button"
            role="option"
            aria-selected={isSelected}
            onClick={() => onSelect(thread.id)}
            data-state={isSelected ? "selected" : "idle"}
            className={`relative w-full rounded-[1.25rem] border px-4 py-3 pr-16 text-left transition-[transform,background-color,border-color,box-shadow] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 focus-visible:ring-offset-2 ${
              isSelected
                ? "border-signal-500/40 bg-signal-500/[0.12] shadow-[0_8px_20px_rgba(0,224,160,0.10)] dark:border-signal-500/45 dark:bg-signal-500/[0.14] dark:shadow-[0_8px_22px_rgba(0,224,160,0.12)]"
                : "border-black/[0.05] bg-black/[0.03] hover:-translate-y-px hover:border-slate-300 hover:bg-black/[0.05] hover:shadow-[0_8px_16px_rgba(15,23,42,0.08)] dark:border-white/[0.05] dark:bg-white/[0.03] dark:hover:border-white/[0.14] dark:hover:bg-white/[0.05] dark:hover:shadow-[0_10px_18px_rgba(0,0,0,0.28)]"
            }`}
            style={{
              transitionDuration: MOTION_TOKENS.timing.fast,
              transitionTimingFunction: MOTION_TOKENS.easing.standard,
            }}
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute inset-y-3 left-1 w-0.5 rounded-full bg-signal-500 transition-opacity ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-55"}`}
              style={{
                transitionDuration: MOTION_TOKENS.timing.fast,
                transitionTimingFunction: MOTION_TOKENS.easing.standard,
              }}
            />
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div className="relative shrink-0">
                  <ChatAvatar role="user" />
                  <div className="absolute -bottom-1 -right-1 rounded-full bg-white p-[2px] dark:bg-void-900">
                    <ChatRuntimeBadge status={thread.pendingMessageCount > 0 ? "running" : "completed"} />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 truncate">
                    <span className="truncate font-display text-lg font-black tracking-tight text-slate-900 dark:text-white">
                      {thread.title}
                    </span>
                    {thread.runtimeState?.replayRequired && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-status-amber/30 bg-status-amber/10 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-status-amber">
                        <AlertCircle className="h-2.5 w-2.5" /> Replay Req
                      </span>
                    )}
                    {thread.runtimeState?.sessionIds && thread.runtimeState.sessionIds.length > 0 && !thread.runtimeState?.replayRequired && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-signal-500/30 bg-signal-500/10 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-signal-500">
                        <Activity className="h-2.5 w-2.5" /> Active
                      </span>
                    )}
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    {thread.lastMessagePreview || "No messages yet."}
                  </div>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className={`text-[10px] font-bold uppercase tracking-[0.14em] ${statusTone(thread.pendingMessageCount)}`}>
                  {thread.pendingMessageCount > 0 ? `${thread.pendingMessageCount} pending` : "synced"}
                </div>
                <div className="mt-1 font-mono text-[10px] text-slate-400">{formatRelativeChatTime(thread.lastMessageAt)}</div>
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(thread.id);
            }}
            disabled={deletingThreadId === thread.id}
            aria-label={`Delete ${thread.title}`}
            className="absolute inset-y-0 right-0 flex w-12 translate-x-full items-center justify-center border-l border-status-red/15 bg-status-red/10 text-status-red opacity-0 transition-[transform,opacity] ease-out group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100 disabled:translate-x-0 disabled:opacity-100"
            style={{
              transitionDuration: MOTION_TOKENS.timing.fast,
              transitionTimingFunction: MOTION_TOKENS.easing.standard,
            }}
          >
            {deletingThreadId === thread.id ? <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2.1} /> : <Trash2 className="h-4 w-4" strokeWidth={2.1} />}
          </button>
        </div>
      );
    })}
  </div>
);
