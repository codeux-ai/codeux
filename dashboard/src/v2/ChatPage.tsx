import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import {
  ArrowUp,
  MessageCircle,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
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
import { useProjectData } from "./context/project-data.js";
import {
  createConversationThread,
  deleteConversationThread,
  fetchConversationMessages,
  fetchConversationThreads,
  fetchProjectConnections,
  postConversationMessage,
  updateConversationThread,
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

const formatTime = (iso: string): string => (
  new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
);

const relativeTime = (iso: string | null): string => {
  if (!iso) return "No messages";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const statusTone = (pendingCount: number): string => (
  pendingCount > 0 ? "text-status-amber" : "text-slate-400 dark:text-slate-500"
);

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
    && new Date(candidate.createdAt).getTime() >= new Date(message.createdAt).getTime()
  ));
};

const upsertMessage = (messages: ChatMessageRecord[], nextMessage: ChatMessageRecord): ChatMessageRecord[] => {
  if (messages.some((message) => message.id === nextMessage.id)) {
    return messages;
  }

  return [...messages, nextMessage].sort((left, right) => {
    const byCreatedAt = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
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

const EmptyChat: FunctionComponent<{ message: string }> = ({ message }) => (
  <div className="flex h-full min-h-[360px] items-center justify-center rounded-[1.9rem] border border-dashed border-signal-500/20 bg-white/70 p-8 text-center shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:border-signal-500/20 dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
    <div className="space-y-3">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[1.2rem] bg-signal-500/10 text-signal-500">
        <MessageCircle className="h-6 w-6" strokeWidth={1.6} />
      </div>
      <h3 className="font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">No Chat Thread Yet</h3>
      <p className="max-w-md text-sm leading-relaxed text-slate-500 dark:text-slate-400">{message}</p>
    </div>
  </div>
);

const LoadingChat: FunctionComponent<{ label: string }> = ({ label }) => (
  <div className="flex h-full min-h-[360px] items-center justify-center rounded-[1.9rem] border border-dashed border-black/[0.06] bg-white/70 p-8 text-center shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
    <div className="space-y-4">
      <div className="mx-auto flex items-center justify-center gap-1.5">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-signal-500" />
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-signal-500 [animation-delay:140ms]" />
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-signal-500 [animation-delay:280ms]" />
      </div>
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-signal-500">{label}</div>
      <p className="max-w-md text-sm leading-relaxed text-slate-500 dark:text-slate-400">
        Sprint OS is loading the latest stored conversation state.
      </p>
    </div>
  </div>
);

const ThreadList: FunctionComponent<{
  threads: ChatThread[];
  selectedThreadId: string | null;
  onSelect: (threadId: string) => void;
  onDelete: (threadId: string) => void;
  deletingThreadId: string | null;
}> = ({ threads, selectedThreadId, onSelect, onDelete, deletingThreadId }) => (
  <div className="space-y-3">
    {threads.map((thread) => (
      <div key={thread.id} className="group relative overflow-hidden rounded-[1.25rem]">
        <button
          type="button"
          onClick={() => onSelect(thread.id)}
          className={`w-full rounded-[1.25rem] border px-4 py-3 pr-16 text-left transition-colors duration-150 ${
            selectedThreadId === thread.id
              ? "border-signal-500/30 bg-signal-500/10"
              : "border-black/[0.05] bg-black/[0.03] hover:border-slate-300 hover:bg-black/[0.05] dark:border-white/[0.05] dark:bg-white/[0.03] dark:hover:border-white/[0.12] dark:hover:bg-white/[0.05]"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-display text-lg font-black tracking-tight text-slate-900 dark:text-white">{thread.title}</div>
              <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {thread.lastMessagePreview || "No messages yet."}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className={`text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(thread.pendingMessageCount)}`}>
                {thread.pendingMessageCount > 0 ? `${thread.pendingMessageCount} pending` : "synced"}
              </div>
              <div className="mt-1 text-[10px] font-mono text-slate-400">{relativeTime(thread.lastMessageAt)}</div>
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDelete(thread.id);
          }}
          disabled={deletingThreadId === thread.id}
          aria-label={`Delete ${thread.title}`}
          className="absolute inset-y-0 right-0 flex w-12 translate-x-full items-center justify-center border-l border-status-red/15 bg-status-red/10 text-status-red opacity-0 transition-all duration-150 ease-out group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100 disabled:translate-x-0 disabled:opacity-100"
        >
          {deletingThreadId === thread.id ? <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2.1} /> : <Trash2 className="h-4 w-4" strokeWidth={2.1} />}
        </button>
      </div>
    ))}
  </div>
);

const InvocationList: FunctionComponent<{
  invocations: ExecutionInvocationRecord[];
  selectedInvocationId: string | null;
  onSelect: (invocationId: string) => void;
}> = ({ invocations, selectedInvocationId, onSelect }) => (
  <div className="space-y-3">
    {invocations.map((invocation) => (
      <div key={invocation.id} className="relative overflow-hidden rounded-[1.25rem]">
        <button
          type="button"
          onClick={() => onSelect(invocation.id)}
          className={`w-full rounded-[1.25rem] border px-4 py-3 text-left transition-colors duration-150 ${
            selectedInvocationId === invocation.id
              ? "border-signal-500/30 bg-signal-500/10"
              : "border-black/[0.05] bg-black/[0.03] hover:border-slate-300 hover:bg-black/[0.05] dark:border-white/[0.05] dark:bg-white/[0.03] dark:hover:border-white/[0.12] dark:hover:bg-white/[0.05]"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="truncate font-display text-lg font-black tracking-tight text-slate-900 dark:text-white capitalize">{invocation.type}</div>
                {(invocation.sprintId || invocation.taskId) && (
                  <div className="rounded border border-black/[0.06] bg-black/[0.03] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400">
                    {invocation.taskId ? "Task" : "Sprint"}
                  </div>
                )}
              </div>
              <div className="mt-1 line-clamp-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400 capitalize">
                {invocation.provider} {invocation.model && `· ${invocation.model}`}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className={`text-[10px] font-bold uppercase tracking-[0.12em] ${invocation.status === "failed" ? "text-status-red" : invocation.status === "completed" ? "text-signal-500" : "text-slate-500"}`}>
                {invocation.status}
              </div>
              <div className="mt-1 text-[10px] font-mono text-slate-400">{relativeTime(invocation.lastMessageAt || invocation.createdAt)}</div>
            </div>
          </div>
        </button>
      </div>
    ))}
  </div>
);

const InvocationMessageBubble: FunctionComponent<{ message: ExecutionInvocationMessageRecord }> = ({ message }) => {
  const fromSystem = message.role === "system";
  const fromUser = message.role === "user";
  const fromTool = message.role === "tool";
  const fromAssistant = message.role === "assistant";

  return (
    <div className={`flex ${fromUser || fromTool ? "justify-end" : "justify-start"}`}>
      <div className={`flex max-w-[760px] items-start gap-3 ${fromUser || fromTool ? "flex-row-reverse" : "flex-row"}`}>
        <div className={`mt-1 flex h-9 w-9 items-center justify-center rounded-[0.9rem] ${
          fromUser || fromTool
            ? "border border-black/[0.06] bg-white text-slate-500 dark:border-white/[0.06] dark:bg-void-700 dark:text-slate-300"
            : "border border-signal-500/20 bg-signal-500/10 text-signal-500"
        }`}>
          {fromUser || fromTool ? <UserCircle2 className="h-4 w-4" strokeWidth={1.6} /> : <Sparkles className="h-4 w-4" strokeWidth={1.6} />}
        </div>
        <div className="space-y-2">
          <div className={`rounded-[1.5rem] px-5 py-4 shadow-[0_2px_16px_rgba(0,0,0,0.04)] ${
            fromUser || fromTool
              ? "rounded-tr-sm border border-signal-500/20 bg-signal-500/10 text-slate-900 dark:text-white"
              : "rounded-tl-sm border border-black/[0.06] bg-white/75 text-slate-700 dark:border-white/[0.06] dark:bg-void-800/70 dark:text-slate-200"
          }`}>
            <div
              className="prose prose-sm max-w-none text-[14px] leading-7 text-inherit prose-headings:text-inherit prose-p:text-inherit prose-strong:text-inherit prose-code:text-inherit"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(message.contentMarkdown || "*(No message content)*") }}
            />
            {message.toolCallsJson && (
              <div className="mt-4 rounded border border-black/[0.06] bg-black/[0.03] p-3 text-xs dark:border-white/[0.06] dark:bg-white/[0.03]">
                <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-slate-600 dark:text-slate-400">
                  {JSON.stringify(message.toolCallsJson, null, 2)}
                </pre>
              </div>
            )}
          </div>
          <div className={`px-1 text-[10px] font-mono text-slate-400 flex items-center gap-2 ${fromUser || fromTool ? "justify-end" : "justify-start"}`}>
            <span>{formatTime(message.createdAt)}</span>
            <span className="capitalize">{message.role}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const MessageBubble: FunctionComponent<{ message: ChatMessageRecord }> = ({ message }) => {
  const fromDashboard = message.direction === "dashboard_to_connection";
  return (
    <div className={`flex ${fromDashboard ? "justify-end" : "justify-start"}`}>
      <div className={`flex max-w-[760px] items-start gap-3 ${fromDashboard ? "flex-row-reverse" : "flex-row"}`}>
        <div className={`mt-1 flex h-9 w-9 items-center justify-center rounded-[0.9rem] ${
          fromDashboard
            ? "border border-black/[0.06] bg-white text-slate-500 dark:border-white/[0.06] dark:bg-void-700 dark:text-slate-300"
            : "border border-signal-500/20 bg-signal-500/10 text-signal-500"
        }`}>
          {fromDashboard ? <UserCircle2 className="h-4 w-4" strokeWidth={1.6} /> : <Sparkles className="h-4 w-4" strokeWidth={1.6} />}
        </div>
        <div className="space-y-2">
          <div className={`rounded-[1.5rem] px-5 py-4 shadow-[0_2px_16px_rgba(0,0,0,0.04)] ${
            fromDashboard
              ? "rounded-tr-sm border border-signal-500/20 bg-signal-500/10 text-slate-900 dark:text-white"
              : "rounded-tl-sm border border-black/[0.06] bg-white/75 text-slate-700 dark:border-white/[0.06] dark:bg-void-800/70 dark:text-slate-200"
          }`}>
            <div
              className="prose prose-sm max-w-none text-[14px] leading-7 text-inherit prose-headings:text-inherit prose-p:text-inherit prose-strong:text-inherit prose-code:text-inherit"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(message.bodyMarkdown) }}
            />
          </div>
          <div className="flex items-center gap-3 px-1 text-[10px] font-mono text-slate-400">
            <span>{formatTime(message.createdAt)}</span>
            <span>{message.deliveryStatus}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const WorkingBubble: FunctionComponent<{ displayName: string | null }> = ({ displayName }) => (
  <div className="flex justify-start">
    <div className="flex max-w-[760px] items-start gap-3">
      <div className="mt-1 flex h-9 w-9 items-center justify-center rounded-[0.9rem] border border-signal-500/20 bg-signal-500/10 text-signal-500">
        <Sparkles className="h-4 w-4" strokeWidth={1.6} />
      </div>
      <div className="space-y-2">
        <div className="rounded-[1.5rem] rounded-tl-sm border border-black/[0.06] bg-white/75 px-5 py-4 text-slate-700 shadow-[0_2px_16px_rgba(0,0,0,0.04)] dark:border-white/[0.06] dark:bg-void-800/70 dark:text-slate-200">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-slate-500 dark:text-slate-400">
              {displayName || "Listener"} is preparing a reply
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 animate-pulse rounded-full bg-signal-500" />
              <span className="h-2 w-2 animate-pulse rounded-full bg-signal-500 [animation-delay:120ms]" />
              <span className="h-2 w-2 animate-pulse rounded-full bg-signal-500 [animation-delay:240ms]" />
            </span>
          </div>
        </div>
        <div className="px-1 text-[10px] font-mono text-slate-400">Working</div>
      </div>
    </div>
  </div>
);

export const ChatPage: FunctionComponent = () => {
  const headerRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const selectedThreadIdRef = useRef<string | null>(null);
  const selectedInvocationIdRef = useRef<string | null>(null);
  const threadsRef = useRef<ChatThread[]>([]);
  const messageCacheRef = useRef(new Map<string, ChatMessageRecord[]>());
  const threadCacheRef = useRef(new Map<string, ChatThread[]>());
  const connectionCacheRef = useRef(new Map<string, AgentConnection[]>());
  const invocationCacheRef = useRef(new Map<string, ExecutionInvocationRecord[]>());
  const invocationMessageCacheRef = useRef(new Map<string, ExecutionInvocationMessageRecord[]>());
  const inflightMessageFetchesRef = useRef(new Map<string, Promise<ChatMessageRecord[]>>());
  const inflightInvocationFetchesRef = useRef(new Map<string, Promise<ExecutionInvocationMessageRecord[]>>());
  const activationTokenRef = useRef(0);
  const { selectedProject } = useProjectData();

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
  const [error, setError] = useState<string | null>(null);

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) || null,
    [threads, selectedThreadId]
  );

  const selectedInvocation = useMemo(
    () => invocations.find((inv) => inv.id === selectedInvocationId) || null,
    [invocations, selectedInvocationId]
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
    const cachedMessages = messageCacheRef.current.get(threadId);
    if (cachedMessages) {
      return cachedMessages;
    }

    const inflightRequest = inflightMessageFetchesRef.current.get(threadId);
    if (inflightRequest) {
      return inflightRequest;
    }

    const request = fetchConversationMessages(threadId)
      .then((nextMessages) => {
        messageCacheRef.current.set(threadId, nextMessages);
        return nextMessages;
      })
      .finally(() => {
        inflightMessageFetchesRef.current.delete(threadId);
      });

    inflightMessageFetchesRef.current.set(threadId, request);
    return request;
  }, []);

  const ensureInvocationMessagesLoaded = useCallback(async (invocationId: string): Promise<ExecutionInvocationMessageRecord[]> => {
    const cachedMessages = invocationMessageCacheRef.current.get(invocationId);
    if (cachedMessages) {
      return cachedMessages;
    }

    const inflightRequest = inflightInvocationFetchesRef.current.get(invocationId);
    if (inflightRequest) {
      return inflightRequest;
    }

    const request = fetchInvocationMessages(invocationId)
      .then((nextMessages) => {
        invocationMessageCacheRef.current.set(invocationId, nextMessages);
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
    const cachedMessages = messageCacheRef.current.get(threadId);
    if (cachedMessages) {
      setSelectedThreadId(threadId);
      setMessagesSnapshot(cachedMessages);
      setMessagesLoading(false);
      return;
    }

    if ((targetThread?.messageCount || 0) === 0) {
      messageCacheRef.current.set(threadId, []);
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

    const targetInvocation = options?.preferredInvocation || invocationCacheRef.current.get(selectedProject?.id || "")?.find((inv) => inv.id === invocationId) || null;
    const cachedMessages = invocationMessageCacheRef.current.get(invocationId);
    if (cachedMessages) {
      setSelectedInvocationId(invocationId);
      setInvocationMessagesSnapshot(cachedMessages);
      setMessagesLoading(false);
      return;
    }

    if ((targetInvocation?.messageCount || 0) === 0) {
      invocationMessageCacheRef.current.set(invocationId, []);
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
          messageCacheRef.current.set(threadId, messagesResponse);
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
          invocationMessageCacheRef.current.set(invocationId, messagesResponse);
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

        threadCacheRef.current.set(selectedProject.id, nextThreads);
        connectionCacheRef.current.set(selectedProject.id, nextConnections);

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

        invocationCacheRef.current.set(selectedProject.id, nextInvocations);
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

    const cachedThreads = threadCacheRef.current.get(selectedProject.id);
    const cachedConnections = connectionCacheRef.current.get(selectedProject.id);
    const cachedInvocations = invocationCacheRef.current.get(selectedProject.id);
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
        connectionCacheRef.current.set(selectedProject.id, nextConnections);
        setConnectionsSnapshot(nextConnections);

        void refreshThreads({ mode: "invocations" });
        return;
      }

      if (message.event.eventType === "conversation.thread.updated") {
        const thread = message.event.payload as ChatThread;
        if (thread.projectId !== selectedProject.id) {
          return;
        }
        const currentThreads = threadCacheRef.current.get(selectedProject.id) || threadsRef.current;
        const nextThreads = upsertChatThread(currentThreads, thread);
        threadCacheRef.current.set(selectedProject.id, nextThreads);
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
        const currentThreads = threadCacheRef.current.get(selectedProject.id) || threadsRef.current;
        const nextThreads = removeThread(currentThreads, payload.threadId);
        threadCacheRef.current.set(selectedProject.id, nextThreads);
        setThreadsSnapshot(nextThreads);
        messageCacheRef.current.delete(payload.threadId);
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
        const cachedMessages = messageCacheRef.current.get(realtimeMessage.threadId) || [];
        const nextMessages = upsertMessage(cachedMessages, realtimeMessage);
        messageCacheRef.current.set(realtimeMessage.threadId, nextMessages);
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

  useLayoutEffect(() => {
    if (!headerRef.current) return;
    gsap.fromTo(
      Array.from(headerRef.current.children),
      { opacity: 0, y: 28 },
      { opacity: 1, y: 0, duration: 0.8, stagger: 0.08, ease: "power4.out" }
    );
  }, []);

  const activeConnection = useMemo(() => {
    if (!selectedThread?.connectionId) {
      return null;
    }
    return connections.find((connection) => connection.id === selectedThread.connectionId) || null;
  }, [connections, selectedThread]);

  const createThreadForCompose = useCallback(async (): Promise<ChatThread> => {
    if (!selectedProject) {
      throw new Error("Select a project before starting a chat thread.");
    }
    const thread = await createConversationThread(selectedProject.id, {
      title: `Project Chat ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
    });
    const nextThreads = upsertChatThread(threadCacheRef.current.get(selectedProject.id) || threadsRef.current, thread);
    threadCacheRef.current.set(selectedProject.id, nextThreads);
    messageCacheRef.current.set(thread.id, []);
    setThreadsSnapshot(nextThreads);
    await activateThread(thread.id, { preferredThread: thread });
    return thread;
  }, [activateThread, selectedProject, setThreadsSnapshot]);

  const handleAssignThread = useCallback(async (connectionId: string): Promise<void> => {
    if (!selectedThread) {
      return;
    }

    try {
      const updated = await updateConversationThread(selectedThread.id, {
        connectionId: connectionId || null,
      });
      const nextThreads = (threadCacheRef.current.get(selectedProject?.id || "") || threadsRef.current).map((thread) => (
        thread.id === updated.id ? updated : thread
      ));
      if (selectedProject) {
        threadCacheRef.current.set(selectedProject.id, nextThreads);
      }
      setThreadsSnapshot(nextThreads);
      await refreshMessages(updated.id);
      setError(null);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError));
    }
  }, [refreshMessages, selectedProject, selectedThread, setThreadsSnapshot]);

  const handleSend = useCallback(async (): Promise<void> => {
    const bodyMarkdown = input.trim();
    if (!bodyMarkdown || !selectedProject) {
      return;
    }

    setSending(true);
    try {
      const thread = selectedThread || await createThreadForCompose();
      const created = await postConversationMessage(selectedProject.id, {
        threadId: thread.id,
        bodyMarkdown,
      });
      setInput("");
      if (composerRef.current) {
        composerRef.current.style.height = "auto";
      }
      const nextMessages = upsertMessage(messageCacheRef.current.get(thread.id) || [], created);
      messageCacheRef.current.set(thread.id, nextMessages);
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
  const hasProjectSnapshot = Boolean(selectedProject && threadCacheRef.current.has(selectedProject.id));
  const hasThreadSnapshot = Boolean(
    selectedThreadId
    && (messageCacheRef.current.has(selectedThreadId) || (selectedThread?.messageCount || 0) === 0)
  );
  const threadsLoading = isListLoading(selectedProject?.id || null, hasProjectSnapshot, loading);
  const threadMessagesLoading = isDetailLoading(selectedThreadId, hasThreadSnapshot, messagesLoading);

  const hasInvocationProjectSnapshot = Boolean(selectedProject && invocationCacheRef.current.has(selectedProject.id));
  const hasInvocationSnapshot = Boolean(
    selectedInvocationId
    && (invocationMessageCacheRef.current.has(selectedInvocationId) || (selectedInvocation?.messageCount || 0) === 0)
  );
  const invocationsLoading = isListLoading(selectedProject?.id || null, hasInvocationProjectSnapshot, loading);
  const invocationMessagesLoading = isDetailLoading(selectedInvocationId, hasInvocationSnapshot, messagesLoading);

  const handleDeleteThread = useCallback(async (threadId: string): Promise<void> => {
    const nextThreads = removeThread(threadCacheRef.current.get(selectedProject?.id || "") || threadsRef.current, threadId);
    const userNextThreads = nextThreads.filter((t) => t.scope === "project");
    const nextSelection = resolveSelectedItemId(userNextThreads, selectedThreadId === threadId ? null : selectedThreadId);
    setDeletingThreadId(threadId);
    if (selectedProject) {
      threadCacheRef.current.set(selectedProject.id, nextThreads);
    }
    setThreadsSnapshot(nextThreads);
    if (selectedThreadId === threadId) {
      const nextSelectedThread = nextThreads.find((thread) => thread.id === nextSelection) || null;
      await activateThread(nextSelection, { preferredThread: nextSelectedThread });
    }
    messageCacheRef.current.delete(threadId);

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

  return (
    <div className="relative z-10 mx-auto flex min-h-[calc(100vh-70px)] max-w-[1900px] flex-col gap-10 px-8 py-16 md:px-20">
      <div ref={headerRef} className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-signal-500">
            <MessageCircle className="h-3.5 w-3.5" strokeWidth={2.2} />
            Dashboard Chat
          </div>
          <div className="relative overflow-hidden">
            <div className="pointer-events-none absolute -left-2 -top-8 font-display text-[6rem] font-black leading-none tracking-tighter text-black/[0.04] dark:text-white/[0.03]">
              CHAT
            </div>
            <h1 className="relative z-10 font-display text-5xl font-black tracking-tighter text-slate-900 dark:text-white md:text-7xl">
              Project <span className="text-signal-500">Conversations.</span>
            </h1>
          </div>
          <p className="max-w-2xl text-lg leading-relaxed text-slate-500 dark:text-slate-400">
            {selectedProject
              ? `Messages sent here are stored in Sprint OS and routed toward listening MCP connections for ${selectedProject.name}.`
              : "Select a project to inspect its conversation threads and route dashboard messages to connected listeners."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-full border border-black/[0.06] bg-white/70 p-1 dark:border-white/[0.06] dark:bg-white/[0.03]">
            <button
              type="button"
              onClick={() => setChatMode("threads")}
              className={`rounded-full px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors ${
                chatMode === "threads"
                  ? "bg-slate-900 text-white dark:bg-white dark:text-void-900"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              Threads
            </button>
            <button
              type="button"
              onClick={() => setChatMode("invocations")}
              className={`rounded-full px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors ${
                chatMode === "invocations"
                  ? "bg-slate-900 text-white dark:bg-white dark:text-void-900"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              Invocations
            </button>
          </div>
          {chatMode === "threads" && (
            <>
              <span className="rounded-full border border-black/[0.06] bg-white/70 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400">
                {activeConnection ? `${activeConnection.displayName} · ${activeConnection.status}` : "Unassigned"}
              </span>
              <span className={`rounded-full border px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] ${
                pendingDashboardMessages > 0
                  ? "border-status-amber/30 bg-status-amber/10 text-status-amber"
                  : "border-signal-500/20 bg-signal-500/10 text-signal-500"
              }`}>
                {pendingDashboardMessages > 0 ? `${pendingDashboardMessages} pending` : "Inbox clear"}
              </span>
            </>
          )}
          <button
            type="button"
            onClick={() => void refreshThreads({ manual: true })}
            disabled={manualRefreshing}
            className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/70 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:text-white"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${manualRefreshing ? "animate-spin" : ""}`} strokeWidth={2.1} />
            Refresh
          </button>
          {chatMode === "threads" && (
            <button
              type="button"
              onClick={() => void createThreadForCompose()}
              disabled={!selectedProject}
              className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-void-900 transition-colors hover:bg-signal-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.3} />
              New Thread
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-[1.4rem] border border-status-red/20 bg-status-red/10 px-5 py-4 text-sm text-status-red">
          {error}
        </div>
      )}

      {!selectedProject ? (
        <EmptyChat message="Choose a project from the top navigation to load its stored chat threads and messages." />
      ) : (
        <div className="grid min-h-[720px] grid-cols-1 gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="rounded-[1.9rem] border border-black/[0.06] bg-white/70 p-5 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
            {chatMode === "threads" ? (
              <>
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Threads</div>
                    <div className="mt-1 font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">
                      {threads.filter((t) => t.scope === "project").length}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Listeners</div>
                    <div className="mt-1 font-mono text-sm text-slate-600 dark:text-slate-300">{connections.length}</div>
                  </div>
                </div>

                {threadsLoading ? (
                  <LoadingChat label="Loading threads" />
                ) : threads.filter((t) => t.scope === "project").length === 0 ? (
                  <EmptyChat message="Create the first project thread or post a message to queue work for an incoming listener." />
                ) : (
                  <ThreadList
                    threads={threads.filter((t) => t.scope === "project")}
                    selectedThreadId={selectedThreadId}
                    onSelect={(threadId) => {
                      const preferredThread = threads.find((thread) => thread.id === threadId) || null;
                      void activateThread(threadId, { preferredThread });
                    }}
                    onDelete={(threadId) => void handleDeleteThread(threadId)}
                    deletingThreadId={deletingThreadId}
                  />
                )}
              </>
            ) : (
              <>
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Invocations</div>
                    <div className="mt-1 font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">{invocations.length}</div>
                  </div>
                </div>

                {invocationsLoading ? (
                  <LoadingChat label="Loading invocations" />
                ) : invocations.length === 0 ? (
                  <EmptyChat message="No execution invocations found for this project." />
                ) : (
                  <InvocationList
                    invocations={invocations}
                    selectedInvocationId={selectedInvocationId}
                    onSelect={(invocationId) => {
                      const preferredInvocation = invocations.find((inv) => inv.id === invocationId) || null;
                      void activateInvocation(invocationId, { preferredInvocation });
                    }}
                  />
                )}
              </>
            )}
          </aside>

          <section className="flex min-h-[720px] flex-col rounded-[1.9rem] border border-black/[0.06] bg-white/70 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
            {chatMode === "threads" ? (
              <>
                <div className="border-b border-black/[0.05] px-6 py-5 dark:border-white/[0.05]">
                  <div className="flex items-start justify-between gap-6">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-signal-500">Active Thread</div>
                      <h2 className="mt-2 font-display text-3xl font-black tracking-tight text-slate-900 dark:text-white">
                        {selectedThread?.title || "No Thread Selected"}
                      </h2>
                    </div>
                    <div className="text-right text-[10px] font-mono text-slate-400">
                      <div className="mb-2">{selectedThread ? `${selectedThread.messageCount} messages` : "0 messages"}</div>
                      <label className="inline-flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Worker:</span>
                        <select
                          value={selectedThread?.connectionId || ""}
                          onChange={(event) => void handleAssignThread(event.currentTarget.value)}
                          disabled={!selectedThread}
                          className="rounded-full border border-black/[0.08] bg-white/70 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 outline-none dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300"
                        >
                          <option value="">Unassigned</option>
                          {connections.map((connection) => (
                            <option key={connection.id} value={connection.id}>
                              {connection.displayName} · {connection.status}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                </div>

                <div ref={messagesRef} className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
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
                      {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
                      {hasWorkingReply ? <WorkingBubble displayName={activeConnection?.displayName || null} /> : null}
                    </>
                  )}
                </div>

                <div className="border-t border-black/[0.05] p-5 dark:border-white/[0.05]">
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
            ) : (
              <>
                <div className="border-b border-black/[0.05] px-6 py-5 dark:border-white/[0.05]">
                  <div className="flex items-start justify-between gap-6">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-signal-500">Active Invocation</div>
                      <h2 className="mt-2 font-display text-3xl font-black tracking-tight text-slate-900 dark:text-white capitalize">
                        {selectedInvocation?.type || "No Invocation Selected"}
                      </h2>
                    </div>
                    <div className="text-right text-[10px] font-mono text-slate-400">
                      <div className="mb-2">{selectedInvocation ? `${selectedInvocation.messageCount} messages` : "0 messages"}</div>
                    </div>
                  </div>
                </div>

                <div ref={messagesRef} className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
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

                <div className="border-t border-black/[0.05] p-5 dark:border-white/[0.05]">
                  <div className="rounded-[1.5rem] border border-black/[0.06] bg-black/[0.03] p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                    <div className="min-h-[38px] w-full px-2 py-2 text-[15px] leading-relaxed text-slate-400 dark:text-slate-600">
                      Invocation execution logs are read-only. Switch to Threads to communicate.
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
