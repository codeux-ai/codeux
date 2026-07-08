import { h, type FunctionComponent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { AlertCircle, Zap, Activity, XCircle, PencilLine, Check, X, RefreshCw } from "lucide-preact";
import type { ChatThread } from "../../types.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import type { ActionFeedbackStatus } from "../../hooks/use-action-feedback.js";

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
  onCancelActiveTurn: () => void;
  onRename: (title: string) => Promise<unknown>;
  isCompacting: boolean;
  isCancelling: boolean;
  actionFeedbackStatus?: ActionFeedbackStatus;
  actionFeedbackMessage?: string | null;
  error?: string | null;
}

type ThreadSessionTone = "active" | "replay" | "new";

const SESSION_BADGE_CLASS: Record<ThreadSessionTone, string> = {
  active: "border-signal-500/30 bg-signal-500/20 text-signal-600 dark:text-signal-400",
  replay: "border-status-amber/30 bg-status-amber/20 text-status-amber",
  new: "border-slate-500/30 bg-slate-500/20 text-slate-600 dark:border-slate-400/30 dark:text-slate-300",
};

type CompactFeedbackTone = "pending" | "success" | "error";

const COMPACT_FEEDBACK_CLASS: Record<CompactFeedbackTone, string> = {
  pending: "border-signal-500/25 bg-signal-500/[0.08] text-signal-700 dark:text-signal-300",
  success: "border-signal-500/20 bg-signal-500/[0.08] text-signal-700 dark:text-signal-300",
  error: "border-status-red/25 bg-status-red/[0.08] text-status-red",
};

