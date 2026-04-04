import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type {
  AgentConnection,
  ChatMessageRecord,
  ChatThread,
  ExecutionInvocationRecord,
  ExecutionInvocationMessageRecord,
} from "../types.js";
import type {
  DashboardRealtimeServerMessage,
  ExecutionDashboardSnapshot,
  ExecutionConnectionSummary,
} from "../../types.js";
import { useMessageCache } from "./useMessageCache.js";
import { useProjectData } from "../context/project-data.js";
import {
  createConversationThread,
  deleteConversationThread,
  fetchConversationMessages,
  fetchConversationThreads,
  fetchProjectConnections,
  postConversationMessage,
  updateConversationThread,
  updateThreadRoute,
  compactThreadSession,
} from "../lib/connection-api.js";
import {
  isDetailLoading,
  isListLoading,
  resolveSelectedItemId,
} from "../lib/chat-page-state-utils.js";
import { upsertChatThread } from "../lib/chat-thread-utils.js";
import { fetchInvocationMessages, fetchProjectInvocations } from "../lib/invocation-api.js";
import { subscribeToDashboardRealtime } from "../../lib/realtime/dashboard-realtime-client.js";
import { useExecutions } from "../../hooks/useExecutions.js";
import { getProjectWorkerOptions, type WorkerRoutingPreference } from "../lib/project-worker-options.js";
import { buildThreadIndex, buildInvocationIndex, buildConnectionIndex } from "../lib/chat-entity-index.js";
import { useProjectEffectiveSettings } from "./use-project-effective-settings.js";
import { toChatTimestampMs } from "../lib/chat-time.js";

const isWorkingMessage = (
  message: ChatMessageRecord,
  allMessages: ChatMessageRecord[],
): boolean => {
  if (message.direction !== "dashboard_to_connection" || message.deliveryStatus !== "delivered") {
    return false;
  }

  return !allMessages.some((candidate) => (
    candidate.threadId === message.threadId
    && candidate.direction === "connection_to_dashboard"
    && toChatTimestampMs(candidate.createdAt) >= toChatTimestampMs(message.createdAt)
  ));
};

const upsertMessage = (messages: ChatMessageRecord[], nextMessage: ChatMessageRecord): ChatMessageRecord[] => {
  if (messages.some((message) => message.id === nextMessage.id)) {
    return messages;
  }

  return [...messages, nextMessage].sort((left, right) => {
    const byCreatedAt = toChatTimestampMs(left.createdAt) - toChatTimestampMs(right.createdAt);
    if (byCreatedAt !== 0) {
      return byCreatedAt;
    }
    return left.id.localeCompare(right.id);
  });
};

const removeThread = (threads: ChatThread[], threadId: string): ChatThread[] => (
  threads.filter((thread) => thread.id !== threadId)
);

const areThreadsEqual = (left: ChatThread[], right: ChatThread[]): boolean => (
  left.length === right.length
  && left.every((thread, index) => {
    const candidate = right[index];
    return Boolean(candidate)
      && candidate.id === thread.id
      && candidate.updatedAt === thread.updatedAt
      && candidate.lastMessageAt === thread.lastMessageAt
      && candidate.lastMessagePreview === thread.lastMessagePreview
      && candidate.messageCount === thread.messageCount
      && candidate.pendingMessageCount === thread.pendingMessageCount
      && candidate.connectionId === thread.connectionId;
  })
);

const areMessagesEqual = (left: ChatMessageRecord[], right: ChatMessageRecord[]): boolean => (
  left.length === right.length
  && left.every((message, index) => {
    const candidate = right[index];
    return Boolean(candidate)
      && candidate.id === message.id
      && candidate.createdAt === message.createdAt
      && candidate.deliveryStatus === message.deliveryStatus;
  })
);

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

import { type RefObject } from "preact";

