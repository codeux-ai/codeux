import type { FunctionComponent } from "preact";
import { useEffect, useRef } from "preact/hooks";
import {
  ArrowUp,
  RefreshCw,
} from "lucide-preact";
import { ChatThreadHeader } from "./components/chat/ChatThreadHeader.js";
import { ChatPageShell } from "./components/chat/ChatPageShell.js";
import { ChatRail } from "./components/chat/ChatRail.js";
import { ThreadListCard } from "./components/chat/ThreadListCard.js";
import { InvocationListCard } from "./components/chat/InvocationListCard.js";
import { EmptyChat, LoadingChat } from "./components/chat/ChatEmptyState.js";
import { ChatMessageBubble } from "./components/chat/ChatMessageBubble.js";
import { useChatPageData } from "./hooks/use-chat-page-data.js";
import { InvocationMessageBubble } from "./components/chat/InvocationMessageBubble.js";
import { WorkingBubble } from "./components/chat/WorkingBubble.js";
import { ConfirmDialog } from "./components/ui/ConfirmDialog.js";
import { ActionFeedbackRegion } from "./components/ui/ActionFeedbackRegion.js";
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
    connections,
    invocationsLoading,
    invocationMessagesLoading,
    refreshThreads,
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
          <ConfirmDialog isOpen={isConfirmOpen} options={confirmOptions} onConfirm={handleConfirm} onCancel={handleCancel} />
          {feedback.status !== "idle" && (
            <div className="absolute top-4 right-4 z-50 shadow-lg">
              <ActionFeedbackRegion status={feedback.status} message={feedback.message} onDismiss={clearFeedback} />
            </div>
          )}
          <ChatThreadHeader
            thread={selectedThread}
            workerOptions={workerOptions}
            isAssigning={assigningRoute}
            onAssignRoute={(option) => void handleAssignRoute(option)}
            onCompact={() => void handleCompactThread()}
            isCompacting={compacting}
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
