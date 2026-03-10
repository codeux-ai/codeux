import type { FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import {
  ArrowUp,
  MessageCircle,
  Plus,
  RefreshCw,
  Sparkles,
  UserCircle2,
} from "lucide-preact";
import type { AgentConnection, ChatMessageRecord, ChatThread } from "./types.js";
import { useProjectData } from "./context/project-data.js";
import {
  createConversationThread,
  fetchConversationMessages,
  fetchConversationThreads,
  fetchProjectConnections,
  postConversationMessage,
  updateConversationThread,
} from "./lib/connection-api.js";
import { renderMarkdown } from "../lib/markdown.js";

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

const ThreadList: FunctionComponent<{
  threads: ChatThread[];
  selectedThreadId: string | null;
  onSelect: (threadId: string) => void;
}> = ({ threads, selectedThreadId, onSelect }) => (
  <div className="space-y-3">
    {threads.map((thread) => (
      <button
        key={thread.id}
        type="button"
        onClick={() => onSelect(thread.id)}
        className={`w-full rounded-[1.25rem] border px-4 py-3 text-left transition-colors ${
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

export const ChatPage: FunctionComponent = () => {
  const headerRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const { selectedProject } = useProjectData();

  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [connections, setConnections] = useState<AgentConnection[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) || null,
    [threads, selectedThreadId]
  );

  const refreshThreads = async (): Promise<void> => {
    if (!selectedProject) {
      setThreads([]);
      setConnections([]);
      setMessages([]);
      setSelectedThreadId(null);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      const [nextThreads, nextConnections] = await Promise.all([
        fetchConversationThreads(selectedProject.id),
        fetchProjectConnections(selectedProject.id),
      ]);
      setThreads(nextThreads);
      setConnections(nextConnections);
      const nextSelectedId = selectedThreadId && nextThreads.some((thread) => thread.id === selectedThreadId)
        ? selectedThreadId
        : nextThreads[0]?.id || null;
      setSelectedThreadId(nextSelectedId);
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoading(false);
    }
  };

  const refreshMessages = async (threadId: string | null): Promise<void> => {
    if (!threadId) {
      setMessages([]);
      return;
    }

    try {
      const nextMessages = await fetchConversationMessages(threadId);
      setMessages(nextMessages);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    }
  };

  useEffect(() => {
    void refreshThreads();
  }, [selectedProject?.id]);

  useEffect(() => {
    void refreshMessages(selectedThreadId);
  }, [selectedThreadId]);

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

  const createThreadForCompose = async (): Promise<ChatThread> => {
    if (!selectedProject) {
      throw new Error("Select a project before starting a chat thread.");
    }
    const thread = await createConversationThread(selectedProject.id, {
      title: `Project Chat ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
    });
    setThreads((current) => [thread, ...current]);
    setSelectedThreadId(thread.id);
    return thread;
  };

  const handleAssignThread = async (connectionId: string): Promise<void> => {
    if (!selectedThread) {
      return;
    }

    try {
      const updated = await updateConversationThread(selectedThread.id, {
        connectionId: connectionId || null,
      });
      setThreads((current) => current.map((thread) => thread.id === updated.id ? updated : thread));
      await refreshMessages(updated.id);
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
      setMessages((current) => [...current, created]);
      await refreshThreads();
      await refreshMessages(thread.id);
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
            onClick={() => void refreshThreads()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/70 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:text-white"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} strokeWidth={2.1} />
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

            {threads.length === 0 ? (
              <EmptyChat message="Create the first project thread or post a message to queue work for an incoming listener." />
            ) : (
              <ThreadList threads={threads} selectedThreadId={selectedThreadId} onSelect={setSelectedThreadId} />
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
                </div>
              </div>
            </div>

            <div ref={messagesRef} className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
              {!selectedThread ? (
                <EmptyChat message="Select an existing thread or create a new one to start routing dashboard chat through the selected project." />
              ) : messages.length === 0 ? (
                <EmptyChat message="This thread is ready. The next dashboard message will be stored in Sprint OS and queued for a listening MCP connection." />
              ) : (
                messages.map((message) => <MessageBubble key={message.id} message={message} />)
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
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                />
                <div className="mt-3 flex items-center justify-between">
                  <div className="text-[10px] font-mono text-slate-400">
                    {activeConnection ? `${activeConnection.displayName} · ${activeConnection.status}` : "Messages will stay queued until a listener claims or is assigned to this thread"}
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
