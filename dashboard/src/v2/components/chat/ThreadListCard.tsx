import type { FunctionComponent } from "preact";
import { useState, useRef, useEffect } from "preact/hooks";
import { RefreshCw, Trash2, MessageCircle } from "lucide-preact";
import type { ChatThread } from "../../types.js";
import { formatRelativeChatTime } from "../../lib/chat-time.js";
import { ChatAvatar } from "./ChatAvatar.js";
import { ChatRuntimeBadge } from "./ChatRuntimeBadge.js";

const statusTone = (pendingCount: number): string => (
  pendingCount > 0 ? "text-status-amber" : "text-slate-400 dark:text-slate-500"
);

const ThreadListItem: FunctionComponent<{
  thread: ChatThread;
  selectedThreadId: string | null;
  onSelect: (threadId: string) => void;
  onDelete: (threadId: string) => void;
  deletingThreadId: string | null;
  threadBtnRef?: (el: HTMLButtonElement | null) => void;
}> = ({ thread, selectedThreadId, onSelect, onDelete, deletingThreadId, threadBtnRef }) => {
  const [confirming, setConfirming] = useState(false);
  const trashBtnRef = useRef<HTMLButtonElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const isMounted = useRef(false);

  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }
    if (confirming) {
      confirmBtnRef.current?.focus();
    } else {
      trashBtnRef.current?.focus();
    }
  }, [confirming]);

  return (
    <div className="group relative overflow-hidden rounded-[1.25rem]">
      <button
        ref={threadBtnRef}
        type="button"
        onClick={() => onSelect(thread.id)}
        className={`w-full rounded-[1.25rem] border px-4 py-3 pr-20 text-left transition-colors duration-150 ${
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
          <div className="shrink-0 text-right opacity-100 transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0">
            <div className={`text-[10px] font-bold uppercase tracking-[0.14em] ${statusTone(thread.pendingMessageCount)}`}>
              {thread.pendingMessageCount > 0 ? `${thread.pendingMessageCount} pending` : "synced"}
            </div>
            <div className="mt-1 text-[10px] font-mono text-slate-400">{formatRelativeChatTime(thread.lastMessageAt)}</div>
          </div>
        </div>
      </button>

      <div className="absolute inset-y-0 right-0 flex items-center pr-2">
        {confirming ? (
          <div className="flex items-center gap-1 bg-white dark:bg-void-900 p-1 rounded-xl shadow-sm border border-black/10 dark:border-white/10">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setConfirming(false);
              }}
              className="px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              ref={confirmBtnRef}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(thread.id);
              }}
              className="px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] bg-status-red text-white rounded-lg hover:bg-status-red/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900"
            >
              Confirm?
            </button>
          </div>
        ) : (
          <button
            ref={trashBtnRef}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setConfirming(true);
            }}
            disabled={deletingThreadId === thread.id}
            aria-label={`Delete ${thread.title}`}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-status-red/10 text-status-red opacity-0 transition-all duration-150 ease-out hover:bg-status-red/20 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900 disabled:opacity-50"
          >
            {deletingThreadId === thread.id ? <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2.1} /> : <Trash2 className="h-4 w-4" strokeWidth={2.1} />}
          </button>
        )}
      </div>
    </div>
  );
};

export const ThreadListCard: FunctionComponent<{
  threads: ChatThread[];
  selectedThreadId: string | null;
  onSelect: (threadId: string) => void;
  onDelete: (threadId: string) => void;
  deletingThreadId: string | null;
}> = ({ threads, selectedThreadId, onSelect, onDelete, deletingThreadId }) => {
  const listRef = useRef<HTMLDivElement>(null);

  const handleDelete = (threadId: string) => {
    const currentIndex = threads.findIndex(t => t.id === threadId);
    onDelete(threadId);

    setTimeout(() => {
      if (listRef.current) {
        const remainingButtons = Array.from(listRef.current.querySelectorAll<HTMLButtonElement>('button[aria-label^="Select "]'));

        if (remainingButtons.length > 0) {
          const nextIndex = Math.min(currentIndex, remainingButtons.length - 1);
          remainingButtons[nextIndex].focus();
        } else {
          const newThreadBtn = document.querySelector<HTMLButtonElement>('button[aria-label="New Thread"]') || document.querySelector<HTMLButtonElement>('button:has(svg.lucide-plus)');
          newThreadBtn?.focus();
        }
      }
    }, 150);
  };

  return (
    <div ref={listRef} className="space-y-3">
      {threads.map((thread) => (
        <ThreadListItem
          key={thread.id}
          thread={thread}
          selectedThreadId={selectedThreadId}
          onSelect={onSelect}
          onDelete={handleDelete}
          deletingThreadId={deletingThreadId}
          threadBtnRef={(el) => {
            if (el) {
              el.setAttribute("aria-label", `Select ${thread.title}`);
            }
          }}
        />
      ))}
    </div>
  );
};
