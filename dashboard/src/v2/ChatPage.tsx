import type { FunctionComponent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  ArrowUp,
  RefreshCw,
} from "lucide-preact";
import { ChatThreadHeader } from "./components/chat/ChatThreadHeader.js";
import { ChatPageShell } from "./components/chat/ChatPageShell.js";
import { ChatRail } from "./components/chat/ChatRail.js";
import { ThreadListCard } from "./components/chat/ThreadListCard.js";
import { InvocationListCard } from "./components/chat/InvocationListCard.js";
import { ChatRailPlaceholder, EmptyChat, LoadingChat } from "./components/chat/ChatEmptyState.js";
import { EmptyState } from "./components/ui/EmptyState.js";
import { MessageCircle } from "lucide-preact";
import { ChatMessageBubble } from "./components/chat/ChatMessageBubble.js";
import { useChatPageData } from "./hooks/use-chat-page-data.js";
import { InvocationMessageBubble } from "./components/chat/InvocationMessageBubble.js";
import { InvocationRoutingWidget } from "./components/chat/widgets/InvocationRoutingWidget.js";
import { InvocationContainerWidget } from "./components/chat/widgets/InvocationContainerWidget.js";
import { TruncatedSystemBubble } from "./components/chat/TruncatedSystemBubble.js";
import { WorkingBubble } from "./components/chat/WorkingBubble.js";
import { ConfirmDialog } from "./components/ui/ConfirmDialog.js";
import { ActionFeedbackRegion } from "./components/ui/ActionFeedbackRegion.js";
import { ProviderLogo } from "./components/ui/ProviderLogo.js";
import { AgentAvatarSvg } from "./components/agents/AgentAvatarSvg.js";
import { generateRandomAgentAvatar } from "./lib/agent-avatar.js";
import type { ExecutionInvocationRecord } from "./types.js";

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

