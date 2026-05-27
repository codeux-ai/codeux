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
import type { AgentPresetRecord } from "../types.js";

export const useChatPageData = (options?: { composerRef?: RefObject<HTMLTextAreaElement>; messagesRef?: RefObject<HTMLDivElement> }) => {
  const cache = useMessageCache();
  const { selectedProject } = useProjectData();

  const { data: execution, loading: executionLoading } = useExecutions(selectedProject?.id || null);
  const { data: effectiveSettings, loading: effectiveSettingsLoading } = useProjectEffectiveSettings(selectedProject?.id || null);

  const [chatMode, setChatMode] = useState<"threads" | "invocations">("threads");
  const routedInvocationIdRef = useRef<string | null>(null);

  const threadData = useChatThreadData({
    selectedProject,
    cache,
    execution,
    composerRef: options?.composerRef,
    messagesRef: options?.messagesRef,
  });

  const [deferredAgentPresets, setDeferredAgentPresets] = useState<AgentPresetRecord[]>([]);

  const invocationData = useInvocationPaneData({
    selectedProject,
    cache,
    agentPresets: deferredAgentPresets,
  });

  const { connections, agentPresets, loading, manualRefreshing, refreshThreads } = useChatPageResources({
    selectedProject,
    cache,
    chatMode,
    threadData,
    invocationData,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    const invocationId = params.get("invocation");
    if (mode === "invocations") {
      setChatMode("invocations");
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
    refreshThreads,
    refreshMessages: threadData.refreshMessages,
    refreshInvocationMessages: invocationData.refreshInvocationMessages,
    activateThread: threadData.activateThread,
    activateInvocation: invocationData.activateInvocation,
    handleCompactThread: threadData.handleCompactThread,
    handleSend: threadData.handleSend,
    handleDeleteThread: threadData.handleDeleteThread,
    createThreadForCompose: threadData.createThreadForCompose,
    threadIndex: threadData.threadIndex,
    invocationIndex: invocationData.invocationIndex,
    selectedProject,
    feedback: threadData.feedback,
    clearFeedback: threadData.clearFeedback,
    isConfirmOpen: threadData.isConfirmOpen,
    confirmOptions: threadData.confirmOptions,
    handleConfirm: threadData.handleConfirm,
    handleCancel: threadData.handleCancel,
  };
};
