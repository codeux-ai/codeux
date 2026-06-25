import type { ComponentChildren, FunctionComponent } from "preact";
import { useEffect, useRef, useState, useMemo } from "preact/hooks";
import {
  ArrowUp,
  RefreshCw,
} from "lucide-preact";
import { buildPresetIndex } from "./lib/chat-entity-index.js";
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
import { useProjectEffectiveSettings } from "./hooks/use-project-effective-settings.js";
import { formatInvocationPurpose, formatInvocationDuration, InvocationContextChips } from "./components/chat/invocation-display.js";
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
import {
  formatTokenCount,
  mergeInvocationToolMessages
} from "./lib/chat-widget-view-models.js";


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

  const effectiveSettings = useProjectEffectiveSettings(selectedProject?.id ?? null);
  const sprintKeyPrefix = effectiveSettings.data?.settings?.git?.sprintKeyPrefix || "SPR";

  // Build lookups from agentPresets
  const presetIdMap = useMemo(() => {
    return buildPresetIndex(agentPresets);
  }, [agentPresets]);

  const presetNameMap = useMemo(() => {
    const map = new Map<string, typeof agentPresets[0]>();
    for (const preset of agentPresets) {
      map.set(preset.name.toLowerCase(), preset);
    }
    return map;
  }, [agentPresets]);

  // Resolve agent preset for a message
  const getLinkedAgentPreset = (message: typeof messages[0]) => {
    // a. message.metadata.agentPresetId
    let presetId = message.metadata?.agentPresetId as string | undefined;

    // b. message.metadata.agentId
    if (!presetId) {
      presetId = message.metadata?.agentId as string | undefined;
    }

    // c. selected thread runtime metadata
    if (!presetId && selectedThread?.runtimeState) {
      presetId = (selectedThread.runtimeState as any).agentPresetId || (selectedThread.runtimeState as any).agentId;
    }

    // d. active connection data where available
    if (!presetId && activeConnection) {
      presetId = (activeConnection as any).agentPresetId || (activeConnection as any).agentId || activeConnection.id;
    }

    if (presetId && presetIdMap.has(presetId)) {
      return presetIdMap.get(presetId);
    }

    // e. message.metadata.agentName
    let presetName = message.metadata?.agentName as string | undefined;

    // f. selected thread runtime metadata
    if (!presetName && selectedThread?.runtimeState) {
      presetName = (selectedThread.runtimeState as any).agentName;
    }

    // g. active connection data
    if (!presetName && activeConnection) {
      presetName = activeConnection.displayName;
    }

    if (presetName) {
      const matched = presetNameMap.get(presetName.toLowerCase());
      if (matched) return matched;
    }

    return undefined;
  };

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
            sprintKeyPrefix={sprintKeyPrefix}
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

          <div id="chat-panel" role="log" aria-label="Message history" ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">
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
                {messages.map((message) => {
                  const preset = getLinkedAgentPreset(message);
                  return (
                    <ChatMessageBubble
                      key={message.id}
                      message={message}
                      allMessages={messages}
                      agentAvatarConfig={preset?.avatarConfig}
                      agentName={preset?.name}
                    />
                  );
                })}
                {hasWorkingReply && workingTimerPhase === "starting" ? (
                  <InvocationContainerWidget
                    containerPhase="starting"
                    providerName={selectedThread?.runtimeState?.virtualProvider ?? null}
                    agentName={activeConnection?.displayName || null}
                  />
                ) : hasWorkingReply && workingTimerPhase === "working" ? (
                  <WorkingBubble displayName={activeConnection?.displayName || null} runtimeState={selectedThread?.runtimeState} phase={workingTimerPhase} />
                ) : null}
              </>
            )}
          </div>

          <div className="shrink-0 border-t border-black/[0.05] p-5 dark:border-white/[0.05]">
            <div className={`rounded-2xl border bg-black/[0.03] p-3 focus-within:border-signal-500/30 dark:bg-white/[0.03] ${error ? 'border-status-red/50 dark:border-status-red/50' : 'border-black/[0.06] dark:border-white/[0.06]'}`}>
              <label htmlFor="message-composer" className="sr-only">Message</label>
              <textarea
                id="message-composer"
                aria-describedby="composer-help"
                ref={composerRef}
                value={input}
                rows={1}
                placeholder={activeConnection ? "Ask anything..." : "Write a project note or queue a message..."}
                className="max-h-[180px] min-h-[38px] w-full resize-none bg-transparent px-2 py-2 text-[15px] min-w-0 leading-relaxed text-slate-900 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-slate-600"
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
              <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div id="composer-help" className="text-[10px] font-mono text-slate-400">
                  {activeConnection
                    ? `${activeConnection.displayName} · ${activeConnection.status} · Enter sends`
                    : "Messages will stay queued until a listener claims or is assigned to this thread · Enter sends · Shift+Enter newline"}
                </div>
                <div className="sr-only" aria-live="polite">
                  {sending ? "Sending message..." : ""}
                  {error ? `Failed: ${error}` : ""}
                </div>
                <button
                  aria-label="Send message"
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={!selectedProject || !input.trim() || sending}
                  className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[1rem] transition-all self-end sm:self-auto ${
                    !selectedProject || (!input.trim() && !sending)
                      ? "cursor-not-allowed bg-black/[0.06] text-slate-400 shadow-none dark:bg-white/[0.06]"
                      : sending
                        ? "cursor-wait bg-signal-500/50 text-void-900 shadow-none scale-95"
                        : "bg-signal-500 text-void-900 shadow-[0_0_24px_rgba(0,224,160,0.28)] hover:bg-signal-400 hover:scale-105 active:scale-95"
                  }`}
                >
                  {sending ? <RefreshCw className="h-4 w-4 animate-spin text-void-900/70" /> : <ArrowUp className="h-5 w-5" strokeWidth={2.5} />}
                </button>
              </div>
            </div>
          </div>
        </>
      );
    }

    // Clean horizontal stat strip for the active invocation header — mirrors the
    // list card's label/value table, only meaningful entries are shown.
    const inv = selectedInvocation;
    const headerStatus = inv
      ? inv.status === "failed"
        ? { dot: "bg-status-red shadow-[0_0_6px_rgba(227,0,15,0.5)]", text: "text-status-red" }
        : inv.status === "running"
          ? { dot: "bg-signal-500 shadow-[0_0_6px_rgba(0,224,160,0.6)] animate-pulse", text: "text-signal-500" }
          : inv.status === "completed"
            ? { dot: "bg-[#00AB84] shadow-[0_0_6px_rgba(0,171,132,0.4)]", text: "text-[#00AB84]" }
            : { dot: "bg-slate-400", text: "text-slate-500" }
      : null;
    const headerDuration = inv ? formatInvocationDuration(inv.startedAt || inv.createdAt, inv.finishedAt) : null;
    const headerTotalTokens = inv ? (inv.totalTokens ?? ((inv.inputTokens ?? 0) + (inv.outputTokens ?? 0))) : 0;
    const headerStats: Array<{ label: string; value: ComponentChildren; tone?: string }> = [];
    if (inv && headerStatus) {
      headerStats.push({
        label: "Status",
        value: (
          <span className={`flex items-center gap-1.5 ${headerStatus.text}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${headerStatus.dot}`} />
            <span className="capitalize">{inv.status}</span>
          </span>
        ),
      });
      headerStats.push({ label: "Messages", value: inv.messageCount ?? 0 });
      if ((inv.inputTokens ?? 0) > 0) headerStats.push({ label: "Input", value: formatTokenCount(inv.inputTokens), tone: "text-signal-600 dark:text-signal-400" });
      if ((inv.outputTokens ?? 0) > 0) headerStats.push({ label: "Output", value: formatTokenCount(inv.outputTokens), tone: "text-purple-600 dark:text-purple-400" });
      if ((inv.cachedInputTokens ?? 0) > 0) headerStats.push({ label: "Cached", value: formatTokenCount(inv.cachedInputTokens), tone: "text-teal-600 dark:text-teal-400" });
      if (headerTotalTokens > 0) headerStats.push({ label: "Total", value: formatTokenCount(headerTotalTokens) });
      if (headerDuration) headerStats.push({ label: "Duration", value: headerDuration });
    }

    return (
      <>
        <div className="shrink-0 border-b border-black/[0.05] px-6 py-6 dark:border-white/[0.05]">
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

            <div className="min-w-0 flex-1 break-words">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-signal-500">
                <span>Active Invocation</span>
                {formatInvocationErrorCategory(selectedInvocation?.lastErrorCategory || null) && (
                  <span className="rounded-full border border-status-amber/25 bg-status-amber/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-status-amber">
                    {formatInvocationErrorCategory(selectedInvocation?.lastErrorCategory || null)}
                  </span>
                )}
              </div>

              {/* Title: purpose */}
              <h1 className="mt-1.5 font-display text-3xl font-black tracking-tight text-slate-900 dark:text-white">
                {formatInvocationPurpose(selectedInvocation?.type)}
              </h1>

              {/* Provider · model subline */}
              {selectedInvocation && (
                <div className="mt-1 flex items-center gap-1.5 text-[12px] text-slate-500 dark:text-slate-400">
                  {selectedInvocation.provider && <ProviderLogo provider={selectedInvocation.provider} size={14} />}
                  <span className="font-medium">
                    {selectedInvocation.provider || "—"}
                    {selectedInvocation.model ? <span className="text-slate-400 dark:text-slate-500"> · {selectedInvocation.model}</span> : null}
                  </span>
                  {selectedAgentPreset && (
                    <>
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                      <span className="font-medium">{selectedAgentPreset.name}</span>
                    </>
                  )}
                </div>
              )}

              {/* Sprint key / task number — linked to their respective pages */}
              {selectedInvocation && (
                <div className="mt-2.5 empty:hidden">
                  <InvocationContextChips invocation={selectedInvocation} sprintKeyPrefix={sprintKeyPrefix} />
                </div>
              )}

              {/* Clean horizontal stat strip */}
              {headerStats.length > 0 && (
                <div className="mt-3 flex w-full flex-wrap items-stretch divide-x-0 sm:divide-x divide-y sm:divide-y-0 divide-black/[0.06] overflow-hidden rounded-xl border border-black/[0.06] bg-black/[0.02] dark:divide-white/[0.06] dark:border-white/[0.06] dark:bg-white/[0.02]">
                  {headerStats.map((stat) => (
                    <div key={stat.label} className="flex flex-1 flex-col gap-0.5 whitespace-nowrap px-3.5 py-2">
                      <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
                        {stat.label}
                      </span>
                      <span className={`font-mono text-[13px] font-semibold tabular-nums ${stat.tone || "text-slate-700 dark:text-slate-200"}`}>
                        {stat.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {selectedInvocation?.lastErrorMessage && (
                <div className="mt-3 max-w-2xl text-sm leading-relaxed text-status-amber">
                  {selectedInvocation.lastErrorMessage}
                  {selectedInvocation.lastRetryAfterIso && ` Retry at ${selectedInvocation.lastRetryAfterIso}.`}
                </div>
              )}

              {/* Invocation id — tiny */}
              {selectedInvocation && (
                <div className="mt-2.5 font-mono text-[10px] text-slate-300 dark:text-slate-600">
                  {selectedInvocation.id}
                </div>
              )}
            </div>
          </div>
        </div>

        <div id="chat-panel" role="log" aria-label="Message history" ref={messagesRef} className="flex-1 min-h-0 space-y-6 overflow-y-auto px-6 py-6">
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
                mergeInvocationToolMessages(invocationMessages).map((message) => {
                  if (message.role === "system") {
                    return <TruncatedSystemBubble key={message.id} content={message.contentMarkdown || ""} />;
                  }
                  return (
                    <InvocationMessageBubble
                      key={message.id}
                      message={message}
                      agentAvatarConfig={message.role === "assistant" ? (selectedAgentPreset?.avatarConfig ?? null) : null}
                      agentName={message.role === "assistant" ? (selectedAgentPreset?.name ?? null) : null}
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
