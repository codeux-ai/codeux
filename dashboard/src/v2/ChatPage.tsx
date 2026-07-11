import type { ComponentChildren, FunctionComponent } from "preact";
import { useCallback, useEffect, useRef, useState, useMemo } from "preact/hooks";
import {
  ArrowUp,
  Ban,
  RefreshCw,
  TimerReset,
} from "lucide-preact";
import { buildPresetIndex } from "./lib/chat-entity-index.js";
import { ChatThreadHeader } from "./components/chat/ChatThreadHeader.js";
import { ChatPageShell } from "./components/chat/ChatPageShell.js";
import { ChatRail } from "./components/chat/ChatRail.js";
import { ThreadListCard } from "./components/chat/ThreadListCard.js";
import { InvocationListCard } from "./components/chat/InvocationListCard.js";
import { ChatRailPlaceholder, EmptyChat, LoadingChat } from "./components/chat/ChatEmptyState.js";
import { NoProjectAssistantPanel } from "./components/chat/NoProjectAssistantPanel.js";
import { EmptyState } from "./components/ui/EmptyState.js";
import { MessageCircle } from "lucide-preact";
import { ChatMessageBubble } from "./components/chat/ChatMessageBubble.js";
import { ChatCreateAppQuickActions } from "./components/chat/ChatCreateAppQuickActions.js";
import { SpeechInputButton } from "./components/speech/SpeechInputButton.js";
import { useChatPageData } from "./hooks/use-chat-page-data.js";
import { formatInvocationPurpose, formatInvocationDuration, InvocationContextChips } from "./components/chat/invocation-display.js";
import { InvocationMessageBubble } from "./components/chat/InvocationMessageBubble.js";
import { InvocationRoutingWidget } from "./components/chat/widgets/InvocationRoutingWidget.js";
import { InvocationContainerWidget } from "./components/chat/widgets/InvocationContainerWidget.js";
import { TruncatedSystemBubble } from "./components/chat/TruncatedSystemBubble.js";
import { WorkingBubble } from "./components/chat/WorkingBubble.js";
import { CinematicStage } from "./components/chat/cinematic/CinematicStage.js";
import { ConfirmDialog } from "./components/ui/ConfirmDialog.js";
import { ActionFeedbackRegion } from "./components/ui/ActionFeedbackRegion.js";
import { ProviderLogo } from "./components/ui/ProviderLogo.js";
import { AgentAvatarSvg } from "./components/agents/AgentAvatarSvg.js";
import { generateRandomAgentAvatar } from "./lib/agent-avatar.js";
import { formatInvocationRetryAt } from "./lib/invocation-retry-time.js";
import type { ChatMessageRecord, ExecutionInvocationRecord, Sprint, Task } from "./types.js";
import { cancelExecutionInvocation, resetInvocationUsageLimitTimer, restartExecutionInvocation, type InvocationRestartMode } from "./lib/invocation-api.js";
import { useActionFeedback } from "./hooks/use-action-feedback.js";
import {
  formatTokenCount,
  mergeChatToolMessages,
  mergeInvocationToolMessages
} from "./lib/chat-widget-view-models.js";
import { clearChatDraftFromUrl, readChatDraftFromLocation } from "./lib/no-project-chat-assistant.js";
import { resolveChatLiveEntities, type ChatLiveEntityWidget } from "./lib/chat-live-entities.js";
import { STATUS_MESSAGE_MIN_INTERVAL_MS } from "./lib/agent-humor-messages.js";


const EMPTY_LIVE_ENTITIES: readonly ChatLiveEntityWidget[] = [];
const EMPTY_LIVE_SPRINTS: readonly Sprint[] = [];
const EMPTY_LIVE_TASKS: readonly Task[] = [];

const formatInvocationErrorCategory = (value: ExecutionInvocationRecord["lastErrorCategory"]): string | null => {
  switch (value) {
    case "RATE_LIMITED":
      return "Rate limit";
    case "QUOTA_EXHAUSTED":
      return "Quota reset";
    case "AUTH_FAILURE":
      return "Auth failure";
    case "PROVIDER_NOT_FOUND":
      return "Provider missing";
    case "UNKNOWN":
      return "Error";
    default:
      return null;
  }
};

const hasUsageLimitTimer = (invocation: ExecutionInvocationRecord | null | undefined): invocation is ExecutionInvocationRecord => {
  return Boolean(
    invocation
      && (invocation.status === "running" || invocation.status === "paused")
      && invocation.lastRetryAfterIso
      && (invocation.lastErrorCategory === "QUOTA_EXHAUSTED" || invocation.lastErrorCategory === "RATE_LIMITED")
  );
};

const getTranscriptJoiner = (before: string, after: string): string => {
  if (!before || !after) {
    return "";
  }
  return /\s$/.test(before) || /^\s/.test(after) ? "" : " ";
};

type ComposerStatusTone = "disabled" | "ready" | "sending" | "queued" | "sent" | "failed";

interface ComposerStatusViewModel {
  tone: ComposerStatusTone;
  visibleText: string;
  liveText: string;
  disabledReason: string | null;
}

const getLatestDashboardMessage = (messages: readonly ChatMessageRecord[]): ChatMessageRecord | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.direction === "dashboard_to_connection") {
      return message;
    }
  }
  return null;
};

