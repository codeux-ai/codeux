import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import {
  ArrowUp,
  RefreshCw,
  Sparkles,
  UserCircle2,
} from "lucide-preact";
import type {
  AgentConnection,
  ChatMessageRecord,
  ChatThread,
  ExecutionInvocationRecord,
  ExecutionInvocationMessageRecord,
} from "./types.js";
import type {
  DashboardRealtimeServerMessage,
  ExecutionDashboardSnapshot,
  ExecutionConnectionSummary,
} from "../types.js";
import { useMessageCache } from "./hooks/useMessageCache.js";
import { useProjectData } from "./context/project-data.js";
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
} from "./lib/connection-api.js";
import {
  isDetailLoading,
  isListLoading,
  resolveSelectedItemId,
} from "./lib/chat-page-state-utils.js";
import { upsertChatThread } from "./lib/chat-thread-utils.js";
import { fetchInvocationMessages, fetchProjectInvocations } from "./lib/invocation-api.js";
import { renderMarkdown } from "../lib/markdown.js";
import { subscribeToDashboardRealtime } from "../lib/realtime/dashboard-realtime-client.js";
import { ChatThreadHeader } from "./components/chat/ChatThreadHeader.js";
import { useExecutions } from "../hooks/useExecutions.js";
import { getProjectWorkerOptions, type WorkerRoutingPreference } from "./lib/project-worker-options.js";
import { fetchProjectEffectiveSettings } from "./lib/settings-api.js";
import { toChatTimestampMs } from "./lib/chat-time.js";
import { ChatPageShell } from "./components/chat/ChatPageShell.js";
import { buildThreadIndex, buildInvocationIndex, buildConnectionIndex } from "./lib/chat-entity-index.js";
import { useProjectEffectiveSettings } from "./hooks/use-project-effective-settings.js";
import { ChatRail } from "./components/chat/ChatRail.js";
import { ThreadListCard } from "./components/chat/ThreadListCard.js";
import { InvocationListCard } from "./components/chat/InvocationListCard.js";
import { EmptyChat, LoadingChat } from "./components/chat/ChatEmptyState.js";
import { ChatMessageBubble } from "./components/chat/ChatMessageBubble.js";
import { InvocationMessageBubble } from "./components/chat/InvocationMessageBubble.js";
import { WorkingBubble } from "./components/chat/WorkingBubble.js";
import { useActionFeedback } from "./hooks/use-action-feedback.js";
import { ActionFeedbackRegion } from "./components/ui/ActionFeedbackRegion.js";

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

