import type { FunctionComponent } from "preact";
import { RefreshCw, Trash2, MessageCircle } from "lucide-preact";
import type { ChatThread } from "../../types.js";
import { formatRelativeChatTime } from "../../lib/chat-time.js";
import { ChatAvatar } from "./ChatAvatar.js";
import { ChatRuntimeBadge } from "./ChatRuntimeBadge.js";

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
  <div className="space-y-3">
    {threads.map((thread) => (
      <div key={thread.id} className="group relative overflow-hidden rounded-[1.25rem]">
        <button
          type="button"
          onClick={() => onSelect(thread.id)}
          className={`w-full rounded-[1.25rem] border px-4 py-3 pr-16 text-left transition-colors duration-150 ${
            selectedThreadId === thread.id
              ? "border-signal-500/30 bg-signal-500/10"
              : "border-black/[0.05] bg-black/[0.03] hover:border-slate-300 hover:bg-black/[0.05] dark:border-white/[0.05] dark:bg-white/[0.03] dark:hover:border-white/[0.12] dark:hover:bg-white/[0.05]"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-1 items-start gap-3 min-w-0">
              <div className="relative shrink-0">
                <ChatAvatar role="user" />
                <div className="absolute -bottom-1 -right-1 rounded-full bg-white dark:bg-void-900 p-[2px]">
                  <ChatRuntimeBadge status={thread.pendingMessageCount > 0 ? "running" : "completed"} />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-lg font-black tracking-tight text-slate-900 dark:text-white">
                  {thread.title}
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
              <div className="mt-1 text-[10px] font-mono text-slate-400">{formatRelativeChatTime(thread.lastMessageAt)}</div>
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
          className="absolute inset-y-0 right-0 flex w-12 translate-x-full items-center justify-center border-l border-status-red/15 bg-status-red/10 text-status-red opacity-0 transition-all duration-150 ease-out group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100 disabled:translate-x-0 disabled:opacity-100"
        >
          {deletingThreadId === thread.id ? <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2.1} /> : <Trash2 className="h-4 w-4" strokeWidth={2.1} />}
        </button>
      </div>
    ))}
  </div>
);
