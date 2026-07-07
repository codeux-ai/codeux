import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useMessageCache } from "./useMessageCache.js";
import { useProjectData } from "../context/project-data.js";
import {
  isDetailLoading,
  isListLoading,
} from "../lib/chat-page-state-utils.js";
import { useExecutions } from "../../hooks/useExecutions.js";
import { buildConnectionIndex } from "../lib/chat-entity-index.js";
import { useProjectEffectiveSettings } from "./use-project-effective-settings.js";
import { type RefObject } from "preact";
import { useChatThreadData, isWorkingMessage } from "./use-chat-thread-data.js";
import { useInvocationPaneData } from "./use-invocation-pane-data.js";
import { useChatPageResources } from "./use-chat-page-resources.js";
import type { AgentPresetRecord, ExecutionInvocationRecord } from "../types.js";
import { useSprints } from "../../hooks/useSprints.js";
import { useProjectTasks } from "./use-project-tasks.js";

/** "stage" is the cinematic 3D chat view; threads/invocations are the classic panes. */
export type ChatMode = "stage" | "threads" | "invocations";

const CHAT_MODE_STORAGE_KEY = "codeux.chat.mode";

const isChatMode = (value: unknown): value is ChatMode =>
  value === "stage" || value === "threads" || value === "invocations";

export const getActiveInvocationPollingKey = (
  invocations: Pick<ExecutionInvocationRecord, "id" | "status">[],
): string => invocations
  .filter((invocation) => invocation.status === "running")
  .map((invocation) => invocation.id)
  .sort()
  .join(",");

const readStoredChatMode = (): ChatMode => {
  if (typeof window === "undefined") return "stage";
  try {
    const stored = window.localStorage.getItem(CHAT_MODE_STORAGE_KEY);
    return isChatMode(stored) ? stored : "stage";
  } catch {
    return "stage";
  }
};

