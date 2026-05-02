import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ChatMessageRecord, ChatThread } from "../types.js";
import { useMessageCache } from "./useMessageCache.js";
import {
  createConversationThread,
  deleteConversationThread,
  fetchConversationMessages,
  postConversationMessage,
  updateConversationThread,
  updateThreadRoute,
  compactThreadSession,
} from "../lib/connection-api.js";
import { resolveSelectedItemId } from "../lib/chat-page-state-utils.js";
import { upsertChatThread } from "../lib/chat-thread-utils.js";
import { buildThreadIndex } from "../lib/chat-entity-index.js";
import { toChatTimestampMs } from "../lib/chat-time.js";
import { useActionFeedback } from "./use-action-feedback.js";
import { useConfirmDialog } from "./use-confirm-dialog.js";
import { getProjectWorkerOptions, type WorkerRoutingPreference } from "../lib/project-worker-options.js";
import type { RefObject } from "preact";
import type { ExecutionDashboardSnapshot } from "../../types.js";

export const upsertMessage = (messages: ChatMessageRecord[], nextMessage: ChatMessageRecord): ChatMessageRecord[] => {
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

export const removeThread = (threads: ChatThread[], threadId: string): ChatThread[] => (
  threads.filter((thread) => thread.id !== threadId)
);

export const areThreadsEqual = (left: ChatThread[], right: ChatThread[]): boolean => (
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

export const areMessagesEqual = (left: ChatMessageRecord[], right: ChatMessageRecord[]): boolean => (
  left.length === right.length
  && left.every((message, index) => {
    const candidate = right[index];
    return Boolean(candidate)
      && candidate.id === message.id
      && candidate.createdAt === message.createdAt
      && candidate.deliveryStatus === message.deliveryStatus;
  })
);

export const isWorkingMessage = (
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

export const useChatThreadData = (options: {
  selectedProject: { id: string } | null;
  cache: ReturnType<typeof useMessageCache>;
  execution: ExecutionDashboardSnapshot | null;
  workerRouting: WorkerRoutingPreference | null;
  composerRef?: RefObject<HTMLTextAreaElement>;
  messagesRef?: RefObject<HTMLDivElement>;
}) => {
  const { selectedProject, cache, execution, workerRouting, composerRef, messagesRef } = options;

  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [input, setInput] = useState("");
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [assigningRoute, setAssigningRoute] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedThreadIdRef = useRef<string | null>(null);
  const threadsRef = useRef<ChatThread[]>([]);
  const inflightMessageFetchesRef = useRef(new Map<string, Promise<ChatMessageRecord[]>>());
  const activationTokenRef = useRef(0);

  const { feedback, setSuccess, clearFeedback } = useActionFeedback();
  const {
    isOpen: isConfirmOpen,
    options: confirmOptions,
    requestConfirm,
    handleConfirm,
    handleCancel,
  } = useConfirmDialog();

  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
  }, [selectedThreadId]);

  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  const threadIndex = useMemo(() => buildThreadIndex(threads), [threads]);
  const selectedThread = useMemo(
    () => (selectedThreadId ? threadIndex.get(selectedThreadId) || null : null),
    [threadIndex, selectedThreadId]
  );

  const setThreadsSnapshot = useCallback((nextThreads: ChatThread[]): void => {
    setThreads((current) => areThreadsEqual(current, nextThreads) ? current : nextThreads);
  }, []);

  const setMessagesSnapshot = useCallback((nextMessages: ChatMessageRecord[]): void => {
    setMessages((current) => areMessagesEqual(current, nextMessages) ? current : nextMessages);
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

  const activateThread = useCallback(async (
    threadId: string | null,
    activateOptions?: { foreground?: boolean; preferredThread?: ChatThread | null },
  ): Promise<void> => {
    activationTokenRef.current += 1;
    const activationToken = activationTokenRef.current;

    if (!threadId) {
      setSelectedThreadId(null);
      setMessagesSnapshot([]);
      setMessagesLoading(false);
      return;
    }

    const targetThread = activateOptions?.preferredThread || threadsRef.current.find((thread) => thread.id === threadId) || null;
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

    if (activateOptions?.foreground) {
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

  const refreshMessages = useCallback(async (
    threadId: string | null,
    refreshOptions?: { foreground?: boolean; force?: boolean },
  ): Promise<void> => {
    if (!threadId) {
      setMessagesSnapshot([]);
      setMessagesLoading(false);
      return;
    }

    if (refreshOptions?.foreground) {
      setMessagesLoading(true);
    }

    try {
      const nextMessages = refreshOptions?.force
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
      if (refreshOptions?.foreground) {
        setMessagesLoading(false);
      }
    }
  }, [cache, ensureMessagesLoaded, setMessagesSnapshot]);

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
  }, [activateThread, cache, selectedProject, setThreadsSnapshot]);

  const handleAssignRoute = useCallback(async (option: { id: string, label: string, status: string, isPrimary: boolean, type: string, isSelectable: boolean, connectionId?: string | null, workerEndpointId?: string | null, providerId?: string }): Promise<void> => {
    if (!selectedThread) {
      return;
    }

    const confirmed = await requestConfirm({
      title: "Reassign Route?",
      body: "This will route future messages in this thread to a different connection.",
      confirmLabel: "Reassign",
    });

    if (!confirmed) return;

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
      setSuccess("Route updated.");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError));
    } finally {
      setAssigningRoute(false);
    }
  }, [cache, refreshMessages, requestConfirm, selectedProject, selectedThread, setSuccess, setThreadsSnapshot]);

  const handleCompactThread = useCallback(async (): Promise<void> => {
    if (!selectedThread) {
      return;
    }

    const confirmed = await requestConfirm({
      title: "Compact Thread?",
      body: "This will truncate previous active sessions.",
      confirmLabel: "Compact",
    });

    if (!confirmed) return;

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
      setSuccess("Thread compacted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCompacting(false);
    }
  }, [cache, refreshMessages, requestConfirm, selectedProject, selectedThread, setSuccess, setThreadsSnapshot]);

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
      if (composerRef?.current) {
        composerRef.current.style.height = "auto";
      }
      const nextMessages = upsertMessage(cache.getMessages(thread.id) || [], created);
      cache.setMessages(thread.id, nextMessages);
      if (thread.id === selectedThreadIdRef.current) {
        setMessagesSnapshot(nextMessages);
      }

      // Removed refreshThreads() call since cache is optimistically updated and realtime
      // will handle the rest without needing full fetch.
      setError(null);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : String(sendError));
    } finally {
      setSending(false);
    }
  }, [cache, composerRef, createThreadForCompose, execution, input, selectedProject, selectedThread, setMessagesSnapshot, workerRouting]);

  const handleDeleteThread = useCallback(async (threadId: string): Promise<void> => {
    const confirmed = await requestConfirm({
      title: "Delete Thread?",
      body: "Are you sure you want to delete this conversation?",
      confirmLabel: "Delete",
      destructive: true,
    });

    if (!confirmed) return;

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
      setSuccess("Thread deleted.");
    } catch (deleteError) {
      // Assuming parent handles broad refresh, but since we optimistically updated, if error, we might be out of sync.
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setDeletingThreadId((current) => current === threadId ? null : current);
    }
  }, [activateThread, cache, requestConfirm, selectedProject, selectedThreadId, setSuccess, setThreadsSnapshot]);

  return {
    threads,
    setThreadsSnapshot,
    selectedThreadId,
    setSelectedThreadId,
    selectedThreadIdRef,
    threadsRef,
    messages,
    setMessagesSnapshot,
    input,
    setInput,
    messagesLoading,
    deletingThreadId,
    sending,
    assigningRoute,
    compacting,
    error,
    setError,
    selectedThread,
    threadIndex,
    activateThread,
    refreshMessages,
    createThreadForCompose,
    handleAssignRoute,
    handleCompactThread,
    handleSend,
    handleDeleteThread,
    feedback,
    clearFeedback,
    isConfirmOpen,
    confirmOptions,
    handleConfirm,
    handleCancel,
  };
};
