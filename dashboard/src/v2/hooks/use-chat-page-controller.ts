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
import {
  upsertMessage,
  removeThread,
  areThreadsEqual,
  areMessagesEqual,
  areConnectionsEqual,
} from "../lib/chat-cache-updates.js";

const toAgentConnection = (connection: any): AgentConnection => (connection as AgentConnection);

export function useChatPageController() {
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
  }, [cache]);

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
  }, [cache]);

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
  }, [cache, ensureMessagesLoaded, setMessagesSnapshot]);

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
  }, [cache, ensureInvocationMessagesLoaded, selectedProject?.id, setInvocationMessagesSnapshot]);

  const refreshMessages = useCallback(async (
    threadId: string | null,
    options?: { foreground?: boolean; force?: boolean },
  ): Promise<void> => {
    if (!threadId) {
      return;
    }
    if (options?.force) {
      cache.deleteMessages(threadId);
    }
    await activateThread(threadId, { foreground: options?.foreground });
  }, [activateThread, cache]);

  const refreshInvocationMessages = useCallback(async (
    invocationId: string | null,
    options?: { foreground?: boolean; force?: boolean },
  ): Promise<void> => {
    if (!invocationId) {
      return;
    }
    if (options?.force) {
      cache.setInvocationMessages(invocationId, []);
    }
    await activateInvocation(invocationId, { foreground: options?.foreground });
  }, [activateInvocation, cache]);

  const refreshThreads = useCallback(async (options?: { manual?: boolean, mode?: "threads" | "invocations" }): Promise<void> => {
    if (!selectedProject) {
      setThreadsSnapshot([]);
      setInvocationsSnapshot([]);
      setConnectionsSnapshot([]);
      setSelectedThreadId(null);
      setSelectedInvocationId(null);
      return;
    }

    const projectId = selectedProject.id;
    const targetMode = options?.mode || chatMode;

    if (options?.manual) {
      setManualRefreshing(true);
      cache.clearAll();
    } else {
      if (targetMode === "threads") {
        const cachedThreads = cache.getThreads(projectId);
        const cachedConnections = cache.getConnections(projectId);
        if (cachedThreads) {
          setThreadsSnapshot(cachedThreads);
          setConnectionsSnapshot(cachedConnections || []);
          const activeId = resolveSelectedItemId(cachedThreads, selectedThreadIdRef.current);
          if (activeId !== selectedThreadIdRef.current || (!selectedThreadIdRef.current && activeId)) {
            const preferredThread = cachedThreads.find((thread) => thread.id === activeId) || null;
            void activateThread(activeId, { preferredThread });
          } else if (activeId) {
            void refreshMessages(activeId, { foreground: false });
          }
          return;
        }
      } else {
        const cachedInvocations = cache.getInvocations(projectId);
        if (cachedInvocations) {
          setInvocationsSnapshot(cachedInvocations);
          const activeId = resolveSelectedItemId(cachedInvocations, selectedInvocationIdRef.current);
          if (activeId !== selectedInvocationIdRef.current || (!selectedInvocationIdRef.current && activeId)) {
            const preferredInvocation = cachedInvocations.find((inv) => inv.id === activeId) || null;
            void activateInvocation(activeId, { preferredInvocation });
          } else if (activeId) {
            void refreshInvocationMessages(activeId, { foreground: false });
          }
          return;
        }
      }
    }

    setLoading(true);

    try {
      if (targetMode === "threads") {
        const [nextThreads, nextConnections] = await Promise.all([
          fetchConversationThreads(projectId),
          fetchProjectConnections(projectId),
        ]);
        cache.setThreads(projectId, nextThreads);
        cache.setConnections(projectId, nextConnections);
        setThreadsSnapshot(nextThreads);
        setConnectionsSnapshot(nextConnections);

        const activeId = resolveSelectedItemId(nextThreads, selectedThreadIdRef.current);
        const preferredThread = nextThreads.find((thread) => thread.id === activeId) || null;
        await activateThread(activeId, { preferredThread });
      } else {
        const nextInvocations = await fetchProjectInvocations(projectId);
        cache.setInvocations(projectId, nextInvocations);
        setInvocationsSnapshot(nextInvocations);

        const activeId = resolveSelectedItemId(nextInvocations, selectedInvocationIdRef.current);
        const preferredInvocation = nextInvocations.find((inv) => inv.id === activeId) || null;
        await activateInvocation(activeId, { preferredInvocation });
      }

      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoading(false);
      setManualRefreshing(false);
    }
  }, [activateInvocation, activateThread, cache, chatMode, refreshInvocationMessages, refreshMessages, selectedProject, setConnectionsSnapshot, setInvocationsSnapshot, setThreadsSnapshot]);

  useEffect(() => {
    void refreshThreads();
  }, [refreshThreads, chatMode, selectedProject?.id]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }

    return subscribeToDashboardRealtime([selectedProject.id], (message: DashboardRealtimeServerMessage) => {
      if (message.type === "event" && message.event.eventType === "project.execution.updated") {
        const snapshot = message.event.payload as ExecutionDashboardSnapshot;
        if (snapshot.projectId !== selectedProject.id) {
          return;
        }

        const nextConnections = (snapshot.connections || []).map((connection) => toAgentConnection(connection));
        cache.setConnections(selectedProject.id, nextConnections);
        setConnectionsSnapshot(nextConnections);

        void refreshThreads({ mode: "invocations" });
        return;
      }

      if (message.type === "event" && message.event.eventType === "conversation.thread.updated") {
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

      if (message.type === "event" && message.event.eventType === "conversation.thread.deleted") {
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
          const userNextThreads = nextThreads.filter((t: any) => t.scope === "project");
          const nextSelection = resolveSelectedItemId(userNextThreads, null);
          const nextSelectedThread = userNextThreads.find((t: any) => t.id === nextSelection) || null;
          void activateThread(nextSelection, { preferredThread: nextSelectedThread });
        }
        return;
      }

      if (message.type === "event" && message.event.eventType === "conversation.message.created") {
        const realtimeMessage = message.event.payload as ChatMessageRecord;
        const cachedMessages = cache.getMessages(realtimeMessage.threadId) || [];
        const nextMessages = upsertMessage(cachedMessages, realtimeMessage);
        cache.setMessages(realtimeMessage.threadId, nextMessages);
        if (realtimeMessage.threadId === selectedThreadIdRef.current) {
          setMessagesSnapshot(nextMessages);
        }
      }
    });
  }, [activateThread, chatMode, refreshInvocationMessages, refreshMessages, refreshThreads, selectedProject, setConnectionsSnapshot, setMessagesSnapshot, setThreadsSnapshot, cache]);

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
  }, [activateThread, selectedProject, setThreadsSnapshot, cache]);

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
  }, [refreshMessages, selectedProject, selectedThread, setThreadsSnapshot, cache]);

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
  }, [selectedThread, selectedProject, setThreadsSnapshot, refreshMessages, cache]);

  const handleSend = useCallback(async (input: string, onSent: () => void): Promise<void> => {
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

      onSent();

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
  }, [createThreadForCompose, refreshThreads, selectedProject, selectedThread, setMessagesSnapshot, execution, workerRouting, cache]);

  const handleDeleteThread = useCallback(async (threadId: string): Promise<void> => {
    const nextThreads = removeThread(cache.getThreads(selectedProject?.id || "") || threadsRef.current, threadId);
    const userNextThreads = nextThreads.filter((t: any) => t.scope === "project");
    const nextSelection = resolveSelectedItemId(userNextThreads, selectedThreadId === threadId ? null : selectedThreadId);
    setDeletingThreadId(threadId);
    if (selectedProject) {
      cache.setThreads(selectedProject.id, nextThreads);
    }
    setThreadsSnapshot(nextThreads);

    if (selectedThreadId === threadId) {
      const preferredThread = userNextThreads.find((t: any) => t.id === nextSelection) || null;
      void activateThread(nextSelection, { preferredThread });
    }

    try {
      await deleteConversationThread(threadId);
      setError(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
      await refreshThreads({ manual: true });
    } finally {
      setDeletingThreadId(null);
    }
  }, [activateThread, cache, refreshThreads, selectedProject?.id, selectedThreadId, setThreadsSnapshot]);

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
    loading,
    messagesLoading,
    manualRefreshing,
    deletingThreadId,
    sending,
    assigningRoute,
    compacting,
    error,
    threadIndex,
    invocationIndex,
    connectionIndex,
    selectedThread,
    selectedInvocation,
    selectedProject,
    workerOptions,
    cache,
    activateThread,
    activateInvocation,
    refreshThreads,
    createThreadForCompose,
    handleAssignRoute,
    handleCompactThread,
    handleSend,
    handleDeleteThread,
  };
}
