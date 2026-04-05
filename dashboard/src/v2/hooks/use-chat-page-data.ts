import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type {
  AgentConnection,
  ChatThread,
  ExecutionInvocationRecord,
  ChatMessageRecord,
} from "../types.js";
import type {
  DashboardRealtimeServerMessage,
  ExecutionDashboardSnapshot,
  ExecutionConnectionSummary,
} from "../../types.js";
import { useMessageCache } from "./useMessageCache.js";
import { useProjectData } from "../context/project-data.js";
import {
  fetchConversationThreads,
  fetchProjectConnections,
} from "../lib/connection-api.js";
import {
  isDetailLoading,
  isListLoading,
  resolveSelectedItemId,
} from "../lib/chat-page-state-utils.js";
import { fetchProjectInvocations } from "../lib/invocation-api.js";
import { subscribeToDashboardRealtime } from "../../lib/realtime/dashboard-realtime-client.js";
import { useExecutions } from "../../hooks/useExecutions.js";
import { getProjectWorkerOptions, type WorkerRoutingPreference } from "../lib/project-worker-options.js";
import { buildConnectionIndex } from "../lib/chat-entity-index.js";
import { useProjectEffectiveSettings } from "./use-project-effective-settings.js";
import { type RefObject } from "preact";
import { useChatThreadData, removeThread, upsertMessage, isWorkingMessage } from "./use-chat-thread-data.js";
import { useInvocationPaneData } from "./use-invocation-pane-data.js";
import { upsertChatThread } from "../lib/chat-thread-utils.js";

const areConnectionsEqual = (left: AgentConnection[], right: AgentConnection[]): boolean => (
  left.length === right.length
  && left.every((connection, index) => {
    const candidate = right[index];
    return Boolean(candidate)
      && candidate.id === connection.id
      && candidate.updatedAt === connection.updatedAt
      && candidate.status === connection.status
      && candidate.threadCount === connection.threadCount
      && candidate.messageCount === connection.messageCount
      && candidate.pendingInboxCount === connection.pendingInboxCount
      && candidate.activeDispatchCount === connection.activeDispatchCount;
  })
);

const toAgentConnection = (connection: ExecutionConnectionSummary): AgentConnection => ({
  id: connection.id,
  connectionKey: connection.connectionKey,
  displayName: connection.displayName,
  role: connection.role as AgentConnection["role"],
  transport: connection.transport,
  status: connection.status as AgentConnection["status"],
  capabilities: {
    instruction: connection.instruction || undefined,
    model: connection.model || undefined,
    labels: connection.labels,
    listenMode: connection.listenMode,
    machineName: connection.machineName || undefined,
    platform: connection.platform || undefined,
    arch: connection.arch || undefined,
    localExecutionRuntime: connection.localExecutionRuntime || undefined,
  },
  lastHeartbeatAt: connection.lastHeartbeatAt,
  createdAt: connection.lastHeartbeatAt || new Date().toISOString(),
  updatedAt: connection.lastHeartbeatAt || new Date().toISOString(),
  projectIds: connection.projectIds,
  activeProjectIds: connection.activeProjectIds,
  tasksRunCount: connection.tasksRunCount,
  threadCount: connection.threadCount,
  messageCount: connection.messageCount,
  pendingInboxCount: connection.pendingInboxCount,
  activeDispatchCount: connection.activeDispatchCount,
});

