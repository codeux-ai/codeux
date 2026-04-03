const fs = require('fs');

let chatPage = fs.readFileSync('dashboard/src/v2/ChatPage.tsx', 'utf8');

if (!chatPage.includes('useChatPageController')) {
  chatPage = `import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  ArrowUp,
  RefreshCw,
} from "lucide-preact";
import type {
  ChatMessageRecord,
  ExecutionInvocationRecord,
} from "./types.js";
import { isDetailLoading, isListLoading } from "./lib/chat-page-state-utils.js";
import { toChatTimestampMs } from "./lib/chat-time.js";
import { ChatThreadHeader } from "./components/chat/ChatThreadHeader.js";
import { ChatPageShell } from "./components/chat/ChatPageShell.js";
import { ChatRail } from "./components/chat/ChatRail.js";
import { ThreadListCard } from "./components/chat/ThreadListCard.js";
import { InvocationListCard } from "./components/chat/InvocationListCard.js";
import { EmptyChat, LoadingChat } from "./components/chat/ChatEmptyState.js";
import { ChatMessageBubble } from "./components/chat/ChatMessageBubble.js";
import { InvocationMessageBubble } from "./components/chat/InvocationMessageBubble.js";
import { WorkingBubble } from "./components/chat/WorkingBubble.js";
import { useChatPageController } from "./hooks/use-chat-page-controller.js";

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

export const ChatPage: FunctionComponent = () => {
  const messagesRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");

  const controller = useChatPageController();

  useEffect(() => {
    if (!messagesRef.current) return;
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [controller.messages]);

  const activeConnection = useMemo(() => {
    if (!controller.selectedThread?.connectionId) {
      return null;
    }
    return controller.connectionIndex.get(controller.selectedThread.connectionId) || null;
  }, [controller.connectionIndex, controller.selectedThread]);

  const pendingDashboardMessages = controller.messages.filter((message) => (
    message.direction === "dashboard_to_connection" && message.deliveryStatus !== "processed"
  )).length;

  const hasWorkingReply = useMemo(() => controller.messages.some((message) => isWorkingMessage(message, controller.messages)), [controller.messages]);

  const hasProjectSnapshot = Boolean(controller.selectedProject && controller.cache.hasThreads(controller.selectedProject.id));
  const hasThreadSnapshot = Boolean(
    controller.selectedThreadId
    && (controller.cache.hasMessages(controller.selectedThreadId) || (controller.selectedThread?.messageCount || 0) === 0)
  );
  const threadsLoading = isListLoading(controller.selectedProject?.id || null, hasProjectSnapshot, controller.loading);
  const threadMessagesLoading = isDetailLoading(controller.selectedThreadId, hasThreadSnapshot, controller.messagesLoading);

  const hasInvocationProjectSnapshot = Boolean(controller.selectedProject && controller.cache.hasInvocations(controller.selectedProject.id));
  const hasInvocationSnapshot = Boolean(
    controller.selectedInvocationId
    && (controller.cache.hasInvocationMessages(controller.selectedInvocationId) || (controller.selectedInvocation?.messageCount || 0) === 0)
  );
  const invocationsLoading = isListLoading(controller.selectedProject?.id || null, hasInvocationProjectSnapshot, controller.loading);
  const invocationMessagesLoading = isDetailLoading(controller.selectedInvocationId, hasInvocationSnapshot, controller.messagesLoading);

  const renderRail = () => {
    return (
      <ChatRail title="Chat" count={controller.chatMode === "threads" ? controller.threads.length : controller.invocations.length}>
        {controller.chatMode === "threads" ? (
          <ThreadListCard
            threads={controller.threads}
            connections={controller.connections}
            selectedThreadId={controller.selectedThreadId}
            deletingThreadId={controller.deletingThreadId}
            onSelect={(threadId) => {
              const preferredThread = controller.threadIndex.get(threadId) || null;
              void controller.activateThread(threadId, { preferredThread });
            }}
            onDelete={(threadId) => void controller.handleDeleteThread(threadId)}
          />
        ) : (
          <InvocationListCard
            invocations={controller.invocations}
            selectedInvocationId={controller.selectedInvocationId}
            onSelect={(invocationId) => {
              const preferredInvocation = controller.invocationIndex.get(invocationId) || null;
              void controller.activateInvocation(invocationId, { preferredInvocation });
            }}
          />
        )}
      </ChatRail>
    );
  };

  const renderDetail = () => {
    if (controller.chatMode === "threads") {
      return (
        <>
          <ChatThreadHeader
            thread={controller.selectedThread}
            workerOptions={controller.workerOptions}
            isAssigning={controller.assigningRoute}
            onAssignRoute={(option) => void controller.handleAssignRoute(option)}
            onCompact={() => void controller.handleCompactThread()}
            isCompacting={controller.compacting}
          />

          <div ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">
            {threadsLoading ? (
              <LoadingChat label="Loading conversation" />
            ) : !controller.selectedThread ? (
              <EmptyChat message="Select an existing thread or create a new one to start routing dashboard chat through the selected project." />
            ) : threadMessagesLoading ? (
              <LoadingChat label="Loading conversation" />
            ) : controller.messages.length === 0 ? (
              <EmptyChat message="This thread is ready. The next dashboard message will be stored in Sprint OS and queued for a listening MCP connection." />
            ) : (
              <>
                {controller.messages.map((message) => <ChatMessageBubble key={message.id} message={message} />)}
                {hasWorkingReply ? <WorkingBubble displayName={activeConnection?.displayName || null} runtimeState={controller.selectedThread?.runtimeState} /> : null}
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
                  element.style.height = \`\${element.scrollHeight}px\`;
                  setInput(element.value);
                }}
                onKeyDown={(event) => {
                  if (event.isComposing) {
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void controller.handleSend(input, () => {
                      setInput("");
                      if (composerRef.current) {
                        composerRef.current.style.height = "auto";
                      }
                    });
                  }
                }}
              />
              <div className="mt-3 flex items-center justify-between">
                <div className="text-[10px] font-mono text-slate-400">
                  {activeConnection
                    ? \`\${activeConnection.displayName} · \${activeConnection.status} · Enter sends\`
                    : "Messages will stay queued until a listener claims or is assigned to this thread · Enter sends · Shift+Enter newline"}
                </div>
                <button
                  type="button"
                  onClick={() => void controller.handleSend(input, () => {
                      setInput("");
                      if (composerRef.current) {
                        composerRef.current.style.height = "auto";
                      }
                  })}
                  disabled={!controller.selectedProject || !input.trim() || controller.sending}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-[1rem] bg-signal-500 text-void-900 shadow-[0_0_24px_rgba(0,224,160,0.28)] transition-all hover:bg-signal-400 disabled:cursor-not-allowed disabled:bg-black/[0.06] disabled:text-slate-400 disabled:shadow-none dark:disabled:bg-white/[0.06]"
                >
                  {controller.sending ? <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2.2} /> : <ArrowUp className="h-4 w-4" strokeWidth={2.5} />}
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
                {formatInvocationErrorCategory(controller.selectedInvocation?.lastErrorCategory || null) && (
                  <span className="rounded-full border border-status-amber/25 bg-status-amber/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-status-amber">
                    {formatInvocationErrorCategory(controller.selectedInvocation?.lastErrorCategory || null)}
                  </span>
                )}
              </div>
              <h2 className="mt-2 font-display text-3xl font-black tracking-tight text-slate-900 dark:text-white capitalize">
                {controller.selectedInvocation?.type || "No Invocation Selected"}
              </h2>
              {controller.selectedInvocation && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  {controller.selectedInvocation.provider && (
                    <span className="rounded-full border border-black/25 bg-black/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] dark:border-white/25 dark:bg-white/10">
                      {controller.selectedInvocation.provider}
                    </span>
                  )}
                  {controller.selectedInvocation.model && (
                    <span className="rounded-full border border-black/25 bg-black/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] dark:border-white/25 dark:bg-white/10">
                      {controller.selectedInvocation.model}
                    </span>
                  )}
                  <span className={\`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] \${
                    controller.selectedInvocation.status === "failed"
                      ? "border-status-red/25 bg-status-red/10 text-status-red"
                      : controller.selectedInvocation.status === "completed"
                        ? "border-signal-500/25 bg-signal-500/10 text-signal-500"
                        : "border-black/25 bg-black/10 text-slate-500 dark:border-white/25 dark:bg-white/10 dark:text-slate-400"
                  }\`}>
                    {controller.selectedInvocation.status}
                  </span>
                </div>
              )}
              {controller.selectedInvocation?.lastErrorMessage && (
                <div className="mt-3 max-w-2xl text-sm leading-relaxed text-status-amber">
                  {controller.selectedInvocation.lastErrorMessage}
                  {controller.selectedInvocation.lastRetryAfterIso && \` Retry at \${controller.selectedInvocation.lastRetryAfterIso}.\`}
                </div>
              )}
            </div>
            <div className="text-right text-[10px] font-mono text-slate-400">
              <div className="mb-2">{controller.selectedInvocation ? \`\${controller.selectedInvocation.messageCount} messages\` : "0 messages"}</div>
            </div>
          </div>
        </div>

        <div ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">
          {invocationsLoading ? (
            <LoadingChat label="Loading invocations" />
          ) : !controller.selectedInvocation ? (
            <EmptyChat message="Select an existing execution invocation to view its logs and messages." />
          ) : invocationMessagesLoading ? (
            <LoadingChat label="Loading messages" />
          ) : controller.invocationMessages.length === 0 ? (
            <EmptyChat message="No messages found for this invocation." />
          ) : (
            <>
              {controller.invocationMessages.map((message) => <InvocationMessageBubble key={message.id} message={message} />)}
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

  if (!controller.selectedProject) {
    return (
      <ChatPageShell
        selectedProject={null}
        chatMode={controller.chatMode}
        onSetChatMode={controller.setChatMode}
        onRefresh={() => void controller.refreshThreads({ manual: true })}
        manualRefreshing={controller.manualRefreshing}
        onCreateThread={() => void controller.createThreadForCompose()}
        pendingDashboardMessages={pendingDashboardMessages}
        activeConnectionLabel={activeConnection ? \`\${activeConnection.displayName} · \${activeConnection.status}\` : undefined}
        error={controller.error}
        railSlot={<div />}
        detailSlot={<EmptyChat message="Choose a project from the top navigation to load its stored chat threads and messages." />}
      />
    );
  }

  return (
    <ChatPageShell
      selectedProject={controller.selectedProject}
      chatMode={controller.chatMode}
      onSetChatMode={controller.setChatMode}
      onRefresh={() => void controller.refreshThreads({ manual: true })}
      manualRefreshing={controller.manualRefreshing}
      onCreateThread={() => void controller.createThreadForCompose()}
      pendingDashboardMessages={pendingDashboardMessages}
      activeConnectionLabel={activeConnection ? \`\${activeConnection.displayName} · \${activeConnection.status}\` : undefined}
      error={controller.error}
      railSlot={renderRail()}
      detailSlot={renderDetail()}
    />
  );
};
`;
  fs.writeFileSync('dashboard/src/v2/ChatPage.tsx', chatPage);
}