export const useChatPageData = (options?: { composerRef?: RefObject<HTMLTextAreaElement>; messagesRef?: RefObject<HTMLDivElement> }) => {
  const cache = useMessageCache();
  const { selectedProject } = useProjectData();

  const { data: execution, loading: executionLoading } = useExecutions(selectedProject?.id || null);
  const { data: effectiveSettings, loading: effectiveSettingsLoading } = useProjectEffectiveSettings(selectedProject?.id || null);
  const { data: sprints } = useSprints(selectedProject?.id || null);
  const { tasks: projectTasks, loading: projectTasksLoading, loaded: projectTasksLoaded } = useProjectTasks(
    selectedProject?.id || null,
    selectedProject ? [selectedProject] : [],
    sprints,
    null,
    { enabled: Boolean(selectedProject) },
  );

  const [chatMode, setChatModeState] = useState<ChatMode>(readStoredChatMode);
  const setChatMode = (mode: ChatMode): void => {
    setChatModeState(mode);
    try {
      window.localStorage.setItem(CHAT_MODE_STORAGE_KEY, mode);
    } catch {
      // Private-mode storage failures should never break mode switching.
    }
  };
  const routedInvocationIdRef = useRef<string | null>(null);

  const [deferredAgentPresets, setDeferredAgentPresets] = useState<AgentPresetRecord[]>([]);

  const invocationData = useInvocationPaneData({
    selectedProject,
    cache,
    agentPresets: deferredAgentPresets,
  });

  const threadData = useChatThreadData({
    selectedProject,
    cache,
    execution,
    composerRef: options?.composerRef,
    messagesRef: options?.messagesRef,
  });

  const {
    connections,
    agentPresets,
    loading,
    manualRefreshing,
    invocationsLoadingMore,
    refreshThreads,
    loadMoreInvocations,
  } = useChatPageResources({
    selectedProject,
    cache,
    // The cinematic stage converses over threads, so it shares their data loading.
    chatMode: chatMode === "invocations" ? "invocations" : "threads",
    threadData,
    invocationData,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    const invocationId = params.get("invocation");
    if (isChatMode(mode)) {
      setChatModeState(mode);
    }
    if (!invocationId || routedInvocationIdRef.current === invocationId) {
      return;
    }
    routedInvocationIdRef.current = invocationId;
    void refreshThreads({ mode: "invocations" }).then(() => {
      void invocationData.activateInvocation(invocationId, { foreground: true });
    });
  }, [invocationData, refreshThreads]);

  const connectionIndex = useMemo(() => buildConnectionIndex(connections), [connections]);

  useEffect(() => {
    setDeferredAgentPresets(agentPresets);
  }, [agentPresets]);

  useEffect(() => {
    if (!options?.messagesRef?.current) return;
    if (options?.messagesRef?.current) {
      options.messagesRef.current.scrollTop = options.messagesRef.current.scrollHeight;
    }
  }, [threadData.messages, options?.messagesRef]);

  const activeInvocationKey = useMemo(
    () => getActiveInvocationPollingKey(invocationData.invocations),
    [invocationData.invocations],
  );

  const selectedInvocationRefreshKey = useMemo(() => {
    const selectedInvocation = invocationData.selectedInvocation;
    if (!selectedInvocation) {
      return null;
    }
    return [
      selectedInvocation.id,
      selectedInvocation.status,
      selectedInvocation.messageCount,
      selectedInvocation.lastMessageAt || "",
      selectedInvocation.updatedAt,
    ].join("|");
  }, [invocationData.selectedInvocation]);

  useEffect(() => {
    if (!selectedProject || !activeInvocationKey) {
      return;
    }

    const intervalSelectedInvocationId = invocationData.selectedInvocationId;

    const interval = window.setInterval(() => {
      void refreshThreads({ mode: "invocations" });
      const currentSelectedInvocationId = invocationData.selectedInvocationIdRef.current;
      if (currentSelectedInvocationId && currentSelectedInvocationId === intervalSelectedInvocationId) {
        void invocationData.refreshInvocationMessages(currentSelectedInvocationId, { force: true });
      }
    }, 3000);

    return () => {
      window.clearInterval(interval);
    };
  }, [
    activeInvocationKey,
    selectedInvocationRefreshKey,
    selectedProject,
    invocationData.selectedInvocationId,
    invocationData.refreshInvocationMessages,
    invocationData.selectedInvocationIdRef,
    refreshThreads,
  ]);

  const activeConnection = useMemo(() => {
    if (!threadData.selectedThread?.connectionId) {
      return null;
    }
    return connectionIndex.get(threadData.selectedThread.connectionId) || null;
  }, [connectionIndex, threadData.selectedThread]);

  const pendingDashboardMessages = threadData.messages.filter((message) => (
    message.direction === "dashboard_to_connection" && (message.deliveryStatus === "pending" || message.deliveryStatus === "delivered")
  )).length;

  const hasWorkingReply = useMemo(() => threadData.messages.some((message) => isWorkingMessage(message, threadData.messages)), [threadData.messages]);

  const hasProjectSnapshot = Boolean(selectedProject && cache.hasThreads(selectedProject.id));
  const hasThreadSnapshot = Boolean(
    threadData.selectedThreadId
    && (cache.hasMessages(threadData.selectedThreadId) || (threadData.selectedThread?.messageCount || 0) === 0)
  );
  const threadsLoading = isListLoading(selectedProject?.id || null, hasProjectSnapshot, loading);
  const threadMessagesLoading = isDetailLoading(threadData.selectedThreadId, hasThreadSnapshot, threadData.messagesLoading);

  const hasInvocationProjectSnapshot = Boolean(selectedProject && cache.hasInvocations(selectedProject.id));
  const hasInvocationSnapshot = Boolean(
    invocationData.selectedInvocationId
    && (cache.hasInvocationMessages(invocationData.selectedInvocationId) || (invocationData.selectedInvocation?.messageCount || 0) === 0)
  );
  const invocationsLoading = isListLoading(selectedProject?.id || null, hasInvocationProjectSnapshot, loading);
  const invocationMessagesLoading = isDetailLoading(invocationData.selectedInvocationId, hasInvocationSnapshot, invocationData.messagesLoading);

  return {
    chatMode,
    setChatMode,
    threads: threadData.threads,
    invocations: invocationData.invocations,
    invocationTotalCount: invocationData.invocationTotalCount,
    hasMoreInvocations: invocationData.hasMoreInvocations,
    connections,
    selectedThreadId: threadData.selectedThreadId,
    selectedInvocationId: invocationData.selectedInvocationId,
    messages: threadData.messages,
    invocationMessages: invocationData.invocationMessages,
    input: threadData.input,
    setInput: threadData.setInput,
    loading,
    messagesLoading: threadData.messagesLoading || invocationData.messagesLoading,
    manualRefreshing,
    deletingThreadId: threadData.deletingThreadId,
    sending: threadData.sending,
    compacting: threadData.compacting,
    error: threadData.error || invocationData.error,
    selectedThread: threadData.selectedThread,
    selectedInvocation: invocationData.selectedInvocation,
    selectedAgentPreset: invocationData.selectedAgentPreset,
    agentPresets: deferredAgentPresets,
    activeConnection,
    pendingDashboardMessages,
    hasWorkingReply,
    threadsLoading,
    threadMessagesLoading,
    invocationsLoading,
    invocationMessagesLoading,
    invocationsLoadingMore,
    refreshThreads,
    loadMoreInvocations,
    refreshMessages: threadData.refreshMessages,
    refreshInvocationMessages: invocationData.refreshInvocationMessages,
    activateThread: threadData.activateThread,
    activateInvocation: invocationData.activateInvocation,
    handleCompactThread: threadData.handleCompactThread,
    handleCancelActiveTurn: threadData.handleCancelActiveTurn,
    isCancelling: threadData.isCancelling,
    handleSend: threadData.handleSend,
    navigateHistory: threadData.navigateHistory,
    handleDeleteThread: threadData.handleDeleteThread,
    handleRenameThread: threadData.handleRenameThread,
    createThreadForCompose: threadData.createThreadForCompose,
    threadIndex: threadData.threadIndex,
    invocationIndex: invocationData.invocationIndex,
    selectedProject,
    execution,
    executionLoading,
    executionLoaded: Boolean(selectedProject && !executionLoading && execution.projectId === selectedProject.id),
    projectTasks,
    projectTasksLoading,
    projectTasksLoaded: Boolean(selectedProject && projectTasksLoaded),
    sprintKeyPrefix: effectiveSettings?.settings?.git?.sprintKeyPrefix || "SPR",
    feedback: threadData.feedback,
    clearFeedback: threadData.clearFeedback,
    isConfirmOpen: threadData.isConfirmOpen,
    confirmOptions: threadData.confirmOptions,
    handleConfirm: threadData.handleConfirm,
    handleCancel: threadData.handleCancel,
  };
};