export const useChatPageData = (options?: { composerRef?: RefObject<HTMLTextAreaElement>; messagesRef?: RefObject<HTMLDivElement> }) => {
  const cache = useMessageCache();
  const { selectedProject } = useProjectData();

  const { data: execution, loading: executionLoading } = useExecutions(selectedProject?.id || null);
  const { data: effectiveSettings, loading: effectiveSettingsLoading } = useProjectEffectiveSettings(selectedProject?.id || null);

  const workerRouting: WorkerRoutingPreference | null = effectiveSettings ? {
    executionMode: effectiveSettings.settings.workers.executionMode,
    virtualWorkerProvider: effectiveSettings.settings.workers.virtualWorkerProvider,
  } : null;

  const { options: workerOptions } = getProjectWorkerOptions(execution, workerRouting, executionLoading);

  const [chatMode, setChatMode] = useState<"threads" | "invocations">("threads");
  const [connections, setConnections] = useState<AgentConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const threadData = useChatThreadData({
    selectedProject,
    cache,
    execution,
    workerRouting,
    composerRef: options?.composerRef,
    messagesRef: options?.messagesRef,
  });

  const invocationData = useInvocationPaneData({
    selectedProject,
    cache,
  });

  const connectionIndex = useMemo(() => buildConnectionIndex(connections), [connections]);

  const setConnectionsSnapshot = useCallback((nextConnections: AgentConnection[]): void => {
    setConnections((current) => areConnectionsEqual(current, nextConnections) ? current : nextConnections);
  }, []);

  const {
    setThreadsSnapshot,
    setMessagesSnapshot,
    setSelectedThreadId,
    setError: setThreadError,
    activateThread,
    selectedThreadIdRef,
    threadsRef,
    refreshMessages,
  } = threadData;

  const {
    setInvocationsSnapshot,
    setInvocationMessagesSnapshot,
    setSelectedInvocationId,
    setError: setInvocationError,
    activateInvocation,
    selectedInvocationIdRef,
    refreshInvocationMessages,
  } = invocationData;

  const refreshThreads = useCallback(async (refreshOptions?: { manual?: boolean; foreground?: boolean; mode?: "threads" | "invocations" | "both" }): Promise<void> => {
    console.log("[ChatPageData] refreshThreads called", { refreshOptions, mode: refreshOptions?.mode, manual: refreshOptions?.manual, foreground: refreshOptions?.foreground });
    if (!selectedProject) {
      setThreadsSnapshot([]);
      setInvocationsSnapshot([]);
      setConnections([]);
      setMessagesSnapshot([]);
      setInvocationMessagesSnapshot([]);
      setSelectedThreadId(null);
      setSelectedInvocationId(null);
      setThreadError(null);
      setInvocationError(null);
      return;
    }

    if (refreshOptions?.manual) {
      setManualRefreshing(true);
    }
    if (refreshOptions?.foreground) {
      setLoading(true);
    }

    const refreshMode = refreshOptions?.mode || (refreshOptions?.manual ? chatMode : "both");

    try {
      const fetchPromises: Promise<any>[] = [];
      let fetchThreadsIndex = -1;
      let fetchConnectionsIndex = -1;
      let fetchInvocationsIndex = -1;

      if (refreshMode === "both" || refreshMode === "threads") {
        fetchThreadsIndex = fetchPromises.length;
        fetchPromises.push(fetchConversationThreads(selectedProject.id));
        fetchConnectionsIndex = fetchPromises.length;
        fetchPromises.push(fetchProjectConnections(selectedProject.id));
      }

      if (refreshMode === "both" || refreshMode === "invocations") {
        fetchInvocationsIndex = fetchPromises.length;
        fetchPromises.push(fetchProjectInvocations(selectedProject.id));
      }

      const results = await Promise.all(fetchPromises);

      if (fetchThreadsIndex !== -1 && fetchConnectionsIndex !== -1) {
        const nextThreads = results[fetchThreadsIndex] as ChatThread[];
        const nextConnections = results[fetchConnectionsIndex] as AgentConnection[];

        cache.setThreads(selectedProject.id, nextThreads);
        cache.setConnections(selectedProject.id, nextConnections);

        setThreadsSnapshot(nextThreads);
        setConnectionsSnapshot(nextConnections);

        const userThreads = nextThreads.filter((t) => t.scope === "project");
        const nextSelectedId = resolveSelectedItemId(userThreads, selectedThreadIdRef.current);
        const nextSelectedThread = userThreads.find((thread) => thread.id === nextSelectedId) || null;
        await activateThread(nextSelectedId, {
          foreground: Boolean(refreshOptions?.foreground),
          preferredThread: nextSelectedThread,
        });
      }

      if (fetchInvocationsIndex !== -1) {
        const nextInvocations = results[fetchInvocationsIndex] as ExecutionInvocationRecord[];

        cache.setInvocations(selectedProject.id, nextInvocations);
        setInvocationsSnapshot(nextInvocations);

        const nextSelectedInvocationId = resolveSelectedItemId(nextInvocations, selectedInvocationIdRef.current);
        const nextSelectedInvocation = nextInvocations.find((inv) => inv.id === nextSelectedInvocationId) || null;
        await activateInvocation(nextSelectedInvocationId, {
          foreground: Boolean(refreshOptions?.foreground),
          preferredInvocation: nextSelectedInvocation,
        });
      }

      setThreadError(null);
      setInvocationError(null);
    } catch (fetchError) {
      const errorMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
      setThreadError(errorMsg);
      setInvocationError(errorMsg);
    } finally {
      if (refreshOptions?.manual) {
        setManualRefreshing(false);
      }
      if (refreshOptions?.foreground) {
        setLoading(false);
      }
    }
  }, [
    activateInvocation,
    activateThread,
    cache,
    chatMode,
    selectedInvocationIdRef,
    selectedProject,
    selectedThreadIdRef,
    setConnectionsSnapshot,
    setInvocationError,
    setInvocationMessagesSnapshot,
    setInvocationsSnapshot,
    setSelectedInvocationId,
    setSelectedThreadId,
    setThreadError,
    setMessagesSnapshot,
    setThreadsSnapshot,
  ]);

  const projectId = selectedProject?.id;
  useEffect(() => {
    if (!projectId || !selectedProject) {
      return;
    }

    console.log("[ChatPageData] Initializing data for project:", projectId);

    const cachedThreads = cache.getThreads(projectId);
    const cachedConnections = cache.getConnections(projectId);
    const cachedInvocations = cache.getInvocations(projectId);

    if (cachedThreads && cachedInvocations) {
      setThreadsSnapshot(cachedThreads);
      setConnectionsSnapshot(cachedConnections || []);
      setInvocationsSnapshot(cachedInvocations);

      const userCachedThreads = cachedThreads.filter((t) => t.scope === "project");
      const nextSelectedId = resolveSelectedItemId(userCachedThreads, selectedThreadIdRef.current);
      const nextSelectedThread = userCachedThreads.find((thread) => thread.id === nextSelectedId) || null;
      setSelectedThreadId(null);
      setMessagesSnapshot([]);
      void activateThread(nextSelectedId, {
        foreground: false,
        preferredThread: nextSelectedThread,
      });

      const nextSelectedInvocationId = resolveSelectedItemId(cachedInvocations, selectedInvocationIdRef.current);
      const nextSelectedInvocation = cachedInvocations.find((inv) => inv.id === nextSelectedInvocationId) || null;
      setSelectedInvocationId(null);
      setInvocationMessagesSnapshot([]);
      void activateInvocation(nextSelectedInvocationId, {
        foreground: false,
        preferredInvocation: nextSelectedInvocation,
      });

      void refreshThreads();
      return;
    }

    setThreadsSnapshot([]);
    setInvocationsSnapshot([]);
    setConnections([]);
    setMessagesSnapshot([]);
    setInvocationMessagesSnapshot([]);
    setSelectedThreadId(null);
    setSelectedInvocationId(null);
    void refreshThreads({ foreground: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }

    const scopes = [`project:${selectedProject.id}`];
    if (threadData.selectedThreadId) {
      scopes.push(`thread:${threadData.selectedThreadId}`);
    }

    return subscribeToDashboardRealtime(scopes, (message: DashboardRealtimeServerMessage) => {
      if (message.type === "snapshot_required") {
        void refreshThreads();
        if (threadData.selectedThreadId) {
          void refreshMessages(threadData.selectedThreadIdRef.current, { force: true });
        }
        if (selectedInvocationIdRef.current) {
          void refreshInvocationMessages(selectedInvocationIdRef.current, { force: true });
        }
        return;
      }

      if (message.type !== "event") {
        return;
      }

      if (message.event.eventType === "project.execution.updated") {
        const payload = message.event.payload as ExecutionDashboardSnapshot;
        const nextConnections = (payload.connections || []).map((connection) => toAgentConnection(connection));
        cache.setConnections(selectedProject.id, nextConnections);
        setConnectionsSnapshot(nextConnections);

        void refreshThreads({ mode: "invocations" });
        return;
      }

      if (message.event.eventType === "conversation.thread.updated") {
        const thread = message.event.payload as ChatThread;
        if (thread.projectId !== selectedProject.id) {
          return;
        }
        const currentThreads = cache.getThreads(selectedProject.id) || threadsRef.current;
        const nextThreads = upsertChatThread(currentThreads, thread);
        cache.setThreads(selectedProject.id, nextThreads);
        setThreadsSnapshot(nextThreads);
        if (!selectedThreadIdRef.current) {
          void activateThread(thread.id, { preferredThread: thread });
        }
        return;
      }

      if (message.event.eventType === "conversation.thread.deleted") {
        const payload = message.event.payload as { threadId: string; projectId: string };
        if (payload.projectId !== selectedProject.id) {
          return;
        }
        const currentThreads = cache.getThreads(selectedProject.id) || threadsRef.current;
        const nextThreads = removeThread(currentThreads, payload.threadId);
        cache.setThreads(selectedProject.id, nextThreads);
        setThreadsSnapshot(nextThreads);
        cache.deleteMessages(payload.threadId);
        if (selectedThreadIdRef.current === payload.threadId) {
          const userNextThreads = nextThreads.filter((t) => t.scope === "project");
          const nextSelection = resolveSelectedItemId(userNextThreads, null);
          const nextSelectedThread = userNextThreads.find((thread) => thread.id === nextSelection) || null;
          void activateThread(nextSelection, { preferredThread: nextSelectedThread });
        }
        return;
      }

      if (message.event.eventType === "conversation.message.created") {
        const realtimeMessage = message.event.payload as ChatMessageRecord;
        const cachedMessages = cache.getMessages(realtimeMessage.threadId) || [];
        const nextMessages = upsertMessage(cachedMessages, realtimeMessage);
        cache.setMessages(realtimeMessage.threadId, nextMessages);
        if (realtimeMessage.threadId === selectedThreadIdRef.current) {
          setMessagesSnapshot(nextMessages);
        }
      }
    });
  }, [
    activateThread,
    cache,
    refreshInvocationMessages,
    refreshMessages,
    refreshThreads,
    selectedInvocationIdRef,
    selectedProject,
    threadData.selectedThreadId,
    setConnectionsSnapshot,
    setMessagesSnapshot,
    setThreadsSnapshot,
    threadsRef,
  ]);

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
    message.direction === "dashboard_to_connection" && message.deliveryStatus !== "processed"
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
    assigningRoute: threadData.assigningRoute,
    compacting: threadData.compacting,
    error: threadData.error || invocationData.error,
    selectedThread: threadData.selectedThread,
    selectedInvocation: invocationData.selectedInvocation,
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
    handleAssignRoute: threadData.handleAssignRoute,
    handleCompactThread: threadData.handleCompactThread,
    handleSend: threadData.handleSend,
    handleDeleteThread: threadData.handleDeleteThread,
    createThreadForCompose: threadData.createThreadForCompose,
    workerOptions,
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