export const ChatThreadHeader: FunctionComponent<ChatThreadHeaderProps> = ({
  thread,
  onCompact,
  onCancelActiveTurn,
  onRename,
  isCompacting,
  isCancelling,
  actionFeedbackStatus = "idle",
  actionFeedbackMessage = null,
  error = null,
}) => {
  const assignedLabel = resolveAssignedLabel(thread);
  const interactionTokens = useInteractionTokens();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(thread?.title || "");
  const [renamePending, setRenamePending] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const isReplayRequired = thread?.runtimeState?.replayRequired;
  const hasActiveSession = thread?.runtimeState?.sessionIds && thread.runtimeState.sessionIds.length > 0;
  const titleErrorId = thread ? `thread-title-error-${thread.id}` : undefined;
  const compactFeedbackId = thread ? `thread-compact-feedback-${thread.id}` : undefined;
  const sessionTone: ThreadSessionTone = isReplayRequired ? "replay" : hasActiveSession ? "active" : "new";
  const sessionLabel = isReplayRequired ? "Replay Required" : hasActiveSession ? "Active Session" : "New/Compacted";
  const SessionIcon = isReplayRequired ? AlertCircle : hasActiveSession ? Activity : Check;
  const compactFeedback = isCompacting
    ? { tone: "pending" as const, message: "Compacting conversation. The transcript stays available while Code UX writes the compacted session." }
    : actionFeedbackStatus === "success" && actionFeedbackMessage === "Thread compacted."
      ? { tone: "success" as const, message: "Thread compacted. Future replies will start from the compacted session." }
      : error
        ? { tone: "error" as const, message: `Compaction or thread action failed: ${error}` }
        : null;

  useEffect(() => {
    if (!isEditingTitle) {
      setTitleDraft(thread?.title || "");
      setRenameError(null);
    }
  }, [isEditingTitle, thread?.id, thread?.title]);

  useEffect(() => {
    if (isEditingTitle) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditingTitle]);

  const cancelRename = (): void => {
    setTitleDraft(thread?.title || "");
    setRenameError(null);
    setIsEditingTitle(false);
  };

  const saveRename = async (): Promise<void> => {
    if (!thread || renamePending) {
      return;
    }

    const trimmedTitle = titleDraft.trim();
    if (!trimmedTitle) {
      setRenameError("Thread title is required.");
      return;
    }

    if (trimmedTitle === thread.title) {
      setIsEditingTitle(false);
      setRenameError(null);
      return;
    }

    setRenamePending(true);
    setRenameError(null);
    try {
      await onRename(trimmedTitle);
      setIsEditingTitle(false);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : String(error));
    } finally {
      setRenamePending(false);
    }
  };

  return (
    <div className="shrink-0 border-b border-black/[0.05] px-6 py-5 dark:border-white/[0.05]">
      <div className="flex flex-col sm:flex-row items-start sm:justify-between gap-4 sm:gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-signal-500">Active Thread</div>
            <span
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className={`inline-flex min-w-[9.5rem] items-center justify-center gap-1 rounded-sm border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider shadow-sm ${SESSION_BADGE_CLASS[sessionTone]}`}
            >
              <SessionIcon className="h-3 w-3" />
              <span className="sr-only">Status: </span>{sessionLabel}
            </span>
          </div>
          {isEditingTitle && thread ? (
            <div className="mt-2 min-w-0">
              <label htmlFor="thread-title-input" className="sr-only">Thread title</label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  id="thread-title-input"
                  ref={inputRef}
                  value={titleDraft}
                  disabled={renamePending}
                  aria-invalid={renameError ? "true" : "false"}
                  aria-describedby={renameError && titleErrorId ? titleErrorId : undefined}
                  onInput={(event) => {
                    setTitleDraft(event.currentTarget.value);
                    if (renameError) {
                      setRenameError(null);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      cancelRename();
                      return;
                    }
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void saveRename();
                    }
                  }}
                  className="min-h-11 min-w-0 flex-1 rounded-2xl border border-black/[0.08] bg-white/75 px-3 py-2 font-display text-xl font-semibold tracking-tight text-slate-900 outline-none transition focus:border-signal-500 focus:ring-2 focus:ring-signal-500/25 disabled:cursor-wait disabled:opacity-70 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white"
                />
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void saveRename()}
                    disabled={renamePending}
                    aria-busy={renamePending}
                    aria-label={renamePending ? "Saving thread title" : "Save thread title"}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-signal-500/25 bg-signal-500/15 text-signal-700 transition hover:border-signal-500/40 hover:bg-signal-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70 dark:text-signal-400 dark:focus-visible:ring-offset-void-900"
                    title="Save thread title"
                  >
                    {renamePending ? <RefreshCw className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Check className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={cancelRename}
                    disabled={renamePending}
                    aria-label="Cancel thread title edit"
                    className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-black/[0.08] bg-white/70 text-slate-500 transition hover:bg-black/[0.03] hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white dark:focus-visible:ring-offset-void-900"
                    title="Cancel thread title edit"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {renameError && titleErrorId && (
                <div id={titleErrorId} role="alert" className="mt-2 flex items-center gap-2 text-xs font-medium text-status-red">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {renameError}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-2 flex min-w-0 items-start gap-2">
              <h2 className="min-w-0 flex-1 break-words font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
                {thread?.title || "No Thread Selected"}
              </h2>
              {thread && (
                <button
                  type="button"
                  onClick={() => {
                    setTitleDraft(thread.title);
                    setRenameError(null);
                    setIsEditingTitle(true);
                  }}
                  aria-label={`Rename ${thread.title}`}
                  className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-black/[0.08] bg-white/70 text-slate-500 transition hover:bg-black/[0.03] hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white dark:focus-visible:ring-offset-void-900"
                  title="Rename thread"
                >
                  <PencilLine className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </div>
        <div className="text-left sm:text-right text-[10px] font-mono text-slate-400 w-full sm:w-auto min-w-0">
          <div className="mb-2 w-full">
            {thread ? `${thread.messageCount} messages` : "0 messages"}
          </div>
          <div className="flex flex-wrap items-center sm:justify-end gap-2 min-w-0">
            {thread && thread.pendingMessageCount > 0 && (
              <button
                type="button"
                onClick={onCancelActiveTurn}
                disabled={isCancelling}
                aria-busy={isCancelling}
                style={{
                  transitionProperty: "color, background-color, border-color, text-decoration-color, fill, stroke",
                  transitionDuration: interactionTokens.controlFeedback.duration,
                  transitionTimingFunction: interactionTokens.controlFeedback.ease,
                }}
                aria-label={isCancelling ? "Cancelling..." : "Cancel Request"}
                className={`inline-flex min-w-[160px] justify-center items-center gap-1.5 rounded-full border border-status-red/30 bg-status-red/[0.06] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-status-red hover:bg-status-red/[0.12] dark:border-status-red/30 dark:bg-status-red/[0.08] dark:hover:bg-status-red/[0.16] ${isCancelling ? 'cursor-wait opacity-70' : ''}`}
                title="Cancel Request"
              >
                <XCircle className={`h-3.5 w-3.5 ${isCancelling ? "animate-pulse text-status-red motion-reduce:animate-none" : ""}`} />
                {isCancelling ? "Cancelling..." : "Cancel Request"}
              </button>
            )}
            {thread && thread.messageCount > 0 && (
              <button
                type="button"
                onClick={onCompact}
                disabled={isCompacting}
                aria-busy={isCompacting}
                aria-describedby={compactFeedbackId}
                aria-label={isCompacting ? "Compacting conversation" : "Compact"}
                style={{
                  transitionProperty: "color, background-color, border-color, text-decoration-color, fill, stroke",
                  transitionDuration: interactionTokens.controlFeedback.duration,
                  transitionTimingFunction: interactionTokens.controlFeedback.ease,
                }}
                className={`inline-flex min-w-[160px] justify-center items-center gap-1.5 rounded-full border border-black/[0.08] bg-white/70 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 hover:bg-black/[0.03] hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white ${isCompacting ? 'cursor-wait opacity-70' : ''}`}
                title="Compact Conversation"
              >
                <Zap className={`h-3.5 w-3.5 ${isCompacting ? "animate-pulse text-signal-500 motion-reduce:animate-none" : ""}`} />
                {isCompacting ? "Compacting session..." : "Compact"}
              </button>
            )}
            <div className="inline-flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Worker:</span>
              <span className="rounded-full border border-black/[0.08] bg-white/70 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300 transition-colors duration-300">
                {assignedLabel}
              </span>
            </div>
          </div>
          <div
            id={compactFeedbackId}
            role={compactFeedback?.tone === "error" ? "alert" : "status"}
            aria-live={compactFeedback?.tone === "error" ? "assertive" : "polite"}
            aria-atomic="true"
            className={`mt-2 min-h-[2rem] rounded-xl border px-3 py-2 text-xs font-semibold leading-relaxed transition-colors ${
              compactFeedback
                ? COMPACT_FEEDBACK_CLASS[compactFeedback.tone]
                : "border-transparent bg-transparent text-slate-400"
            }`}
          >
            {compactFeedback?.message ?? <span className="sr-only">No compaction in progress.</span>}
          </div>
        </div>
      </div>
    </div>
  );
};