export const ChatPage: FunctionComponent = () => {
  const messagesRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [workingTimerPhase, setWorkingTimerPhase] = useState<"starting" | "working" | null>(null);

  const {
    chatMode,
    setChatMode,
    threads,
    invocations,
    selectedThreadId,
    selectedInvocationId,
    messages,
    invocationMessages,
    input,
    setInput,
    manualRefreshing,
    deletingThreadId,
    sending,
    compacting,
    error,
    selectedThread,
    selectedInvocation,
    selectedAgentPreset,
    activeConnection,
    pendingDashboardMessages,
    hasWorkingReply,
    threadsLoading,
    threadMessagesLoading,
    connections,
    invocationsLoading,
    invocationMessagesLoading,
    refreshThreads,
    activateThread,
    activateInvocation,
    handleCompactThread,
    handleSend,
    handleDeleteThread,
    createThreadForCompose,
    threadIndex,
    invocationIndex,
    selectedProject,
    agentPresets,
    feedback,
    clearFeedback,
    isConfirmOpen,
    confirmOptions,
    handleConfirm,
    handleCancel,
  } = useChatPageData({ composerRef, messagesRef });

  useEffect(() => {
    if (!messagesRef.current) return;
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (hasWorkingReply) {
      setWorkingTimerPhase("starting");
      const timer = setTimeout(() => {
        setWorkingTimerPhase("working");
      }, 4000);
      return () => clearTimeout(timer);
    } else {
      setWorkingTimerPhase(null);
    }
  }, [hasWorkingReply]);

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
            <ChatRailPlaceholder
              message="Fresh installs start with a quiet rail. Create the first thread and Code UX will keep routing, pending replies, and history organized here."
            />
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
          <ChatRailPlaceholder
            title="Invocation Rail Standby"
            message="Execution transcripts appear here after planning, chat, or runtime work creates invocation records."
            actionLabel="Awaiting Runtime"
          />
        ) : (
          <InvocationListCard
            invocations={invocations}
            selectedInvocationId={selectedInvocationId}
            agentPresets={agentPresets}
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
          <ConfirmDialog isOpen={isConfirmOpen} options={confirmOptions} onConfirm={handleConfirm} onCancel={handleCancel} />
          {feedback.status !== "idle" && (
            <div className="absolute top-4 right-4 z-50 shadow-lg">
              <ActionFeedbackRegion status={feedback.status} message={feedback.message} onDismiss={clearFeedback} />
            </div>
          )}
          <ChatThreadHeader
            thread={selectedThread}
            onCompact={() => void handleCompactThread()}
            isCompacting={compacting}
          />

          <div ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">
            {threadsLoading ? (
              <LoadingChat label="Loading conversation" />
            ) : !selectedThread ? (
              <EmptyChat
                tone="thread"
                message="Create the first project thread to open a clean operator channel. Messages will be stored in Code UX and queued for the selected worker route."
              />
            ) : threadMessagesLoading ? (
              <LoadingChat label="Loading conversation" />
            ) : messages.length === 0 ? (
              <EmptyChat
                tone="messages"
                message="This thread is ready. The next dashboard message will be stored in Code UX and queued for a listening MCP connection or virtual worker route."
              />
            ) : (
              <>
                {messages.map((message) => <ChatMessageBubble key={message.id} message={message} allMessages={messages} />)}
                {hasWorkingReply && workingTimerPhase === "starting" ? (
                  <InvocationContainerWidget
                    containerPhase="starting"
                    providerName={selectedThread?.runtimeState?.virtualProvider ?? null}
                    agentName={activeConnection?.displayName || null}
                  />
                ) : hasWorkingReply && workingTimerPhase === "working" ? (
                  <WorkingBubble displayName={activeConnection?.displayName || null} runtimeState={selectedThread?.runtimeState} />
                ) : null}
              </>
            )}
          </div>

          <div className="shrink-0 border-t border-black/[0.05] p-5 dark:border-white/[0.05]">
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
        <div className="shrink-0 border-b border-black/[0.05] px-6 py-6 dark:border-white/[0.05]">
          <div className="flex items-start justify-between gap-6">
            <div className="flex items-start gap-4">
              {/* Agent avatar or provider icon */}
              {selectedAgentPreset ? (
                <div className="w-11 h-11 rounded-[0.875rem] overflow-hidden border border-black/[0.06] dark:border-white/[0.06] bg-white/75 dark:bg-white/[0.04] flex items-center justify-center shrink-0">
                  <AgentAvatarSvg config={selectedAgentPreset.avatarConfig || generateRandomAgentAvatar(selectedAgentPreset.name)} size={44} static />
                </div>
              ) : selectedInvocation?.provider ? (
                <div className="w-11 h-11 rounded-[0.875rem] flex items-center justify-center shrink-0 bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.06] dark:border-white/[0.06]">
                  <ProviderLogo provider={selectedInvocation.provider} size={24} />
                </div>
              ) : null}

              <div>
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-signal-500">
                  <span>Active Invocation</span>
                  {formatInvocationErrorCategory(selectedInvocation?.lastErrorCategory || null) && (
                    <span className="rounded-full border border-status-amber/25 bg-status-amber/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-status-amber">
                      {formatInvocationErrorCategory(selectedInvocation?.lastErrorCategory || null)}
                    </span>
                  )}
                </div>
                <h2 className="mt-1.5 font-display text-3xl font-black tracking-tight text-slate-900 dark:text-white capitalize">
                  {selectedInvocation?.type?.replace(/_/g, " ") || "No Invocation Selected"}
                </h2>
                {selectedAgentPreset && (
                  <div className="mt-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    {selectedAgentPreset.name}
                  </div>
                )}
                {selectedInvocation && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    {/* Invocation ID */}
                    <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.04] text-slate-400">
                      {selectedInvocation.id.slice(0, 8)}
                    </span>
                    {/* Provider badge with icon */}
                    {selectedInvocation.provider && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-black/[0.08] bg-black/[0.04] px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400">
                        <ProviderLogo provider={selectedInvocation.provider} size={12} />
                        {selectedInvocation.provider}
                      </span>
                    )}
                    {/* Model badge */}
                    {selectedInvocation.model && (
                      <span className="rounded-full border border-black/[0.08] bg-black/[0.04] px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400">
                        {selectedInvocation.model}
                      </span>
                    )}
                    {/* Status badge */}
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] ${
                      selectedInvocation.status === "failed"
                        ? "border-status-red/25 bg-status-red/[0.08] text-status-red"
                        : selectedInvocation.status === "completed"
                          ? "border-signal-500/25 bg-signal-500/[0.08] text-signal-500"
                          : selectedInvocation.status === "running"
                            ? "border-signal-500/25 bg-signal-500/[0.08] text-signal-500"
                            : "border-black/[0.08] bg-black/[0.04] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400"
                    }`}>
                      {selectedInvocation.status === "running" && (
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-signal-500 animate-pulse shadow-[0_0_6px_rgba(0,224,160,0.6)]" />
                      )}
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
            </div>
            <div className="text-right text-[10px] font-mono text-slate-400">
              <div>{selectedInvocation ? `${selectedInvocation.messageCount} messages` : "0 messages"}</div>
            </div>
          </div>
        </div>

        <div ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">
          {invocationsLoading ? (
            <LoadingChat label="Loading invocations" />
          ) : !selectedInvocation ? (
            <EmptyChat
              tone="invocations"
              message="Select an execution invocation to inspect the exact runtime transcript, retry state, and provider response trail."
            />
          ) : invocationMessagesLoading ? (
            <LoadingChat label="Loading messages" />
          ) : (
            <>
              <InvocationRoutingWidget
                provider={selectedInvocation.provider}
                model={selectedInvocation.model}
                routingStatus={
                  selectedInvocation.status === "running" && selectedInvocation.messageCount === 0
                    ? "routing"
                    : selectedInvocation.status === "running" && selectedInvocation.messageCount > 0
                      ? "active"
                      : "done"
                }
              />
              <InvocationContainerWidget
                providerName={selectedInvocation.provider}
                agentName={selectedAgentPreset?.name ?? null}
                containerPhase={
                  selectedInvocation.status === "running" && selectedInvocation.messageCount === 0
                    ? "starting"
                    : selectedInvocation.status === "running" && selectedInvocation.messageCount > 0
                      ? "working"
                      : selectedInvocation.status === "failed" ? "failed" : "completed"
                }
              />
              {invocationMessages.length === 0 ? (
                <EmptyChat
                  tone="invocations"
                  title="Transcript Is Empty"
                  message="This invocation has no stored messages yet. New provider activity will appear here as the runtime records it."
                />
              ) : (
                invocationMessages.map((message) => {
                  if (message.role === "system") {
                    return <TruncatedSystemBubble key={message.id} content={message.contentMarkdown || ""} />;
                  }
                  return (
                    <InvocationMessageBubble
                      key={message.id}
                      message={message}
                      agentAvatarConfig={message.role === "assistant" ? (selectedAgentPreset?.avatarConfig ?? null) : null}
                    />
                  );
                })
              )}
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
        railSlot={(
          <ChatRail title="Threads" count={0} secondaryTitle="Listeners" secondaryCount={0}>
            <ChatRailPlaceholder
              title="No Project Scope"
              message="Connect a project first; the thread rail will then become the live inbox for that workspace."
              actionLabel="Add Project"
              actionTo="/projects"
            />
          </ChatRail>
        )}
        detailSlot={(
          <EmptyChat
            tone="project"
            message="Choose or add a project from the top navigation to unlock stored chat threads, listener routing, and project-scoped conversation history."
          />
        )}
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
