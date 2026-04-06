import { useCallback, useEffect, useState, useRef } from "preact/hooks";
import type { MutableRef } from "preact/hooks";
import type { AgentConnection, ChatThread, ExecutionInvocationRecord, ChatMessageRecord } from "../types.js";
import type { DashboardRealtimeServerMessage, ExecutionDashboardSnapshot, ExecutionConnectionSummary } from "../../types.js";
import { useMessageCache } from "./useMessageCache.js";
import { fetchConversationThreads, fetchProjectConnections } from "../lib/connection-api.js";
import { fetchProjectInvocations } from "../lib/invocation-api.js";
import { resolveSelectedItemId } from "../lib/chat-page-state-utils.js";
import { subscribeToDashboardRealtime } from "../../lib/realtime/dashboard-realtime-client.js";
import { upsertChatThread } from "../lib/chat-thread-utils.js";
import { removeThread, upsertMessage } from "./use-chat-thread-data.js";

export const areConnectionsEqual = (left: AgentConnection[], right: AgentConnection[]): boolean => (
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

export const toAgentConnection = (connection: ExecutionConnectionSummary): AgentConnection => ({
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

export const useChatPageResources = (options: {
  selectedProject: { id: string } | null;
  cache: ReturnType<typeof useMessageCache>;
  execution: ExecutionDashboardSnapshot | null;
  chatMode: "threads" | "invocations";
  threadData: {
    selectedThreadId: string | null;
    selectedThreadIdRef: MutableRef<string | null>;
    threadsRef: MutableRef<ChatThread[]>;
    setThreadsSnapshot: (threads: ChatThread[]) => void;
    setMessagesSnapshot: (messages: ChatMessageRecord[]) => void;
    setSelectedThreadId: (id: string | null) => void;
    setError: (error: string | null) => void;
    activateThread: (id: string | null, options?: { foreground?: boolean; preferredThread?: ChatThread | null }) => Promise<void>;
    refreshMessages: (id: string | null, options?: { foreground?: boolean; force?: boolean }) => Promise<void>;
  };
  invocationData: {
    selectedInvocationIdRef: MutableRef<string | null>;
    setInvocationsSnapshot: (invs: ExecutionInvocationRecord[]) => void;
    setInvocationMessagesSnapshot: (messages: any[]) => void;
    setSelectedInvocationId: (id: string | null) => void;
    setError: (error: string | null) => void;
    activateInvocation: (id: string | null, options?: { foreground?: boolean; preferredInvocation?: ExecutionInvocationRecord | null }) => Promise<void>;
    refreshInvocationMessages: (id: string | null, options?: { force?: boolean }) => Promise<void>;
  };
}) => {
  const { selectedProject, cache, execution, chatMode, threadData, invocationData } = options;

  const [connections, setConnections] = useState<AgentConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const refreshGuardRef = useRef<number>(0);

  const setConnectionsSnapshot = useCallback((nextConnections: AgentConnection[]): void => {
    setConnections((current) => areConnectionsEqual(current, nextConnections) ? current : nextConnections);
  }, []);

  // Keep execution out of dependency array to prevent infinite refresh loops on execution ticks
  const executionRef = useRef(execution);
  useEffect(() => {
    executionRef.current = execution;
  }, [execution]);

  const refreshThreads = useCallback(async (refreshOptions?: { manual?: boolean; foreground?: boolean; mode?: "threads" | "invocations" | "both" }): Promise<void> => {
    if (!selectedProject) {
      threadData.setThreadsSnapshot([]);
      invocationData.setInvocationsSnapshot([]);
      setConnections([]);
      threadData.setMessagesSnapshot([]);
      invocationData.setInvocationMessagesSnapshot([]);
      threadData.setSelectedThreadId(null);
      invocationData.setSelectedInvocationId(null);
      threadData.setError(null);
      invocationData.setError(null);
      return;
    }

    if (refreshOptions?.manual) {
      setManualRefreshing(true);
    }
    if (refreshOptions?.foreground) {
      setLoading(true);
    }

    const refreshMode = refreshOptions?.mode || (refreshOptions?.manual ? chatMode : "both");
    const currentGuard = ++refreshGuardRef.current;

    try {
      const fetchPromises: Promise<any>[] = [];
      let fetchThreadsIndex = -1;
      let fetchConnectionsIndex = -1;
      let fetchInvocationsIndex = -1;

      const currentExecution = executionRef.current;
      const hasExecutionConnections = Boolean(selectedProject?.id && currentExecution?.projectId === selectedProject.id);

      if (refreshMode === "both" || refreshMode === "threads") {
        fetchThreadsIndex = fetchPromises.length;
        fetchPromises.push(fetchConversationThreads(selectedProject.id));
        if (!hasExecutionConnections) {
          fetchConnectionsIndex = fetchPromises.length;
          fetchPromises.push(fetchProjectConnections(selectedProject.id));
        }
      }

      if (refreshMode === "both" || refreshMode === "invocations") {
        fetchInvocationsIndex = fetchPromises.length;
        fetchPromises.push(fetchProjectInvocations(selectedProject.id));
      }

      const results = await Promise.all(fetchPromises);

      if (currentGuard !== refreshGuardRef.current) {
        return;
      }

      if (fetchThreadsIndex !== -1) {
        const nextThreads = results[fetchThreadsIndex] as ChatThread[];
        const nextConnections = hasExecutionConnections
          ? (currentExecution?.connections || []).map((c) => toAgentConnection(c))
          : results[fetchConnectionsIndex] as AgentConnection[];

        cache.setThreads(selectedProject.id, nextThreads);
        cache.setConnections(selectedProject.id, nextConnections);

        threadData.setThreadsSnapshot(nextThreads);
        setConnectionsSnapshot(nextConnections);

        const userThreads = nextThreads.filter((t) => t.scope === "project");
        const nextSelectedId = resolveSelectedItemId(userThreads, threadData.selectedThreadIdRef.current);
        const nextSelectedThread = userThreads.find((thread) => thread.id === nextSelectedId) || null;
        await threadData.activateThread(nextSelectedId, {
          foreground: Boolean(refreshOptions?.foreground),
          preferredThread: nextSelectedThread,
        });
      }

      if (fetchInvocationsIndex !== -1) {
        const nextInvocations = results[fetchInvocationsIndex] as ExecutionInvocationRecord[];

        cache.setInvocations(selectedProject.id, nextInvocations);
        invocationData.setInvocationsSnapshot(nextInvocations);

        const nextSelectedInvocationId = resolveSelectedItemId(nextInvocations, invocationData.selectedInvocationIdRef.current);
        const nextSelectedInvocation = nextInvocations.find((inv) => inv.id === nextSelectedInvocationId) || null;
        await invocationData.activateInvocation(nextSelectedInvocationId, {
          foreground: Boolean(refreshOptions?.foreground),
          preferredInvocation: nextSelectedInvocation,
        });
      }

      threadData.setError(null);
      invocationData.setError(null);
    } catch (fetchError) {
      const errorMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
      threadData.setError(errorMsg);
      invocationData.setError(errorMsg);
    } finally {
      if (refreshOptions?.manual) {
        setManualRefreshing(false);
      }
      if (refreshOptions?.foreground) {
        setLoading(false);
      }
    }
  }, [
    invocationData.activateInvocation,
    threadData.activateThread,
    cache,
    chatMode,
    invocationData.selectedInvocationIdRef,
    selectedProject,
    threadData.selectedThreadIdRef,
    setConnectionsSnapshot,
    invocationData.setError,
    invocationData.setInvocationMessagesSnapshot,
    invocationData.setInvocationsSnapshot,
    invocationData.setSelectedInvocationId,
    threadData.setSelectedThreadId,
    threadData.setError,
    threadData.setMessagesSnapshot,
    threadData.setThreadsSnapshot,
  ]);

  const projectId = selectedProject?.id;
  useEffect(() => {
    if (!projectId || !selectedProject) {
      return;
    }

    const cachedThreads = cache.getThreads(projectId);
    const cachedConnections = cache.getConnections(projectId);
    const cachedInvocations = cache.getInvocations(projectId);

    if (cachedThreads && cachedInvocations) {
      threadData.setThreadsSnapshot(cachedThreads);
      setConnectionsSnapshot(cachedConnections || []);
      invocationData.setInvocationsSnapshot(cachedInvocations);

      const userCachedThreads = cachedThreads.filter((t) => t.scope === "project");
      const nextSelectedId = resolveSelectedItemId(userCachedThreads, threadData.selectedThreadIdRef.current);
      const nextSelectedThread = userCachedThreads.find((thread) => thread.id === nextSelectedId) || null;
      threadData.setSelectedThreadId(null);
      threadData.setMessagesSnapshot([]);
      void threadData.activateThread(nextSelectedId, {
        foreground: false,
        preferredThread: nextSelectedThread,
      });

      const nextSelectedInvocationId = resolveSelectedItemId(cachedInvocations, invocationData.selectedInvocationIdRef.current);
      const nextSelectedInvocation = cachedInvocations.find((inv) => inv.id === nextSelectedInvocationId) || null;
      invocationData.setSelectedInvocationId(null);
      invocationData.setInvocationMessagesSnapshot([]);
      void invocationData.activateInvocation(nextSelectedInvocationId, {
        foreground: false,
        preferredInvocation: nextSelectedInvocation,
      });

      void refreshThreads();
      return;
    }

    threadData.setThreadsSnapshot([]);
    invocationData.setInvocationsSnapshot([]);
    setConnections([]);
    threadData.setMessagesSnapshot([]);
    invocationData.setInvocationMessagesSnapshot([]);
    threadData.setSelectedThreadId(null);
    invocationData.setSelectedInvocationId(null);
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
          void threadData.refreshMessages(threadData.selectedThreadIdRef.current, { force: true });
        }
        if (invocationData.selectedInvocationIdRef.current) {
          void invocationData.refreshInvocationMessages(invocationData.selectedInvocationIdRef.current, { force: true });
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
        const currentThreads = cache.getThreads(selectedProject.id) || threadData.threadsRef.current;
        const nextThreads = upsertChatThread(currentThreads, thread);
        cache.setThreads(selectedProject.id, nextThreads);
        threadData.setThreadsSnapshot(nextThreads);
        if (!threadData.selectedThreadIdRef.current) {
          void threadData.activateThread(thread.id, { preferredThread: thread });
        }
        return;
      }

      if (message.event.eventType === "conversation.thread.deleted") {
        const payload = message.event.payload as { threadId: string; projectId: string };
        if (payload.projectId !== selectedProject.id) {
          return;
        }
        const currentThreads = cache.getThreads(selectedProject.id) || threadData.threadsRef.current;
        const nextThreads = removeThread(currentThreads, payload.threadId);
        cache.setThreads(selectedProject.id, nextThreads);
        threadData.setThreadsSnapshot(nextThreads);
        cache.deleteMessages(payload.threadId);
        if (threadData.selectedThreadIdRef.current === payload.threadId) {
          const userNextThreads = nextThreads.filter((t) => t.scope === "project");
          const nextSelection = resolveSelectedItemId(userNextThreads, null);
          const nextSelectedThread = userNextThreads.find((thread) => thread.id === nextSelection) || null;
          void threadData.activateThread(nextSelection, { preferredThread: nextSelectedThread });
        }
        return;
      }

      if (message.event.eventType === "conversation.message.created") {
        const realtimeMessage = message.event.payload as ChatMessageRecord;
        const cachedMessages = cache.getMessages(realtimeMessage.threadId) || [];
        const nextMessages = upsertMessage(cachedMessages, realtimeMessage);
        cache.setMessages(realtimeMessage.threadId, nextMessages);
        if (realtimeMessage.threadId === threadData.selectedThreadIdRef.current) {
          threadData.setMessagesSnapshot(nextMessages);
        }
      }
    });
  }, [
    threadData.activateThread,
    cache,
    invocationData.refreshInvocationMessages,
    threadData.refreshMessages,
    refreshThreads,
    invocationData.selectedInvocationIdRef,
    selectedProject,
    threadData.selectedThreadId,
    setConnectionsSnapshot,
    threadData.setMessagesSnapshot,
    threadData.setThreadsSnapshot,
    threadData.threadsRef,
  ]);

  return {
    connections,
    loading,
    manualRefreshing,
    refreshThreads,
  };
};