export const useChatPageData = (options?: { composerRef?: RefObject<HTMLTextAreaElement>; messagesRef?: RefObject<HTMLDivElement> }) => {
const selectedThreadIdRef = useRef<string | null>(null);
  const selectedInvocationIdRef = useRef<string | null>(null);
  const threadsRef = useRef<ChatThread[]>([]);
  const cache = useMessageCache();
  const inflightMessageFetchesRef = useRef(new Map<string, Promise<ChatMessageRecord[]>>());
  const inflightInvocationFetchesRef = useRef(new Map<string, Promise<ExecutionInvocationMessageRecord[]>>());
  const activationTokenRef = useRef(0);
  const { selectedProject } = useProjectData();

  const { data: execution, loading: executionLoading } = useExecutions(selectedProject?.id || null);
  const { data: effectiveSettings, loading: effectiveSettingsLoading } = useProjectEffectiveSettings(selectedProject?.id || null);

  const workerRouting: WorkerRoutingPreference | null = effectiveSettings ? {
    executionMode: effectiveSettings.settings.workers.executionMode,
    virtualWorkerProvider: effectiveSettings.settings.workers.virtualWorkerProvider,
  } : null;

  const { options: workerOptions } = getProjectWorkerOptions(execution, workerRouting, executionLoading);

  const [chatMode, setChatMode] = useState<"threads" | "invocations">("threads");
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [invocations, setInvocations] = useState<ExecutionInvocationRecord[]>([]);
  const [connections, setConnections] = useState<AgentConnection[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedInvocationId, setSelectedInvocationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [invocationMessages, setInvocationMessages] = useState<ExecutionInvocationMessageRecord[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [assigningRoute, setAssigningRoute] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const threadIndex = useMemo(() => buildThreadIndex(threads), [threads]);
  const invocationIndex = useMemo(() => buildInvocationIndex(invocations), [invocations]);
  const connectionIndex = useMemo(() => buildConnectionIndex(connections), [connections]);

  const selectedThread = useMemo(
    () => (selectedThreadId ? threadIndex.get(selectedThreadId) || null : null),
    [threadIndex, selectedThreadId]
  );

  const selectedInvocation = useMemo(
    () => (selectedInvocationId ? invocationIndex.get(selectedInvocationId) || null : null),
    [invocationIndex, selectedInvocationId]
  );

  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
  }, [selectedThreadId]);

  useEffect(() => {
    selectedInvocationIdRef.current = selectedInvocationId;
  }, [selectedInvocationId]);

  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  const setThreadsSnapshot = useCallback((nextThreads: ChatThread[]): void => {
    setThreads((current) => areThreadsEqual(current, nextThreads) ? current : nextThreads);
  }, []);

  const setInvocationsSnapshot = useCallback((nextInvocations: ExecutionInvocationRecord[]): void => {
    setInvocations(nextInvocations);
  }, []);

  const setConnectionsSnapshot = useCallback((nextConnections: AgentConnection[]): void => {
    setConnections((current) => areConnectionsEqual(current, nextConnections) ? current : nextConnections);
  }, []);

  const setMessagesSnapshot = useCallback((nextMessages: ChatMessageRecord[]): void => {
    setMessages((current) => areMessagesEqual(current, nextMessages) ? current : nextMessages);
  }, []);

  const setInvocationMessagesSnapshot = useCallback((nextMessages: ExecutionInvocationMessageRecord[]): void => {
    setInvocationMessages(nextMessages);
  }, []);

  const ensureMessagesLoaded = useCallback(async (threadId: string): Promise<ChatMessageRecord[]> => {
    const cachedMessages = cache.getMessages(threadId);
    if (cachedMessages) {
      return cachedMessages;
    }

    const inflightRequest = inflightMessageFetchesRef.current.get(threadId);
    if (inflightRequest) {
      return inflightRequest;
    }

    const request = fetchConversationMessages(threadId)
      .then((nextMessages) => {
        cache.setMessages(threadId, nextMessages);
        return nextMessages;
      })
      .finally(() => {
        inflightMessageFetchesRef.current.delete(threadId);
      });

    inflightMessageFetchesRef.current.set(threadId, request);
    return request;
  }, []);

  const ensureInvocationMessagesLoaded = useCallback(async (invocationId: string): Promise<ExecutionInvocationMessageRecord[]> => {
    const cachedMessages = cache.getInvocationMessages(invocationId);
    if (cachedMessages) {
      return cachedMessages;
    }

    const inflightRequest = inflightInvocationFetchesRef.current.get(invocationId);
    if (inflightRequest) {
      return inflightRequest;
    }

    const request = fetchInvocationMessages(invocationId)
      .then((nextMessages) => {
        cache.setInvocationMessages(invocationId, nextMessages);
        return nextMessages;
      })
      .finally(() => {
        inflightInvocationFetchesRef.current.delete(invocationId);
      });

    inflightInvocationFetchesRef.current.set(invocationId, request);
    return request;
  }, []);

  const activateThread = useCallback(async (
    threadId: string | null,
    options?: { foreground?: boolean; preferredThread?: ChatThread | null },
  ): Promise<void> => {
    activationTokenRef.current += 1;
    const activationToken = activationTokenRef.current;

    if (!threadId) {
      setSelectedThreadId(null);
      setMessagesSnapshot([]);
      setMessagesLoading(false);
      return;
    }

    const targetThread = options?.preferredThread || threadsRef.current.find((thread) => thread.id === threadId) || null;
    const cachedMessages = cache.getMessages(threadId);
    if (cachedMessages) {
      setSelectedThreadId(threadId);
      setMessagesSnapshot(cachedMessages);
      setMessagesLoading(false);
      return;
    }

    if ((targetThread?.messageCount || 0) === 0) {
      cache.setMessages(threadId, []);
      setSelectedThreadId(threadId);
      setMessagesSnapshot([]);
      setMessagesLoading(false);
      return;
    }

    if (options?.foreground) {
      setSelectedThreadId(threadId);
      setMessagesSnapshot([]);
      setMessagesLoading(true);
    }

    try {
      const nextMessages = await ensureMessagesLoaded(threadId);
      if (activationToken !== activationTokenRef.current) {
        return;
      }
      setSelectedThreadId(threadId);
      setMessagesSnapshot(nextMessages);
      setError(null);
    } catch (fetchError) {
      if (activationToken === activationTokenRef.current) {
        setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      }
    } finally {
      if (activationToken === activationTokenRef.current) {
        setMessagesLoading(false);
      }
    }
  }, [ensureMessagesLoaded, setMessagesSnapshot]);

  const activateInvocation = useCallback(async (
    invocationId: string | null,
    options?: { foreground?: boolean; preferredInvocation?: ExecutionInvocationRecord | null },
  ): Promise<void> => {
    activationTokenRef.current += 1;
    const activationToken = activationTokenRef.current;

    if (!invocationId) {
      setSelectedInvocationId(null);
      setInvocationMessagesSnapshot([]);
      setMessagesLoading(false);
      return;
    }

    const targetInvocation = options?.preferredInvocation || cache.getInvocations(selectedProject?.id || "")?.find((inv) => inv.id === invocationId) || null;
    const cachedMessages = cache.getInvocationMessages(invocationId);
    if (cachedMessages) {
      setSelectedInvocationId(invocationId);
      setInvocationMessagesSnapshot(cachedMessages);
      setMessagesLoading(false);
      return;
    }

    if ((targetInvocation?.messageCount || 0) === 0) {
      cache.setInvocationMessages(invocationId, []);
      setSelectedInvocationId(invocationId);
      setInvocationMessagesSnapshot([]);
      setMessagesLoading(false);
      return;
    }

    if (options?.foreground) {
      setSelectedInvocationId(invocationId);
      setInvocationMessagesSnapshot([]);
      setMessagesLoading(true);
    }

    try {
      const nextMessages = await ensureInvocationMessagesLoaded(invocationId);
      if (activationToken !== activationTokenRef.current) {
        return;
      }
      setSelectedInvocationId(invocationId);
      setInvocationMessagesSnapshot(nextMessages);
      setError(null);
    } catch (fetchError) {
      if (activationToken === activationTokenRef.current) {
        setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      }
    } finally {
      if (activationToken === activationTokenRef.current) {
        setMessagesLoading(false);
      }
    }
  }, [ensureInvocationMessagesLoaded, selectedProject?.id, setInvocationMessagesSnapshot]);

  const refreshMessages = useCallback(async (
    threadId: string | null,
    options?: { foreground?: boolean; force?: boolean },
  ): Promise<void> => {
    if (!threadId) {
      setMessagesSnapshot([]);
      setMessagesLoading(false);
      return;
    }

    if (options?.foreground) {
      setMessagesLoading(true);
    }

    try {
      const nextMessages = options?.force
        ? await fetchConversationMessages(threadId).then((messagesResponse) => {
          cache.setMessages(threadId, messagesResponse);
          return messagesResponse;
        })
        : await ensureMessagesLoaded(threadId);
      if (selectedThreadIdRef.current === threadId) {
        setMessagesSnapshot(nextMessages);
      }
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      if (options?.foreground) {
        setMessagesLoading(false);
      }
    }
  }, [ensureMessagesLoaded, setMessagesSnapshot]);

  const refreshInvocationMessages = useCallback(async (
    invocationId: string | null,
    options?: { foreground?: boolean; force?: boolean },
  ): Promise<void> => {
    if (!invocationId) {
      setInvocationMessagesSnapshot([]);
      setMessagesLoading(false);
      return;
    }

    if (options?.foreground) {
      setMessagesLoading(true);
    }

    try {
      const nextMessages = options?.force
        ? await fetchInvocationMessages(invocationId).then((messagesResponse) => {
          cache.setInvocationMessages(invocationId, messagesResponse);
          return messagesResponse;
        })
        : await ensureInvocationMessagesLoaded(invocationId);
      if (selectedInvocationIdRef.current === invocationId) {
        setInvocationMessagesSnapshot(nextMessages);
      }
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      if (options?.foreground) {
        setMessagesLoading(false);
      }
    }
  }, [ensureInvocationMessagesLoaded, setInvocationMessagesSnapshot]);

  const refreshThreads = useCallback(async (options?: { manual?: boolean; foreground?: boolean; mode?: "threads" | "invocations" | "both" }): Promise<void> => {
    if (!selectedProject) {
      setThreads([]);
      setInvocations([]);
      setConnections([]);
      setMessages([]);
      setInvocationMessages([]);
      setSelectedThreadId(null);
      setSelectedInvocationId(null);
      setMessagesLoading(false);
      setError(null);
      return;
    }

    if (options?.manual) {
      setManualRefreshing(true);
    }
    if (options?.foreground) {
      setLoading(true);
    }

    const refreshMode = options?.mode || (options?.manual ? chatMode : "both");

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
          foreground: Boolean(options?.foreground),
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
          foreground: Boolean(options?.foreground),
          preferredInvocation: nextSelectedInvocation,
        });
      }

      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      if (options?.manual) {
        setManualRefreshing(false);
      }
      if (options?.foreground) {
        setLoading(false);
      }
    }
  }, [activateInvocation, activateThread, chatMode, selectedProject, setConnectionsSnapshot, setInvocationsSnapshot, setThreadsSnapshot]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }

    const cachedThreads = cache.getThreads(selectedProject.id);
    const cachedConnections = cache.getConnections(selectedProject.id);
    const cachedInvocations = cache.getInvocations(selectedProject.id);
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

    setThreads([]);
    setInvocations([]);
    setConnections([]);
    setMessages([]);
    setInvocationMessages([]);
    setSelectedThreadId(null);
    setSelectedInvocationId(null);
    setMessagesLoading(false);
    void refreshThreads({ foreground: true });
  }, [activateInvocation, activateThread, refreshThreads, selectedProject, setConnectionsSnapshot, setInvocationsSnapshot, setThreadsSnapshot]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }

    const scopes = [`project:${selectedProject.id}`];
    if (selectedThreadId) {
      scopes.push(`thread:${selectedThreadId}`);
    }

    return subscribeToDashboardRealtime(scopes, (message: DashboardRealtimeServerMessage) => {
      if (message.type === "snapshot_required") {
        void refreshThreads();
        if (selectedThreadIdRef.current) {
          void refreshMessages(selectedThreadIdRef.current, { force: true });
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
        if (thread.id === selectedThreadIdRef.current) {
          void refreshMessages(thread.id, { force: true });
        }
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
  }, [activateThread, chatMode, refreshInvocationMessages, refreshMessages, refreshThreads, selectedProject, setConnectionsSnapshot, setMessagesSnapshot, setThreadsSnapshot]);

  useEffect(() => {
    if (!options?.messagesRef?.current) return;
    if (options?.messagesRef?.current) {
      options.messagesRef.current.scrollTop = options.messagesRef.current.scrollHeight;
    }
  }, [messages]);

  const activeConnection = useMemo(() => {
    if (!selectedThread?.connectionId) {
      return null;
    }
    return connectionIndex.get(selectedThread.connectionId) || null;
  }, [connectionIndex, selectedThread]);

  const createThreadForCompose = useCallback(async (): Promise<ChatThread> => {
    if (!selectedProject) {
      throw new Error("Select a project before starting a chat thread.");
    }
    const thread = await createConversationThread(selectedProject.id, {
      title: `Project Chat ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
    });
    const nextThreads = upsertChatThread(cache.getThreads(selectedProject.id) || threadsRef.current, thread);
    cache.setThreads(selectedProject.id, nextThreads);
    cache.setMessages(thread.id, []);
    setThreadsSnapshot(nextThreads);
    await activateThread(thread.id, { preferredThread: thread });
    return thread;
  }, [activateThread, selectedProject, setThreadsSnapshot]);

  const handleAssignRoute = useCallback(async (option: { id: string, label: string, status: string, isPrimary: boolean, type: string, isSelectable: boolean, connectionId?: string | null, workerEndpointId?: string | null, providerId?: string }): Promise<void> => {
    if (!selectedThread) {
      return;
    }

    setAssigningRoute(true);
    try {
      let updated: ChatThread;
      if (!option.id) {
         updated = await updateConversationThread(selectedThread.id, {
           connectionId: null,
         });
      } else {
        const routeKind = option.type === "virtual" ? "virtual" : "worker";
        updated = await updateThreadRoute(selectedThread.id, {
          routeKind,
          virtualProvider: routeKind === "virtual" ? option.providerId : undefined,
          workerEndpointId: routeKind === "worker" ? (option.workerEndpointId || option.connectionId || undefined) : undefined,
        });
      }

      const nextThreads = (cache.getThreads(selectedProject?.id || "") || threadsRef.current).map((thread) => (
        thread.id === updated.id ? updated : thread
      ));
      if (selectedProject) {
        cache.setThreads(selectedProject.id, nextThreads);
      }
      setThreadsSnapshot(nextThreads);
      await refreshMessages(updated.id);
      setError(null);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError));
    } finally {
      setAssigningRoute(false);
    }
  }, [refreshMessages, selectedProject, selectedThread, setThreadsSnapshot]);

  const handleCompactThread = useCallback(async (): Promise<void> => {
    if (!selectedThread) {
      return;
    }

    setCompacting(true);
    try {
      const updated = await compactThreadSession(selectedThread.id);
      const nextThreads = (cache.getThreads(selectedProject?.id || "") || threadsRef.current).map((thread) => (
        thread.id === updated.id ? updated : thread
      ));
      if (selectedProject) {
        cache.setThreads(selectedProject.id, nextThreads);
      }
      setThreadsSnapshot(nextThreads);
      await refreshMessages(updated.id);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCompacting(false);
    }
  }, [selectedThread, selectedProject, setThreadsSnapshot, refreshMessages]);

  const handleSend = useCallback(async (): Promise<void> => {
    const bodyMarkdown = input.trim();
    if (!bodyMarkdown || !selectedProject) {
      return;
    }

    setSending(true);
    try {
      let thread = selectedThread || await createThreadForCompose();

      if (thread.messageCount === 0 && !thread.connectionId && !thread.runtimeState?.virtualProvider && !thread.runtimeState?.workerEndpointId) {
        const { options: defaultOptions, selectedOption } = getProjectWorkerOptions(execution, workerRouting, false);
        const hasActiveRoute = selectedOption !== null;

        if (hasActiveRoute && selectedOption) {
          try {
            const routeKind = selectedOption.type === "virtual" ? "virtual" : "worker";
            thread = await updateThreadRoute(thread.id, {
              routeKind,
              virtualProvider: routeKind === "virtual" ? selectedOption.providerId : undefined,
              workerEndpointId: routeKind === "worker" ? (selectedOption.workerEndpointId || selectedOption.connectionId || undefined) : undefined,
            });
          } catch (err) {
            console.warn("Failed to set default route for thread before sending", err);
          }
        }
      }

      const created = await postConversationMessage(selectedProject.id, {
        threadId: thread.id,
        bodyMarkdown,
      });
      setInput("");
      if (options?.composerRef?.current) {
        if (options?.composerRef?.current) {
        options.composerRef.current.style.height = "auto";
      }
      }
      const nextMessages = upsertMessage(cache.getMessages(thread.id) || [], created);
      cache.setMessages(thread.id, nextMessages);
      setMessagesSnapshot(nextMessages);
      await refreshThreads();
      setError(null);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : String(sendError));
    } finally {
      setSending(false);
    }
  }, [createThreadForCompose, input, refreshThreads, selectedProject, selectedThread, setMessagesSnapshot]);

  const pendingDashboardMessages = messages.filter((message) => (
    message.direction === "dashboard_to_connection" && message.deliveryStatus !== "processed"
  )).length;

  const hasWorkingReply = useMemo(() => messages.some((message) => isWorkingMessage(message, messages)), [messages]);
  const hasProjectSnapshot = Boolean(selectedProject && cache.hasThreads(selectedProject.id));
  const hasThreadSnapshot = Boolean(
    selectedThreadId
    && (cache.hasMessages(selectedThreadId) || (selectedThread?.messageCount || 0) === 0)
  );
  const threadsLoading = isListLoading(selectedProject?.id || null, hasProjectSnapshot, loading);
  const threadMessagesLoading = isDetailLoading(selectedThreadId, hasThreadSnapshot, messagesLoading);

  const hasInvocationProjectSnapshot = Boolean(selectedProject && cache.hasInvocations(selectedProject.id));
  const hasInvocationSnapshot = Boolean(
    selectedInvocationId
    && (cache.hasInvocationMessages(selectedInvocationId) || (selectedInvocation?.messageCount || 0) === 0)
  );
  const invocationsLoading = isListLoading(selectedProject?.id || null, hasInvocationProjectSnapshot, loading);
  const invocationMessagesLoading = isDetailLoading(selectedInvocationId, hasInvocationSnapshot, messagesLoading);

  const handleDeleteThread = useCallback(async (threadId: string): Promise<void> => {
    const nextThreads = removeThread(cache.getThreads(selectedProject?.id || "") || threadsRef.current, threadId);
    const userNextThreads = nextThreads.filter((t) => t.scope === "project");
    const nextSelection = resolveSelectedItemId(userNextThreads, selectedThreadId === threadId ? null : selectedThreadId);
    setDeletingThreadId(threadId);
    if (selectedProject) {
      cache.setThreads(selectedProject.id, nextThreads);
    }
    setThreadsSnapshot(nextThreads);
    if (selectedThreadId === threadId) {
      const nextSelectedThread = nextThreads.find((thread) => thread.id === nextSelection) || null;
      await activateThread(nextSelection, { preferredThread: nextSelectedThread });
    }
    cache.deleteMessages(threadId);

    try {
      await deleteConversationThread(threadId);
      setError(null);
    } catch (deleteError) {
      await refreshThreads();
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setDeletingThreadId((current) => current === threadId ? null : current);
    }
  }, [activateThread, refreshThreads, selectedProject, selectedThreadId, setThreadsSnapshot]);
  return {
    chatMode,
    setChatMode,
    threads,
    invocations,
    connections,
    selectedThreadId,
    selectedInvocationId,
    messages,
    invocationMessages,
    input,
    setInput,
    loading,
    messagesLoading,
    manualRefreshing,
    deletingThreadId,
    sending,
    assigningRoute,
    compacting,
    error,
    selectedThread,
    selectedInvocation,
    activeConnection,
    pendingDashboardMessages,
    hasWorkingReply,
    threadsLoading,
    threadMessagesLoading,
    invocationsLoading,
    invocationMessagesLoading,
    refreshThreads,
    refreshMessages,
    refreshInvocationMessages,
    activateThread,
    activateInvocation,
    handleAssignRoute,
    handleCompactThread,
    handleSend,
    handleDeleteThread,
    createThreadForCompose,
    workerOptions,
    threadIndex,
    invocationIndex,
    selectedProject,
  };
};