const buildComposerStatus = (input: {
  activeConnectionName: string | null;
  error: string | null;
  latestDashboardMessage: ChatMessageRecord | null;
  pendingDashboardMessages: number;
  selectedProject: boolean;
  sending: boolean;
  trimmedInput: string;
}): ComposerStatusViewModel => {
  const disabledReason = !input.selectedProject
    ? "Select a project before sending a message."
    : input.sending
      ? "Message is already sending."
      : !input.trimmedInput
        ? "Write a message before sending."
        : null;

  if (!input.selectedProject) {
    const noProjectReason = "Select a project before sending a message.";
    return {
      tone: "disabled",
      visibleText: noProjectReason,
      liveText: noProjectReason,
      disabledReason,
    };
  }

  if (input.sending) {
    return {
      tone: "sending",
      visibleText: "Sending message to Code UX...",
      liveText: "Sending message.",
      disabledReason,
    };
  }

  if (input.error) {
    return {
      tone: "failed",
      visibleText: `Send failed: ${input.error}`,
      liveText: `Failed: ${input.error}`,
      disabledReason,
    };
  }

  if (input.pendingDashboardMessages > 0) {
    const queuedLabel = `${input.pendingDashboardMessages} message${input.pendingDashboardMessages === 1 ? "" : "s"} queued for delivery.`;
    return {
      tone: "queued",
      visibleText: `${queuedLabel} A worker or listener will claim the next turn.`,
      liveText: queuedLabel,
      disabledReason,
    };
  }

  if (input.latestDashboardMessage?.deliveryStatus === "failed") {
    return {
      tone: "failed",
      visibleText: "The latest dashboard message failed. Review the draft or try again.",
      liveText: "Latest message failed.",
      disabledReason,
    };
  }

  if (input.latestDashboardMessage?.deliveryStatus === "pending") {
    return {
      tone: "queued",
      visibleText: "Latest message is queued and waiting for a worker route.",
      liveText: "Latest message queued.",
      disabledReason,
    };
  }

  if (input.latestDashboardMessage?.deliveryStatus === "delivered") {
    return {
      tone: "sent",
      visibleText: "Message sent to Code UX and waiting for the worker response.",
      liveText: "Message sent.",
      disabledReason,
    };
  }

  if (input.latestDashboardMessage?.deliveryStatus === "processed") {
    return {
      tone: "sent",
      visibleText: "Latest message was processed by the worker route.",
      liveText: "Latest message processed.",
      disabledReason,
    };
  }

  if (input.trimmedInput) {
    const target = input.activeConnectionName ? ` to ${input.activeConnectionName}` : "";
    return {
      tone: "ready",
      visibleText: `Ready to send${target}. Enter sends; Shift+Enter adds a newline.`,
      liveText: "Composer ready.",
      disabledReason,
    };
  }

  return {
    tone: "disabled",
    visibleText: "Write a message to enable send. Queued delivery will be shown here.",
    liveText: "Composer disabled until a message is entered.",
    disabledReason,
  };
};

const COMPOSER_STATUS_TONE_CLASS: Record<ComposerStatusTone, string> = {
  disabled: "border-black/[0.06] bg-black/[0.025] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.025] dark:text-slate-400",
  ready: "border-signal-500/20 bg-signal-500/[0.08] text-signal-700 dark:text-signal-300",
  sending: "border-signal-500/25 bg-signal-500/[0.10] text-signal-700 dark:text-signal-300",
  queued: "border-status-amber/25 bg-status-amber/[0.10] text-status-amber",
  sent: "border-signal-500/20 bg-signal-500/[0.08] text-signal-700 dark:text-signal-300",
  failed: "border-status-red/25 bg-status-red/[0.08] text-status-red",
};