export const ChatPage: FunctionComponent = () => {
  const messagesRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
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

  const routeFeedbackHook = useActionFeedback();
  const sendFeedbackHook = useActionFeedback();

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
    if (!messagesRef.current) return;
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
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

    routeFeedbackHook.setFeedback("pending", `Routing to ${option.label}...`);
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
      if (option.id) {
        routeFeedbackHook.setFeedback("success", `Route updated to ${option.label}.`);
      } else {
        routeFeedbackHook.setFeedback("success", "Route unassigned.");
      }
      setTimeout(() => routeFeedbackHook.clearFeedback(), 1500);
      setError(null);
    } catch (updateError) {
      const msg = updateError instanceof Error ? updateError.message : String(updateError);
      setError(msg);
      routeFeedbackHook.setFeedback("error", msg);
    } finally {
      setAssigningRoute(false);
    }
  }, [refreshMessages, selectedProject, selectedThread, setThreadsSnapshot, routeFeedbackHook]);

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

      const hasRoutePrior = !!(thread.connectionId || thread.runtimeState?.workerEndpointId || thread.runtimeState?.virtualProvider);

      if (hasRoutePrior) {
        sendFeedbackHook.setFeedback("pending", "Sending...");
      } else {
        sendFeedbackHook.setFeedback("pending", "Queued...");
      }

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

      const optimisticId = `opt-${Date.now()}`;
      const optimisticMsg: ChatMessageRecord = {
        id: optimisticId,
        threadId: thread.id,
        bodyMarkdown,
        direction: "dashboard_to_connection",
        deliveryStatus: "pending",
        authorType: "dashboard_user",
        authorConnectionId: null,
        createdAt: new Date().toISOString(),
        metadata: {}
      };

      const messagesWithOptimistic = upsertMessage(cache.getMessages(thread.id) || [], optimisticMsg);
      cache.setMessages(thread.id, messagesWithOptimistic);
      setMessagesSnapshot(messagesWithOptimistic);

      setInput("");
      if (composerRef.current) {
        composerRef.current.style.height = "auto";
      }

      const created = await postConversationMessage(selectedProject.id, {
        threadId: thread.id,
        bodyMarkdown,
      });

      let nextMessages = cache.getMessages(thread.id) || [];
      nextMessages = nextMessages.filter(m => m.id !== optimisticId);
      nextMessages = upsertMessage(nextMessages, created);

      cache.setMessages(thread.id, nextMessages);
      setMessagesSnapshot(nextMessages);
      await refreshThreads();

      const hasRoute = !!(thread.connectionId || thread.runtimeState?.workerEndpointId || thread.runtimeState?.virtualProvider);
      if (hasRoute) {
        sendFeedbackHook.setFeedback("success", "Sent!");
      } else {
        sendFeedbackHook.setFeedback("success", "Message will send when back online.");
      }
      setTimeout(() => sendFeedbackHook.clearFeedback(), 1500);

      setError(null);
    } catch (sendError) {
      const msg = sendError instanceof Error ? sendError.message : String(sendError);
      setError(msg);
      sendFeedbackHook.setFeedback("error", msg);
    } finally {
      setSending(false);
    }
  }, [createThreadForCompose, input, refreshThreads, selectedProject, selectedThread, setMessagesSnapshot, sendFeedbackHook]);

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

  const renderRail = () => {
    if (chatMode === "threads") {
      return (
        <ChatRail
          title="Threads"
          count={threads.filter((t) => t.scope === "project").length}
          secondaryTitle="Listeners"
          secondaryCount={connections.length}
        >
          {threadsLoading ? (
            <LoadingChat label="Loading threads" />
          ) : threads.filter((t) => t.scope === "project").length === 0 ? (
            <EmptyChat message="Create the first project thread or post a message to queue work for an incoming listener." />
          ) : (
            <ThreadListCard
              threads={threads.filter((t) => t.scope === "project")}
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
        count={invocations.length}
      >
        {invocationsLoading ? (
          <LoadingChat label="Loading invocations" />
        ) : invocations.length === 0 ? (
          <EmptyChat message="No execution invocations found for this project." />
        ) : (
          <InvocationListCard
            invocations={invocations}
            selectedInvocationId={selectedInvocationId}
            onSelect={(invocationId) => {
              const preferredInvocation = invocationIndex.get(invocationId) || null;
              void activateInvocation(invocationId, { preferredInvocation });
            }}
          />
        )}
      </ChatRail>
    );
  };

  const renderDetail = () => {
    if (chatMode === "threads") {
      return (
        <>
          <ChatThreadHeader
            thread={selectedThread}
            workerOptions={workerOptions}
            isAssigning={assigningRoute}
            onAssignRoute={(option) => void handleAssignRoute(option)}
            onCompact={() => void handleCompactThread()}
            isCompacting={compacting}
            actionFeedback={routeFeedbackHook.feedback}
            onDismissFeedback={routeFeedbackHook.clearFeedback}
          />

          <div ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">
            {threadsLoading ? (
              <LoadingChat label="Loading conversation" />
            ) : !selectedThread ? (
              <EmptyChat message="Select an existing thread or create a new one to start routing dashboard chat through the selected project." />
            ) : threadMessagesLoading ? (
              <LoadingChat label="Loading conversation" />
            ) : messages.length === 0 ? (
              <EmptyChat message="This thread is ready. The next dashboard message will be stored in Sprint OS and queued for a listening MCP connection." />
            ) : (
              <>
                {messages.map((message) => <ChatMessageBubble key={message.id} message={message} />)}
                {hasWorkingReply ? <WorkingBubble displayName={activeConnection?.displayName || null} runtimeState={selectedThread?.runtimeState} /> : null}
              </>
            )}
          </div>

          <div className="shrink-0 border-t border-black/[0.05] p-5 dark:border-white/[0.05]">
            {sendFeedbackHook.feedback.status !== "idle" && (
              <div className="mb-4">
                <ActionFeedbackRegion feedback={sendFeedbackHook.feedback} onDismiss={sendFeedbackHook.clearFeedback} />
              </div>
            )}
            <div className="rounded-[1.5rem] border border-black/[0.06] bg-black/[0.03] p-3 focus-within:border-signal-500/30 dark:border-white/[0.06] dark:bg-white/[0.03]">
              <textarea
                ref={composerRef}
                value={input}
                rows={1}
                placeholder={activeConnection ? "Send a dashboard message to the active listener…" : "Write a project note or queue a message for a future listener…"}
                className="max-h-[180px] min-h-[38px] w-full resize-none bg-transparent px-2 py-2 text-[15px] leading-relaxed text-slate-900 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-slate-600"
                onInput={(event) => {
                  const element = event.currentTarget;
                  element.style.height = "auto";
                  element.style.height = `${element.scrollHeight}px`;
                  setInput(element.value);
                }}
                onKeyDown={(event) => {
                  if (event.isComposing) {
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
              />
              <div className="mt-3 flex items-center justify-between">
                <div className="text-[10px] font-mono text-slate-400">
                  {activeConnection
                    ? `${activeConnection.displayName} · ${activeConnection.status} · Enter sends`
                    : "Messages will stay queued until a listener claims or is assigned to this thread · Enter sends · Shift+Enter newline"}
                </div>
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={!selectedProject || !input.trim() || sending}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-[1rem] bg-signal-500 text-void-900 shadow-[0_0_24px_rgba(0,224,160,0.28)] transition-all hover:bg-signal-400 disabled:cursor-not-allowed disabled:bg-black/[0.06] disabled:text-slate-400 disabled:shadow-none dark:disabled:bg-white/[0.06]"
                >
                  {sending ? <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2.2} /> : <ArrowUp className="h-4 w-4" strokeWidth={2.5} />}
                </button>
              </div>
            </div>
          </div>
        </>
      );
    }

    return (
      <>
        <div className="shrink-0 border-b border-black/[0.05] px-6 py-5 dark:border-white/[0.05]">
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-signal-500">
                <span>Active Invocation</span>
                {formatInvocationErrorCategory(selectedInvocation?.lastErrorCategory || null) && (
                  <span className="rounded-full border border-status-amber/25 bg-status-amber/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-status-amber">
                    {formatInvocationErrorCategory(selectedInvocation?.lastErrorCategory || null)}
                  </span>
                )}
              </div>
              <h2 className="mt-2 font-display text-3xl font-black tracking-tight text-slate-900 dark:text-white capitalize">
                {selectedInvocation?.type || "No Invocation Selected"}
              </h2>
              {selectedInvocation && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  {selectedInvocation.provider && (
                    <span className="rounded-full border border-black/25 bg-black/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] dark:border-white/25 dark:bg-white/10">
                      {selectedInvocation.provider}
                    </span>
                  )}
                  {selectedInvocation.model && (
                    <span className="rounded-full border border-black/25 bg-black/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] dark:border-white/25 dark:bg-white/10">
                      {selectedInvocation.model}
                    </span>
                  )}
                  <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] ${
                    selectedInvocation.status === "failed"
                      ? "border-status-red/25 bg-status-red/10 text-status-red"
                      : selectedInvocation.status === "completed"
                        ? "border-signal-500/25 bg-signal-500/10 text-signal-500"
                        : "border-black/25 bg-black/10 text-slate-500 dark:border-white/25 dark:bg-white/10 dark:text-slate-400"
                  }`}>
                    {selectedInvocation.status}
                  </span>
                </div>
              )}
              {selectedInvocation?.lastErrorMessage && (
                <div className="mt-3 max-w-2xl text-sm leading-relaxed text-status-amber">
                  {selectedInvocation.lastErrorMessage}
                  {selectedInvocation.lastRetryAfterIso && ` Retry at ${selectedInvocation.lastRetryAfterIso}.`}
                </div>
              )}
            </div>
            <div className="text-right text-[10px] font-mono text-slate-400">
              <div className="mb-2">{selectedInvocation ? `${selectedInvocation.messageCount} messages` : "0 messages"}</div>
            </div>
          </div>
        </div>

        <div ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">
          {invocationsLoading ? (
            <LoadingChat label="Loading invocations" />
          ) : !selectedInvocation ? (
            <EmptyChat message="Select an existing execution invocation to view its logs and messages." />
          ) : invocationMessagesLoading ? (
            <LoadingChat label="Loading messages" />
          ) : invocationMessages.length === 0 ? (
            <EmptyChat message="No messages found for this invocation." />
          ) : (
            <>
              {invocationMessages.map((message) => <InvocationMessageBubble key={message.id} message={message} />)}
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-black/[0.05] p-5 dark:border-white/[0.05]">
          <div className="rounded-[1.5rem] border border-black/[0.06] bg-black/[0.03] p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
            <div className="min-h-[38px] w-full px-2 py-2 text-[15px] leading-relaxed text-slate-400 dark:text-slate-600">
              Invocation execution logs are read-only. Switch to Threads to communicate.
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
        chatMode={chatMode}
        onSetChatMode={setChatMode}
        onRefresh={() => void refreshThreads({ manual: true })}
        manualRefreshing={manualRefreshing}
        onCreateThread={() => void createThreadForCompose()}
        pendingDashboardMessages={pendingDashboardMessages}
        activeConnectionLabel={activeConnection ? `${activeConnection.displayName} · ${activeConnection.status}` : undefined}
        error={error}
        railSlot={<div />}
        detailSlot={<EmptyChat message="Choose a project from the top navigation to load its stored chat threads and messages." />}
      />
    );
  }

  return (
    <ChatPageShell
      selectedProject={selectedProject}
      chatMode={chatMode}
      onSetChatMode={setChatMode}
      onRefresh={() => void refreshThreads({ manual: true })}
      manualRefreshing={manualRefreshing}
      onCreateThread={() => void createThreadForCompose()}
      pendingDashboardMessages={pendingDashboardMessages}
      activeConnectionLabel={activeConnection ? `${activeConnection.displayName} · ${activeConnection.status}` : undefined}
      error={error}
      railSlot={renderRail()}
      detailSlot={renderDetail()}
    />
  );
};
