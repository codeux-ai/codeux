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
import type { AgentConnection, ChatMessageRecord, ChatThread } from "./types.js";
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
  isThreadListLoading,
  isThreadMessagesLoading,
  resolveSelectedThreadId,
} from "./lib/chat-page-state-utils.js";
import { upsertChatThread } from "./lib/chat-thread-utils.js";
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
  const messageCacheRef = useRef(new Map<string, ChatMessageRecord[]>());
  const { selectedProject } = useProjectData();

  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [connections, setConnections] = useState<AgentConnection[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [loadedThreadId, setLoadedThreadId] = useState<string | null>(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) || null,
    [threads, selectedThreadId]
  );

  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
  }, [selectedThreadId]);

  const applySelectedThread = useCallback((threadId: string | null): void => {
    setSelectedThreadId(threadId);

    if (!threadId) {
      setMessages([]);
      setLoadedThreadId(null);
      setMessagesLoading(false);
      return;
    }

    const cachedMessages = messageCacheRef.current.get(threadId);
    if (cachedMessages) {
      setMessages(cachedMessages);
      setLoadedThreadId(threadId);
      setMessagesLoading(false);
      return;
    }

    setMessages([]);
    setLoadedThreadId(null);
  }, []);

  const refreshThreads = useCallback(async (options?: { manual?: boolean; foreground?: boolean }): Promise<void> => {
    if (!selectedProject) {
      setThreads([]);
      setConnections([]);
      setMessages([]);
      setSelectedThreadId(null);
      setLoadedProjectId(null);
      setLoadedThreadId(null);
      setMessagesLoading(false);
      messageCacheRef.current.clear();
      setError(null);
      return;
    }

    if (options?.manual) {
      setManualRefreshing(true);
    }
    if (options?.foreground) {
      setLoading(true);
    }
    try {
      const [nextThreads, nextConnections] = await Promise.all([
        fetchConversationThreads(selectedProject.id),
        fetchProjectConnections(selectedProject.id),
      ]);
      setThreads(nextThreads);
      setConnections(nextConnections);
      setLoadedProjectId(selectedProject.id);
      const nextSelectedId = resolveSelectedThreadId(nextThreads, selectedThreadIdRef.current);
      applySelectedThread(nextSelectedId);
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
  }, [applySelectedThread, selectedProject]);

  const refreshMessages = useCallback(async (
    threadId: string | null,
    options?: { foreground?: boolean; useCache?: boolean },
  ): Promise<void> => {
    if (!threadId) {
      setMessages([]);
      setLoadedThreadId(null);
      setMessagesLoading(false);
      return;
    }

    try {
      const cachedMessages = options?.useCache === false ? undefined : messageCacheRef.current.get(threadId);
      if (cachedMessages) {
        setMessages(cachedMessages);
        setLoadedThreadId(threadId);
      }
      if (options?.foreground) {
        setMessagesLoading(true);
      }
      const nextMessages = await fetchConversationMessages(threadId);
      setMessages(nextMessages);
      setLoadedThreadId(threadId);
      messageCacheRef.current.set(threadId, nextMessages);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      if (options?.foreground) {
        setMessagesLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refreshThreads({ foreground: true });
  }, [refreshThreads]);

  useEffect(() => {
    const foreground = selectedThreadId !== null && !messageCacheRef.current.has(selectedThreadId);
    void refreshMessages(selectedThreadId, {
      foreground,
      useCache: true,
    });
  }, [refreshMessages, selectedThreadId]);

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
        if (selectedThreadId) {
          void refreshMessages(selectedThreadId, { useCache: true });
        }
        return;
      }

      if (message.type !== "event") {
        return;
      }

      if (message.event.eventType === "project.execution.updated") {
        const payload = message.event.payload as ExecutionDashboardSnapshot;
        setConnections((payload.connections || []).map((connection) => toAgentConnection(connection)));
        return;
      }

      if (message.event.eventType === "conversation.thread.updated") {
        const thread = message.event.payload as ChatThread;
        if (thread.projectId !== selectedProject.id) {
          return;
        }
        setThreads((current) => upsertChatThread(current, thread));
        setLoadedProjectId(selectedProject.id);
        if (!selectedThreadId) {
          applySelectedThread(thread.id);
        }
        return;
      }

      if (message.event.eventType === "conversation.thread.deleted") {
        const payload = message.event.payload as { threadId: string; projectId: string };
        if (payload.projectId !== selectedProject.id) {
          return;
        }
        setThreads((current) => removeThread(current, payload.threadId));
        messageCacheRef.current.delete(payload.threadId);
        if (selectedThreadId === payload.threadId) {
          applySelectedThread(null);
        }
        return;
      }

      if (message.event.eventType === "conversation.message.created") {
        const realtimeMessage = message.event.payload as ChatMessageRecord;
        if (realtimeMessage.threadId !== selectedThreadId) {
          return;
        }
        setMessages((current) => {
          const nextMessages = upsertMessage(current, realtimeMessage);
          messageCacheRef.current.set(realtimeMessage.threadId, nextMessages);
          return nextMessages;
        });
        setLoadedThreadId(realtimeMessage.threadId);
      }
    });
  }, [applySelectedThread, refreshMessages, selectedProject, selectedThreadId]);

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
    setThreads((current) => upsertChatThread(current, thread));
    applySelectedThread(thread.id);
    return thread;
  }, [applySelectedThread, selectedProject]);

  const handleAssignThread = async (connectionId: string): Promise<void> => {
    if (!selectedThread) {
      return;
    }

    try {
      const updated = await updateConversationThread(selectedThread.id, {
        connectionId: connectionId || null,
      });
      setThreads((current) => current.map((thread) => thread.id === updated.id ? updated : thread));
      await refreshMessages(updated.id, { useCache: true });
      setError(null);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError));
    }
  };

  const handleSend = async (): Promise<void> => {
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
      setMessages((current) => {
        const nextMessages = upsertMessage(current, created);
        messageCacheRef.current.set(thread.id, nextMessages);
        return nextMessages;
      });
      setLoadedThreadId(thread.id);
      await refreshThreads();
      setError(null);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : String(sendError));
    } finally {
      setSending(false);
    }
  };

  const pendingDashboardMessages = messages.filter((message) => (
    message.direction === "dashboard_to_connection" && message.deliveryStatus !== "processed"
  )).length;

  const hasWorkingReply = useMemo(() => messages.some((message) => isWorkingMessage(message, messages)), [messages]);
  const threadsLoading = isThreadListLoading(selectedProject?.id || null, loadedProjectId, loading);
  const threadMessagesLoading = isThreadMessagesLoading(selectedThreadId, loadedThreadId, messagesLoading);

  const handleDeleteThread = useCallback(async (threadId: string): Promise<void> => {
    const nextSelection = threads.find((thread) => thread.id !== threadId)?.id || null;
    setDeletingThreadId(threadId);
    setThreads((current) => removeThread(current, threadId));
    if (selectedThreadId === threadId) {
      applySelectedThread(nextSelection);
    }
    messageCacheRef.current.delete(threadId);

    try {
      await deleteConversationThread(threadId);
      if (nextSelection) {
        await refreshMessages(nextSelection, { useCache: true });
      }
      setError(null);
    } catch (deleteError) {
      await refreshThreads();
      if (selectedThreadId === threadId) {
        await refreshMessages(threadId, { foreground: false, useCache: true });
      }
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setDeletingThreadId((current) => current === threadId ? null : current);
    }
  }, [applySelectedThread, refreshMessages, refreshThreads, selectedThreadId, threads]);

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
          <button
            type="button"
            onClick={() => void refreshThreads({ manual: true })}
            disabled={manualRefreshing}
            className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/70 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:text-white"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${manualRefreshing ? "animate-spin" : ""}`} strokeWidth={2.1} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void createThreadForCompose()}
            disabled={!selectedProject}
            className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-void-900 transition-colors hover:bg-signal-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.3} />
            New Thread
          </button>
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
            <div className="mb-5 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Threads</div>
                <div className="mt-1 font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">{threads.length}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Listeners</div>
                <div className="mt-1 font-mono text-sm text-slate-600 dark:text-slate-300">{connections.length}</div>
              </div>
            </div>

            {threadsLoading ? (
              <LoadingChat label="Loading threads" />
            ) : threads.length === 0 ? (
              <EmptyChat message="Create the first project thread or post a message to queue work for an incoming listener." />
            ) : (
              <ThreadList
                threads={threads}
                selectedThreadId={selectedThreadId}
                onSelect={applySelectedThread}
                onDelete={(threadId) => void handleDeleteThread(threadId)}
                deletingThreadId={deletingThreadId}
              />
            )}
          </aside>

          <section className="flex min-h-[720px] flex-col rounded-[1.9rem] border border-black/[0.06] bg-white/70 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
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
          </section>
        </div>
      )}
    </div>
  );
};