export const ChatPage: FunctionComponent = () => {
  const messagesRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const composerSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const [workingTimerPhase, setWorkingTimerPhase] = useState<"starting" | "working" | null>(null);
  const [restartingInvocation, setRestartingInvocation] = useState<{ id: string; mode: InvocationRestartMode } | null>(null);
  const [cancellingInvocationId, setCancellingInvocationId] = useState<string | null>(null);
  const [resettingUsageLimitInvocationId, setResettingUsageLimitInvocationId] = useState<string | null>(null);
  const [noProjectDraft, setNoProjectDraft] = useState<string | null>(() => (
    typeof window === "undefined" ? null : readChatDraftFromLocation(window.location)
  ));
  const invocationFeedback = useActionFeedback();

  const {
    chatMode,
    setChatMode,
    threads,
    invocations,
    invocationTotalCount,
    hasMoreInvocations,
    selectedThreadId,
    selectedInvocationId,
    messages,
    invocationMessages,
    input,
    setInput,
    deletingThreadId,
    sending,
    compacting,
    error,
    selectedThread,
    selectedInvocation,
    selectedAgentPreset,
    activeConnection,
    pendingDashboardMessages,
    hasWorkingReply,
    threadsLoading,
    threadMessagesLoading,
    connections,
    invocationsLoading,
    invocationMessagesLoading,
    invocationsLoadingMore,
    refreshThreads,
    loadMoreInvocations,
    activateThread,
    activateInvocation,
    handleCompactThread,
    handleCancelActiveTurn,
    isCancelling,
    handleSend,
    handleCreateAppQuickaction,
    navigateHistory,
    handleDeleteThread,
    handleRenameThread,
    createThreadForCompose,
    threadIndex,
    invocationIndex,
    selectedProject,
    projectInitializationStateLoading,
    canCreateInitialAppQuickactions,
    agentPresets,
    feedback,
    clearFeedback,
    isConfirmOpen,
    confirmOptions,
    handleConfirm,
    handleCancel,
    execution,
    executionLoading,
    executionLoaded,
    projectTasks,
    projectTasksLoading,
    projectTasksLoaded,
    sprintKeyPrefix,
    liveEntityContext,
  } = useChatPageData({ composerRef, messagesRef });

  useEffect(() => {
    if (typeof window === "undefined" || selectedProject) {
      return;
    }
    setNoProjectDraft(readChatDraftFromLocation(window.location));
  }, [selectedProject]);

  const projectThreads = useMemo(() => threads.filter((thread) => thread.scope === "project"), [threads]);
  const displayedInvocationTotal = invocationTotalCount ?? invocations.length;
  const runningInvocationCount = useMemo(
    () => invocations.filter((invocation) => invocation.status === "running").length,
    [invocations],
  );
  const showInitialCreateActions = !projectInitializationStateLoading && canCreateInitialAppQuickactions;
  const widgetLiveData = useMemo(() => ({
    projectId: selectedProject?.id ?? null,
    projectTasks,
    projectTasksLoading,
    projectTasksLoaded,
    execution,
    executionLoading,
    executionLoaded,
    sprintKeyPrefix,
  }), [
    execution,
    executionLoaded,
    executionLoading,
    projectTasks,
    projectTasksLoaded,
    projectTasksLoading,
    selectedProject?.id,
    sprintKeyPrefix,
  ]);
  const liveEntitySprints = liveEntityContext?.sprints ?? EMPTY_LIVE_SPRINTS;
  const liveEntityTasks = liveEntityContext?.tasks ?? EMPTY_LIVE_TASKS;
  const liveEntitySprintKeyPrefix = liveEntityContext?.sprintKeyPrefix ?? sprintKeyPrefix;
  const threadLiveEntitiesByMessageId = useMemo(() => {
    const entitiesByMessageId = new Map<string, readonly ChatLiveEntityWidget[]>();
    if (liveEntitySprints.length === 0 && liveEntityTasks.length === 0) {
      return entitiesByMessageId;
    }
    for (const message of messages) {
      entitiesByMessageId.set(message.id, resolveChatLiveEntities({
        sprints: liveEntitySprints,
        tasks: liveEntityTasks,
        sprintKeyPrefix: liveEntitySprintKeyPrefix,
        message,
      }));
    }
    return entitiesByMessageId;
  }, [liveEntitySprints, liveEntitySprintKeyPrefix, liveEntityTasks, messages]);
  const visibleInvocationMessages = useMemo(
    () => mergeInvocationToolMessages(invocationMessages),
    [invocationMessages],
  );
  const renderedThreadMessages = useMemo(
    () => mergeChatToolMessages(messages),
    [messages],
  );
  const trimmedComposerInput = input.trim();
  const latestDashboardMessage = useMemo(() => getLatestDashboardMessage(messages), [messages]);
  const composerStatus = useMemo(() => buildComposerStatus({
    activeConnectionName: activeConnection?.displayName ?? null,
    error,
    latestDashboardMessage,
    pendingDashboardMessages,
    selectedProject: Boolean(selectedProject),
    sending,
    trimmedInput: trimmedComposerInput,
  }), [
    activeConnection?.displayName,
    error,
    latestDashboardMessage,
    pendingDashboardMessages,
    selectedProject,
    sending,
    trimmedComposerInput,
  ]);
  const sendDisabled = Boolean(composerStatus.disabledReason);
  const sendButtonLabel = sending
    ? "Sending message"
    : composerStatus.disabledReason
      ? `Send message unavailable: ${composerStatus.disabledReason}`
      : "Send message";
  const invocationLiveEntitiesByMessageId = useMemo(() => {
    const entitiesByMessageId = new Map<string, readonly ChatLiveEntityWidget[]>();
    if (liveEntitySprints.length === 0 && liveEntityTasks.length === 0) {
      return entitiesByMessageId;
    }
    for (const message of visibleInvocationMessages) {
      entitiesByMessageId.set(message.id, resolveChatLiveEntities({
        sprints: liveEntitySprints,
        tasks: liveEntityTasks,
        sprintKeyPrefix: liveEntitySprintKeyPrefix,
        message,
        invocation: selectedInvocation,
      }));
    }
    return entitiesByMessageId;
  }, [
    liveEntitySprints,
    liveEntitySprintKeyPrefix,
    liveEntityTasks,
    selectedInvocation,
    visibleInvocationMessages,
  ]);

  const handlePromptSuggestionSelect = useCallback((prompt: string) => {
    void handleSend(prompt).finally(() => {
      requestAnimationFrame(() => {
        composerRef.current?.focus({ preventScroll: true });
      });
    });
  }, [handleSend]);

  const rememberComposerSelection = useCallback((element: HTMLTextAreaElement): void => {
    composerSelectionRef.current = {
      start: element.selectionStart,
      end: element.selectionEnd,
    };
  }, []);

  const handleSpeechTranscript = useCallback((transcript: string) => {
    const trimmedTranscript = transcript.trim();
    if (!trimmedTranscript) {
      return;
    }

    const composer = composerRef.current;
    const sourceValue = composer?.value ?? input;
    const rememberedSelection = composerSelectionRef.current;
    const canUseRememberedSelection = Boolean(
      rememberedSelection
        && rememberedSelection.start >= 0
        && rememberedSelection.end >= rememberedSelection.start
        && rememberedSelection.end <= sourceValue.length
    );

    const selectionStart = canUseRememberedSelection ? rememberedSelection!.start : sourceValue.length;
    const selectionEnd = canUseRememberedSelection ? rememberedSelection!.end : sourceValue.length;
    const before = sourceValue.slice(0, selectionStart);
    const after = sourceValue.slice(selectionEnd);
    const insert = `${getTranscriptJoiner(before, trimmedTranscript)}${trimmedTranscript}${getTranscriptJoiner(trimmedTranscript, after)}`;
    const nextValue = `${before}${insert}${after}`;
    const nextCaret = before.length + insert.length;

    setInput(nextValue);
    requestAnimationFrame(() => {
      const nextComposer = composerRef.current;
      if (!nextComposer) {
        return;
      }
      nextComposer.focus();
      nextComposer.style.height = "auto";
      nextComposer.style.height = `${nextComposer.scrollHeight}px`;
      nextComposer.setSelectionRange(nextCaret, nextCaret);
      composerSelectionRef.current = { start: nextCaret, end: nextCaret };
    });
  }, [input, setInput]);

  const submitComposerMessage = useCallback(async (): Promise<void> => {
    if (sendDisabled) {
      return;
    }
    await handleSend();
    requestAnimationFrame(() => {
      composerRef.current?.focus({ preventScroll: true });
    });
  }, [handleSend, sendDisabled]);

  const handleRestartInvocation = useCallback(async (mode: InvocationRestartMode = "retry_full_prompt") => {
    if (!selectedInvocation || selectedInvocation.status !== "failed" || restartingInvocation || cancellingInvocationId || resettingUsageLimitInvocationId) {
      return;
    }
    setRestartingInvocation({ id: selectedInvocation.id, mode });
    invocationFeedback.setPending(mode === "continue_session" ? "Continuing planning session..." : "Restarting planning session...", { autoDismiss: false });
    try {
      const result = await restartExecutionInvocation(selectedInvocation.id, mode);
      invocationFeedback.setSuccess(mode === "continue_session" ? "Planning continuation queued." : "Planning restart queued.");
      await refreshThreads({ mode: "invocations" });
      if (result.invocationId) {
        void activateInvocation(result.invocationId, { foreground: true });
      }
    } catch (error) {
      invocationFeedback.setError(error instanceof Error ? error.message : String(error), {
        retryAction: () => void handleRestartInvocation(mode),
        retryLabel: "Retry",
        autoDismiss: false,
      });
    } finally {
      setRestartingInvocation(null);
    }
  }, [activateInvocation, cancellingInvocationId, invocationFeedback, refreshThreads, resettingUsageLimitInvocationId, restartingInvocation, selectedInvocation]);

  const handleCancelInvocation = useCallback(async () => {
    if (!selectedInvocation || selectedInvocation.status !== "running" || cancellingInvocationId || restartingInvocation || resettingUsageLimitInvocationId) {
      return;
    }
    setCancellingInvocationId(selectedInvocation.id);
    invocationFeedback.setPending("Cancelling invocation...", { autoDismiss: false });
    try {
      const result = await cancelExecutionInvocation(selectedInvocation.id);
      invocationFeedback.setSuccess(result.cancelled ? "Invocation cancelled." : (result.message || "Invocation was already stopped."));
      await refreshThreads({ mode: "invocations" });
      void activateInvocation(selectedInvocation.id, { foreground: true });
    } catch (error) {
      invocationFeedback.setError(error instanceof Error ? error.message : String(error), {
        retryAction: () => void handleCancelInvocation(),
        retryLabel: "Retry",
        autoDismiss: false,
      });
    } finally {
      setCancellingInvocationId(null);
    }
  }, [activateInvocation, cancellingInvocationId, invocationFeedback, refreshThreads, resettingUsageLimitInvocationId, restartingInvocation, selectedInvocation]);

  const handleResetUsageLimitTimer = useCallback(async () => {
    if (!hasUsageLimitTimer(selectedInvocation) || cancellingInvocationId || restartingInvocation || resettingUsageLimitInvocationId) {
      return;
    }
    setResettingUsageLimitInvocationId(selectedInvocation.id);
    invocationFeedback.setPending("Resetting usage limit timer...", { autoDismiss: false });
    try {
      const result = await resetInvocationUsageLimitTimer(selectedInvocation.id);
      invocationFeedback.setSuccess(result.reset ? "Usage limit timer reset." : (result.message || "Usage limit timer was already cleared."));
      await refreshThreads({ mode: "invocations" });
      void activateInvocation(selectedInvocation.id, { foreground: true });
    } catch (error) {
      invocationFeedback.setError(error instanceof Error ? error.message : String(error), {
        retryAction: () => void handleResetUsageLimitTimer(),
        retryLabel: "Retry",
        autoDismiss: false,
      });
    } finally {
      setResettingUsageLimitInvocationId(null);
    }
  }, [activateInvocation, cancellingInvocationId, invocationFeedback, refreshThreads, resettingUsageLimitInvocationId, restartingInvocation, selectedInvocation]);

  // Build lookups from agentPresets
  const presetIdMap = useMemo(() => {
    return buildPresetIndex(agentPresets);
  }, [agentPresets]);

  const presetNameMap = useMemo(() => {
    const map = new Map<string, typeof agentPresets[0]>();
    for (const preset of agentPresets) {
      map.set(preset.name.toLowerCase(), preset);
    }
    return map;
  }, [agentPresets]);

  // Resolve agent preset for a message
  const getLinkedAgentPreset = (message: typeof messages[0]) => {
    // a. message.metadata.agentPresetId
    let presetId = message.metadata?.agentPresetId as string | undefined;

    // b. message.metadata.agentId
    if (!presetId) {
      presetId = message.metadata?.agentId as string | undefined;
    }

    // c. selected thread runtime metadata
    if (!presetId && selectedThread?.runtimeState) {
      presetId = (selectedThread.runtimeState as any).agentPresetId || (selectedThread.runtimeState as any).agentId;
    }

    // d. active connection data where available
    if (!presetId && activeConnection) {
      presetId = (activeConnection as any).agentPresetId || (activeConnection as any).agentId || activeConnection.id;
    }

    if (presetId && presetIdMap.has(presetId)) {
      return presetIdMap.get(presetId);
    }

    // e. message.metadata.agentName
    let presetName = message.metadata?.agentName as string | undefined;

    // f. selected thread runtime metadata
    if (!presetName && selectedThread?.runtimeState) {
      presetName = (selectedThread.runtimeState as any).agentName;
    }

    // g. active connection data
    if (!presetName && activeConnection) {
      presetName = activeConnection.displayName;
    }

    if (presetName) {
      const matched = presetNameMap.get(presetName.toLowerCase());
      if (matched) return matched;
    }

    return undefined;
  };

  useEffect(() => {
    if (!messagesRef.current) return;
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (hasWorkingReply) {
      setWorkingTimerPhase("starting");
      const timer = setTimeout(() => {
        setWorkingTimerPhase("working");
      }, STATUS_MESSAGE_MIN_INTERVAL_MS);
      return () => clearTimeout(timer);
    } else {
      setWorkingTimerPhase(null);
    }
  }, [hasWorkingReply]);

  const renderRail = () => {
    if (chatMode === "threads") {
      return (
        <ChatRail
          title="Threads"
          count={projectThreads.length}
          secondaryTitle="Listeners"
          secondaryCount={connections.length}
        >
          {threadsLoading ? (
            <LoadingChat label="Loading threads" />
          ) : projectThreads.length === 0 ? (
            <ChatRailPlaceholder
              message="Fresh installs start with a quiet rail. Create the first thread and Code UX will keep routing, pending replies, and history organized here."
            />
          ) : (
            <ThreadListCard
              threads={projectThreads}
              selectedThreadId={selectedThreadId}
              onSelect={(threadId) => {
                const preferredThread = threadIndex.get(threadId) || null;
                void activateThread(threadId, { preferredThread });
              }}
              onDelete={(threadId) => void handleDeleteThread(threadId)}
              deletingThreadId={deletingThreadId}
            />
          )}
        </ChatRail>
      );
    }

    return (
      <ChatRail
        title="Invocations"
        count={displayedInvocationTotal}
        onReachEnd={() => {
          if (chatMode === "invocations" && hasMoreInvocations && !invocationsLoadingMore) {
            void loadMoreInvocations();
          }
        }}
      >
        {invocationsLoading ? (
          <LoadingChat label="Loading invocations" />
        ) : invocations.length === 0 ? (
          <ChatRailPlaceholder
            title="Invocation Rail Standby"
            message="Execution transcripts appear here after planning, chat, or runtime work creates invocation records."
            actionLabel="Awaiting Runtime"
          />
        ) : (
          <InvocationListCard
            invocations={invocations}
            selectedInvocationId={selectedInvocationId}
            agentPresets={agentPresets}
            sprintKeyPrefix={sprintKeyPrefix}
            onSelect={(invocationId) => {
              const preferredInvocation = invocationIndex.get(invocationId) || null;
              void activateInvocation(invocationId, { preferredInvocation });
            }}
          />
        )}
        {invocations.length > 0 && (
          <div className="mt-4 rounded-2xl border border-black/[0.06] bg-black/[0.025] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:border-white/[0.06] dark:bg-white/[0.025]">
            {invocationsLoadingMore
              ? "Loading more invocations..."
              : hasMoreInvocations
                ? `Showing ${invocations.length} of ${invocationTotalCount}`
                : `Showing all ${displayedInvocationTotal}`}
          </div>
        )}
      </ChatRail>
    );
  };

  const renderDetail = () => {
    if (chatMode === "stage") {
      // Prefer the preset of the most recent agent reply; runtime replies may
      // use authorType "system", so direction is the authoritative boundary.
      // Fall back to the thread/connection-linked preset.
      let stagePreset;
      for (let i = messages.length - 1; i >= 0 && !stagePreset; i--) {
        const message = messages[i];
        if (message.direction !== "dashboard_to_connection") {
          stagePreset = getLinkedAgentPreset(message);
        }
      }
      if (!stagePreset) {
        stagePreset = getLinkedAgentPreset({ metadata: undefined } as (typeof messages)[0]);
      }
      return (
        <>
          <ConfirmDialog isOpen={isConfirmOpen} options={confirmOptions} onConfirm={handleConfirm} onCancel={handleCancel} />
          {feedback.status !== "idle" && (
            <div className="absolute top-4 right-4 z-50 shadow-lg">
              <ActionFeedbackRegion status={feedback.status} message={feedback.message} onDismiss={clearFeedback} />
            </div>
          )}
          <div id="chat-panel" role="tabpanel" aria-labelledby="tab-stage" className="flex flex-1 min-h-0 flex-col overflow-hidden">
            <CinematicStage
              selectedProject={selectedProject}
              selectedThread={selectedThread}
              messages={messages}
              threadMessagesLoading={threadsLoading || threadMessagesLoading}
              hasAwaitedReply={hasWorkingReply}
              invocations={invocations}
              sending={sending}
              error={error}
              input={input}
              setInput={setInput}
              onSpeechTranscript={handleSpeechTranscript}
              handleSend={handleSend}
              handleCreateAppQuickaction={handleCreateAppQuickaction}
              initialEligibilityLoaded={!projectInitializationStateLoading}
              canCreateInitialAppQuickactions={canCreateInitialAppQuickactions}
              navigateHistory={navigateHistory}
              composerRef={composerRef}
              activeConnection={activeConnection}
              agentPreset={stagePreset}
              onOpenThreads={() => setChatMode("threads")}
            />
          </div>
        </>
      );
    }

    if (chatMode === "threads") {
      return (
        <>
          <ConfirmDialog isOpen={isConfirmOpen} options={confirmOptions} onConfirm={handleConfirm} onCancel={handleCancel} />
          {feedback.status !== "idle" && (
            <div className="absolute top-4 right-4 z-50 shadow-lg">
              <ActionFeedbackRegion status={feedback.status} message={feedback.message} onDismiss={clearFeedback} />
            </div>
          )}
          <ChatThreadHeader
            thread={selectedThread}
            onCompact={() => void handleCompactThread()}
            onCancelActiveTurn={() => void handleCancelActiveTurn()}
            onRename={handleRenameThread}
            isCompacting={compacting}
            isCancelling={isCancelling}
            actionFeedbackStatus={feedback.status}
            actionFeedbackMessage={feedback.message}
            error={error}
          />

          <div id="chat-panel" role="tabpanel" aria-labelledby="tab-threads" className="flex-1 min-h-0 flex flex-col overflow-y-auto">
          <div role="log" aria-label="Message history" aria-live={messages.length > 0 && !threadsLoading && !threadMessagesLoading ? "polite" : "off"} aria-atomic="false" aria-relevant="additions" ref={messagesRef} className="flex-1 min-h-0 space-y-6 px-6 py-6">
            {threadsLoading ? (
              <LoadingChat label="Loading conversation" />
            ) : !selectedThread ? (
              <EmptyChat
                tone="thread"
                message="Create the first project thread to open a clean operator channel. Messages will be stored in Code UX and queued for the selected worker route."
              />
            ) : threadMessagesLoading ? (
              <LoadingChat label="Loading conversation" />
            ) : messages.length === 0 ? (
              <EmptyChat
                tone="messages"
                message="This thread is ready. The next dashboard message will be stored in Code UX and queued for a listening MCP connection or virtual worker route."
              />
            ) : (
              <>
                {renderedThreadMessages.map((message) => {
                  const preset = getLinkedAgentPreset(message);
                  return (
                    <ChatMessageBubble
                      key={message.id}
                      message={message}
                      allMessages={messages}
                      agentAvatarConfig={preset?.avatarConfig}
                      agentName={preset?.name}
                      widgetLiveData={widgetLiveData}
                      liveEntities={threadLiveEntitiesByMessageId.get(message.id) ?? EMPTY_LIVE_ENTITIES}
                      onPromptSuggestionSelect={handlePromptSuggestionSelect}
                    />
                  );
                })}
                {hasWorkingReply && workingTimerPhase === "starting" ? (
                  <InvocationContainerWidget
                    containerPhase="starting"
                    providerName={selectedThread?.runtimeState?.providerLabel ?? selectedThread?.runtimeState?.virtualProvider ?? null}
                    modelName={selectedThread?.runtimeState?.modelLabel ?? null}
                    agentName={activeConnection?.displayName || null}
                  />
                ) : hasWorkingReply && workingTimerPhase === "working" ? (
                  <WorkingBubble displayName={activeConnection?.displayName || null} runtimeState={selectedThread?.runtimeState} phase={workingTimerPhase} />
                ) : null}
              </>
            )}
          </div>
          </div>

          <div className="shrink-0 border-t border-black/[0.05] p-5 dark:border-white/[0.05]">
            {selectedProject && !hasWorkingReply && runningInvocationCount === 0 && !sending && !error && (
              <div className="mb-3">
                <ChatCreateAppQuickActions
                  hasProject
                  showInitialCreateActions={showInitialCreateActions}
                  onSelect={(kind) => void handleCreateAppQuickaction(kind)}
                />
              </div>
            )}
            <div className={`rounded-2xl border bg-black/[0.03] p-3 focus-within:border-signal-500/30 dark:bg-white/[0.03] ${error ? 'border-status-red/50 dark:border-status-red/50' : 'border-black/[0.06] dark:border-white/[0.06]'}`}>
              <label htmlFor="message-composer" className="sr-only">Message</label>
              <textarea
                id="message-composer"
                aria-describedby="composer-help composer-status"
                ref={composerRef}
                value={input}
                rows={1}
                placeholder={activeConnection ? "Ask anything..." : "Write a project note or queue a message..."}
                className="max-h-[180px] min-h-[38px] w-full resize-none bg-transparent px-2 py-2 text-[15px] min-w-0 leading-relaxed text-slate-900 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-slate-600"
                onInput={(event) => {
                  const element = event.currentTarget;
                  element.style.height = "auto";
                  element.style.height = `${element.scrollHeight}px`;
                  rememberComposerSelection(element);
                  setInput(element.value);
                }}
                onFocus={(event) => rememberComposerSelection(event.currentTarget)}
                onClick={(event) => rememberComposerSelection(event.currentTarget)}
                onSelect={(event) => rememberComposerSelection(event.currentTarget)}
                onKeyUp={(event) => rememberComposerSelection(event.currentTarget)}
                onKeyDown={(event) => {
                  if (event.isComposing) {
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submitComposerMessage();
                    return;
                  }
                  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                    const element = event.currentTarget;
                    // Single-line content has no ambiguous cursor movement, so history
                    // recall always applies there. Multi-line (Shift+Enter) text only
                    // recalls history when the caret is at the true start/end of the
                    // whole value — otherwise Up/Down should move between lines as usual.
                    const isSingleLine = !element.value.includes("\n");
                    const atStart = element.selectionStart === 0 && element.selectionEnd === 0;
                    const atEnd = element.selectionStart === element.value.length && element.selectionEnd === element.value.length;
                    const direction = event.key === "ArrowUp" ? "up" : "down";
                    const shouldRecall = direction === "up" ? (isSingleLine || atStart) : (isSingleLine || atEnd);
                    if (shouldRecall && navigateHistory(direction)) {
                      event.preventDefault();
                      requestAnimationFrame(() => {
                        if (!composerRef.current) return;
                        composerRef.current.style.height = "auto";
                        composerRef.current.style.height = `${composerRef.current.scrollHeight}px`;
                        const pos = direction === "up" ? 0 : composerRef.current.value.length;
                        composerRef.current.setSelectionRange(pos, pos);
                        composerSelectionRef.current = { start: pos, end: pos };
                      });
                    }
                  }
                }}
              />
              <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <div id="composer-help" className="text-[10px] font-mono text-slate-400">
                    {activeConnection
                      ? `${activeConnection.displayName} · ${activeConnection.status} · Enter sends`
                      : "Messages will stay queued until a listener claims or is assigned to this thread · Enter sends · Shift+Enter newline"}
                  </div>
                  <div
                    id="composer-status"
                    role={composerStatus.tone === "failed" ? "alert" : "status"}
                    aria-live={composerStatus.tone === "failed" ? "assertive" : "polite"}
                    aria-atomic="true"
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold leading-relaxed ${COMPOSER_STATUS_TONE_CLASS[composerStatus.tone]}`}
                  >
                    {composerStatus.visibleText}
                  </div>
                </div>
                <div className="sr-only" aria-live={composerStatus.tone === "failed" ? "assertive" : "polite"} aria-atomic="true">
                  {composerStatus.liveText}
                </div>
                <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
                  <SpeechInputButton
                    disabled={!selectedProject || sending}
                    projectId={selectedProject?.id ?? null}
                    onTranscript={handleSpeechTranscript}
                    className="h-11 min-w-[7.5rem] sm:min-w-[8.75rem]"
                  />
                  <button
                    aria-label={sendButtonLabel}
                    aria-busy={sending ? "true" : "false"}
                    aria-describedby="composer-help composer-status"
                    type="button"
                    onClick={() => void submitComposerMessage()}
                    disabled={sendDisabled}
                    className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[1rem] transition-all ${
                      sendDisabled && !sending
                        ? "cursor-not-allowed bg-black/[0.06] text-slate-400 shadow-none dark:bg-white/[0.06]"
                        : sending
                          ? "cursor-wait bg-signal-500/50 text-white dark:text-void-900 shadow-none motion-safe:scale-95"
                          : "bg-signal-500 text-white dark:text-void-900 shadow-[0_0_24px_rgba(0,224,160,0.28)] hover:bg-signal-400 motion-safe:hover:scale-105 motion-safe:active:scale-95"
                    }`}
                  >
                    {sending ? <RefreshCw className="h-4 w-4 animate-spin text-void-900/70 motion-reduce:animate-none" /> : <ArrowUp className="h-5 w-5" strokeWidth={2.5} />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      );
    }

    // Clean horizontal stat strip for the active invocation header — mirrors the
    // list card's label/value table, only meaningful entries are shown.
    const inv = selectedInvocation;
    const canRestartInvocation = inv?.status === "failed" && inv.type === "planning";
    const canCancelInvocation = inv?.status === "running";
    const canResetUsageLimitTimer = hasUsageLimitTimer(inv);
    const headerStatus = inv
      ? inv.status === "failed"
        ? { dot: "bg-status-red shadow-[0_0_6px_rgba(227,0,15,0.5)]", text: "text-status-red" }
        : inv.status === "running"
          ? { dot: "bg-signal-500 shadow-[0_0_6px_rgba(0,224,160,0.6)] animate-pulse", text: "text-signal-500" }
          : inv.status === "completed"
            ? { dot: "bg-[#00AB84] shadow-[0_0_6px_rgba(0,171,132,0.4)]", text: "text-[#00AB84]" }
            : { dot: "bg-slate-400", text: "text-slate-500" }
      : null;
    const headerDuration = inv ? formatInvocationDuration(inv.startedAt || inv.createdAt, inv.finishedAt) : null;
    const headerTotalTokens = inv ? (inv.totalTokens ?? ((inv.inputTokens ?? 0) + (inv.outputTokens ?? 0))) : 0;
    const retryAtLabel = formatInvocationRetryAt(inv?.lastRetryAfterIso);
    const headerStats: Array<{ label: string; value: ComponentChildren; tone?: string }> = [];
    if (inv && headerStatus) {
      headerStats.push({
        label: "Status",
        value: (
          <span className={`flex items-center gap-1.5 ${headerStatus.text}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${headerStatus.dot}`} />
            <span className="capitalize">{inv.status}</span>
          </span>
        ),
      });
      headerStats.push({ label: "Messages", value: inv.messageCount ?? 0 });
      if ((inv.inputTokens ?? 0) > 0) headerStats.push({ label: "Input", value: formatTokenCount(inv.inputTokens), tone: "text-signal-600 dark:text-signal-400" });
      if ((inv.outputTokens ?? 0) > 0) headerStats.push({ label: "Output", value: formatTokenCount(inv.outputTokens), tone: "text-purple-600 dark:text-purple-400" });
      if ((inv.cachedInputTokens ?? 0) > 0) headerStats.push({ label: "Cached", value: formatTokenCount(inv.cachedInputTokens), tone: "text-teal-600 dark:text-teal-400" });
      if (headerTotalTokens > 0) headerStats.push({ label: "Total", value: formatTokenCount(headerTotalTokens) });
      if (headerDuration) headerStats.push({ label: "Duration", value: headerDuration });
    }

    return (
      <>
        {invocationFeedback.feedback.status !== "idle" && (
          <div className="absolute top-4 right-4 z-50 shadow-lg">
            <ActionFeedbackRegion
              status={invocationFeedback.feedback.status}
              message={invocationFeedback.feedback.message}
              onDismiss={invocationFeedback.clearFeedback}
              retryAction={invocationFeedback.feedback.retryAction}
              retryLabel={invocationFeedback.feedback.retryLabel}
              autoDismiss={invocationFeedback.feedback.autoDismiss}
            />
          </div>
        )}
        <div className="shrink-0 border-b border-black/[0.05] px-6 py-6 dark:border-white/[0.05]">
          <div className="flex items-start gap-4">
            {/* Agent avatar or provider icon */}
            {selectedAgentPreset ? (
              <div className="w-11 h-11 rounded-[0.875rem] overflow-hidden border border-black/[0.06] dark:border-white/[0.06] bg-white/75 dark:bg-white/[0.04] flex items-center justify-center shrink-0">
                <AgentAvatarSvg config={selectedAgentPreset.avatarConfig || generateRandomAgentAvatar(selectedAgentPreset.name)} size={44} static />
              </div>
            ) : selectedInvocation?.provider ? (
              <div className="w-11 h-11 rounded-[0.875rem] flex items-center justify-center shrink-0 bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.06] dark:border-white/[0.06]">
                <ProviderLogo provider={selectedInvocation.provider} size={24} />
              </div>
            ) : null}

            <div className="min-w-0 flex-1 break-words">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-signal-500">
                  <span>Active Invocation</span>
                  {formatInvocationErrorCategory(selectedInvocation?.lastErrorCategory || null) && (
                    <span className="rounded-full border border-status-amber/25 bg-status-amber/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-status-amber">
                      {formatInvocationErrorCategory(selectedInvocation?.lastErrorCategory || null)}
                    </span>
                  )}
                  {selectedInvocation?.preservedAt && (
                    <span className="rounded-full border border-signal-500/25 bg-signal-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">
                      Preserved
                    </span>
                  )}
                </div>
                {(canRestartInvocation || canCancelInvocation || canResetUsageLimitTimer) && (
                  <div className="flex flex-wrap items-center gap-2">
                    {canResetUsageLimitTimer && (
                      <button
                        type="button"
                        onClick={() => void handleResetUsageLimitTimer()}
                        disabled={resettingUsageLimitInvocationId === inv.id}
                        aria-busy={resettingUsageLimitInvocationId === inv.id}
                        aria-label={resettingUsageLimitInvocationId === inv.id ? "Resetting usage limit timer" : "Reset usage limit timer"}
                        className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-signal-500/25 bg-signal-500/10 px-3 py-2 text-[12px] font-bold text-signal-700 transition hover:border-signal-500/40 hover:bg-signal-500/15 disabled:cursor-wait disabled:opacity-60 dark:text-signal-400"
                      >
                        <TimerReset className={`h-3.5 w-3.5 ${resettingUsageLimitInvocationId === inv.id ? "animate-pulse motion-reduce:animate-none" : ""}`} />
                        {resettingUsageLimitInvocationId === inv.id ? "Resetting..." : "Reset timer"}
                      </button>
                    )}
                    {canCancelInvocation && (
                      <button
                        type="button"
                        onClick={() => void handleCancelInvocation()}
                        disabled={cancellingInvocationId === inv.id}
                        aria-busy={cancellingInvocationId === inv.id}
                        aria-label={cancellingInvocationId === inv.id ? "Cancelling invocation" : "Cancel invocation"}
                        className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-status-red/25 bg-status-red/10 px-3 py-2 text-[12px] font-bold text-status-red transition hover:border-status-red/40 hover:bg-status-red/15 disabled:cursor-wait disabled:opacity-60"
                      >
                        <Ban className={`h-3.5 w-3.5 ${cancellingInvocationId === inv.id ? "animate-pulse motion-reduce:animate-none" : ""}`} />
                        {cancellingInvocationId === inv.id ? "Cancelling..." : "Cancel"}
                      </button>
                    )}
                    {canRestartInvocation && (
                      <>
                    <button
                      type="button"
                      onClick={() => void handleRestartInvocation("retry_full_prompt")}
                      disabled={restartingInvocation?.id === inv.id}
                      aria-busy={restartingInvocation?.id === inv.id && restartingInvocation.mode === "retry_full_prompt"}
                      aria-label={restartingInvocation?.id === inv.id && restartingInvocation.mode === "retry_full_prompt" ? "Restarting invocation" : "Restart invocation"}
                      className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-status-amber/25 bg-status-amber/10 px-3 py-2 text-[12px] font-bold text-status-amber transition hover:border-status-amber/40 hover:bg-status-amber/15 disabled:cursor-wait disabled:opacity-60"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${restartingInvocation?.id === inv.id && restartingInvocation.mode === "retry_full_prompt" ? "animate-spin motion-reduce:animate-none" : ""}`} />
                      {restartingInvocation?.id === inv.id && restartingInvocation.mode === "retry_full_prompt" ? "Restarting..." : "Restart"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRestartInvocation("continue_session")}
                      disabled={restartingInvocation?.id === inv.id}
                      aria-busy={restartingInvocation?.id === inv.id && restartingInvocation.mode === "continue_session"}
                      aria-label={restartingInvocation?.id === inv.id && restartingInvocation.mode === "continue_session" ? "Continuing invocation" : "Continue invocation"}
                      className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-signal-500/25 bg-signal-500/10 px-3 py-2 text-[12px] font-bold text-signal-700 transition hover:border-signal-500/40 hover:bg-signal-500/15 disabled:cursor-wait disabled:opacity-60 dark:text-signal-400"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${restartingInvocation?.id === inv.id && restartingInvocation.mode === "continue_session" ? "animate-spin motion-reduce:animate-none" : ""}`} />
                      {restartingInvocation?.id === inv.id && restartingInvocation.mode === "continue_session" ? "Continuing..." : "Continue"}
                    </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Title: purpose */}
              <h1 className="mt-1.5 font-display text-3xl font-black tracking-tight text-slate-900 dark:text-white">
                {formatInvocationPurpose(selectedInvocation?.type)}
              </h1>

              {/* Provider · model subline */}
              {selectedInvocation && (
                <div className="mt-1 flex items-center gap-1.5 text-[12px] text-slate-500 dark:text-slate-400">
                  {selectedInvocation.provider && <ProviderLogo provider={selectedInvocation.provider} size={14} />}
                  <span className="font-medium">
                    {selectedInvocation.provider || "—"}
                    {selectedInvocation.model ? <span className="text-slate-400 dark:text-slate-500"> · {selectedInvocation.model}</span> : null}
                  </span>
                  {selectedAgentPreset && (
                    <>
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                      <span className="font-medium">{selectedAgentPreset.name}</span>
                    </>
                  )}
                </div>
              )}

              {/* Sprint key / task number — linked to their respective pages */}
              {selectedInvocation && (
                <div className="mt-2.5 empty:hidden">
                  <InvocationContextChips invocation={selectedInvocation} sprintKeyPrefix={sprintKeyPrefix} />
                </div>
              )}

              {/* Clean horizontal stat strip */}
              {headerStats.length > 0 && (
                <div className="mt-3 flex w-full flex-wrap items-stretch divide-x-0 sm:divide-x divide-y sm:divide-y-0 divide-black/[0.06] overflow-hidden rounded-xl border border-black/[0.06] bg-black/[0.02] dark:divide-white/[0.06] dark:border-white/[0.06] dark:bg-white/[0.02]">
                  {headerStats.map((stat) => (
                    <div key={stat.label} className="flex flex-1 flex-col gap-0.5 whitespace-nowrap px-3.5 py-2">
                      <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
                        {stat.label}
                      </span>
                      <span className={`font-mono text-[13px] font-semibold tabular-nums ${stat.tone || "text-slate-700 dark:text-slate-200"}`}>
                        {stat.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {selectedInvocation?.lastErrorMessage && (
                <div className="mt-3 max-w-2xl text-sm leading-relaxed text-status-amber">
                  {selectedInvocation.lastErrorMessage}
                  {retryAtLabel && ` Retry at ${retryAtLabel}.`}
                  {canRestartInvocation && (
                    <span className="ml-1 font-medium text-status-amber/90">
                      Restart or continue is available.
                    </span>
                  )}
                </div>
              )}

              {/* Invocation id — tiny */}
              {selectedInvocation && (
                <div className="mt-2.5 font-mono text-[10px] text-slate-300 dark:text-slate-600">
                  {selectedInvocation.id}
                </div>
              )}
            </div>
          </div>
        </div>

        <div id="chat-panel" role="tabpanel" aria-labelledby="tab-invocations" className="flex-1 min-h-0 flex flex-col overflow-y-auto">
          <div role="log" aria-label="Message history" aria-live={visibleInvocationMessages.length > 0 && selectedInvocation && !invocationsLoading && !invocationMessagesLoading ? "polite" : "off"} aria-atomic="false" aria-relevant="additions" ref={messagesRef} className="flex-1 min-h-0 space-y-6 px-6 py-6">
          {invocationsLoading && !selectedInvocation ? (
            <LoadingChat label="Loading invocations" />
          ) : !selectedInvocation ? (
            <EmptyChat
              tone="invocations"
              message="Select an execution invocation to inspect the exact runtime transcript, retry state, and provider response trail."
            />
          ) : invocationMessagesLoading && invocationMessages.length === 0 ? (
            <LoadingChat label="Loading invocation transcript" />
          ) : (
            <>
              {error && (
                <div role="alert" aria-live="assertive" className="rounded-xl border border-status-red/25 bg-status-red/[0.08] px-3 py-2 text-xs font-semibold leading-relaxed text-status-red">
                  Transcript could not update: {error}. Use the invocation actions above when available, or switch to Threads to continue the conversation.
                </div>
              )}
              {invocationMessagesLoading && invocationMessages.length > 0 && (
                <div role="status" aria-live="polite" className="rounded-xl border border-black/[0.06] bg-white/75 px-3 py-2 text-xs font-medium text-slate-500 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
                  Refreshing transcript while keeping the current messages visible.
                </div>
              )}
              <InvocationRoutingWidget
                provider={selectedInvocation.provider}
                model={selectedInvocation.model}
                routingStatus={
                  selectedInvocation.status === "running" && selectedInvocation.messageCount === 0
                    ? "routing"
                    : selectedInvocation.status === "running" && selectedInvocation.messageCount > 0
                      ? "active"
                      : "done"
                }
              />
              <InvocationContainerWidget
                providerName={selectedInvocation.provider}
                modelName={selectedInvocation.model}
                agentName={selectedAgentPreset?.name ?? null}
                containerPhase={
                  selectedInvocation.status === "running" && selectedInvocation.messageCount === 0
                    ? "starting"
                    : selectedInvocation.status === "running" && selectedInvocation.messageCount > 0
                      ? "working"
                      : selectedInvocation.status === "failed" ? "failed" : "completed"
                }
              />
              {invocationMessages.length === 0 ? (
                <EmptyChat
                  tone="invocations"
                  title="Transcript Is Empty"
                  message="This read-only invocation has no stored messages yet. Wait for provider activity to be recorded, choose another invocation, or switch to Threads to send a message."
                />
              ) : (
                visibleInvocationMessages.map((message) => {
                  if (message.role === "system") {
                    return <TruncatedSystemBubble key={message.id} content={message.contentMarkdown || ""} />;
                  }
                  return (
                    <InvocationMessageBubble
                      key={message.id}
                      message={message}
                      agentAvatarConfig={message.role === "assistant" ? (selectedAgentPreset?.avatarConfig ?? null) : null}
                      agentName={message.role === "assistant" ? (selectedAgentPreset?.name ?? null) : null}
                      widgetLiveData={widgetLiveData}
                      liveEntities={invocationLiveEntitiesByMessageId.get(message.id) ?? EMPTY_LIVE_ENTITIES}
                    />
                  );
                })
              )}
            </>
          )}
        </div>
        </div>

        <div className="shrink-0 border-t border-black/[0.05] p-5 dark:border-white/[0.05]">
          <div className="rounded-[1.5rem] border border-black/[0.06] bg-black/[0.03] p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
            <div role="note" aria-label="Invocation transcript is read-only" className="min-h-[38px] w-full px-2 py-2 text-[15px] leading-relaxed text-slate-500 dark:text-slate-400">
              Invocation execution logs are read-only. Switch to Threads to communicate. Wait for this run to update or use available retry/cancel actions above.
            </div>
          </div>
        </div>
      </>
    );
  };

  if (!selectedProject) {
    return (
      <ChatPageShell
        selectedProject={null}
        chatMode="stage"
        onSetChatMode={setChatMode}
        onCreateThread={() => void createThreadForCompose()}
        pendingDashboardMessages={pendingDashboardMessages}
        threadCount={projectThreads.length}
        invocationCount={displayedInvocationTotal}
        runningInvocationCount={runningInvocationCount}
        error={error}
        title="Code UX Assistant"
        subtitle="Ask setup questions before a project exists, then continue through explicit dashboard actions."
        showProjectControls={false}
        railSlot={null}
        detailSlot={(
          <NoProjectAssistantPanel
            initialDraft={noProjectDraft}
            onInitialDraftConsumed={() => {
              setNoProjectDraft(null);
              if (typeof window !== "undefined") {
                clearChatDraftFromUrl(window);
              }
            }}
          />
        )}
      />
    );
  }

  return (
    <ChatPageShell
      selectedProject={selectedProject}
      chatMode={chatMode}
      onSetChatMode={setChatMode}
      onCreateThread={() => void createThreadForCompose()}
      pendingDashboardMessages={pendingDashboardMessages}
      threadCount={projectThreads.length}
      invocationCount={displayedInvocationTotal}
      runningInvocationCount={runningInvocationCount}
      error={error}
      railSlot={chatMode === "stage" ? null : renderRail()}
      detailSlot={renderDetail()}
    />
  );
};
