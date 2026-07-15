import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ChatMessageRecord, ChatThread } from "../types.js";
import type { DashboardCreateAppQuickactionKind, DashboardCreateAppQuickactionMetadata } from "../types.js";
import { useMessageCache } from "./useMessageCache.js";
import {
  createConversationThread,
  deleteConversationThread,
  fetchConversationDraft,
  fetchConversationMessages,
  getOrCreateDashboardDraftUserId,
  postConversationMessage,
  updateConversationThread,
  compactThreadSession,
  cancelThreadTurn,
  fetchConversationMessageHistory,
  recordConversationMessageHistory,
  upsertConversationDraft,
} from "../lib/connection-api.js";
import { resolveSelectedItemId } from "../lib/chat-page-state-utils.js";
import { upsertChatThread } from "../lib/chat-thread-utils.js";
import { buildThreadIndex } from "../lib/chat-entity-index.js";
import { toChatTimestampMs } from "../lib/chat-time.js";
import { useActionFeedback } from "./use-action-feedback.js";
import { useConfirmDialog } from "./use-confirm-dialog.js";
import type { RefObject } from "preact";
import type { DashboardSettings, ExecutionDashboardSnapshot, TechstackCatalogEntrySettings } from "../../types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../lib/settings.js";
import { getCreateAppQuickactionSpec } from "../../../../src/domain/chat/create-app-quickaction-catalog.js";
import { useDashboardI18n } from "../i18n/context.js";
import { chatMessages } from "../i18n/messages/chat.js";

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
      && candidate.title === thread.title
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

export const resolveDisplayDeliveryStatus = (
  message: ChatMessageRecord,
  allMessages: ChatMessageRecord[],
): ChatMessageRecord["deliveryStatus"] | "processed" => {
  if (message.deliveryStatus === "failed") {
    return "failed";
  }

  const invocationResponse = message.metadata?.response;
  const hasInvocationResponse = typeof invocationResponse === "string"
    ? invocationResponse.trim().length > 0
    : Boolean(invocationResponse);

  const status = message.deliveryStatus === "pending" && hasInvocationResponse
    ? "processed"
    : message.deliveryStatus;

  if (message.direction !== "dashboard_to_connection") {
    return status;
  }

  const messageTime = toChatTimestampMs(message.createdAt);
  const hasLaterReply = allMessages.some((candidate) => (
    candidate.threadId === message.threadId
    && candidate.direction === "connection_to_dashboard"
    && toChatTimestampMs(candidate.createdAt) >= messageTime
  ));

  if (hasLaterReply) {
    return "processed";
  }

  return status;
};

const NEW_THREAD_DRAFT_CONTEXT_KEY = "new-thread";
const CHAT_DRAFT_WRITE_DEBOUNCE_MS = 500;
const LOCAL_CHAT_DRAFT_STORAGE_PREFIX = "codeux.chat.localDraft";

const createCryptoRandomId = (): string => {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  throw new Error("Secure random generation is unavailable.");
};

const createQuickactionRequestId = (kind: DashboardCreateAppQuickactionKind): string => {
  return `dashboard-create-app-${kind}-${createCryptoRandomId()}`;
};

const normalizeStackToken = (value: string): string => value.toLowerCase().replace(/[^a-z0-9+#.]+/g, "");

const findStackItemLabel = (
  entry: TechstackCatalogEntrySettings,
  matches: string[],
): string | null => {
  const normalizedMatches = new Set(matches.map(normalizeStackToken));
  const item = entry.items.find((candidate) => {
    const id = normalizeStackToken(candidate.id);
    const label = normalizeStackToken(candidate.label);
    return normalizedMatches.has(id) || normalizedMatches.has(label);
  });
  return item?.label || null;
};

const uniqueStackSuggestionTags = (entry: TechstackCatalogEntrySettings): string[] => {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const label of entry.items.map((item) => item.label.trim()).filter(Boolean)) {
    const key = label.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      tags.push(label);
    }
  }
  return tags;
};

const resolveCreateAppTechstackEntry = (
  dashboardSettings: DashboardSettings | null | undefined,
): { id: string; entry: TechstackCatalogEntrySettings } => {
  const settings = dashboardSettings ?? DEFAULT_DASHBOARD_SETTINGS;
  const catalog = settings.techstackCatalog.entries.length > 0
    ? settings.techstackCatalog
    : DEFAULT_DASHBOARD_SETTINGS.techstackCatalog;
  const selectedTechstackId = settings.techstack.selectedTechstackId || catalog.defaultTechstackId;
  const defaultEntry = catalog.entries.find((entry) => entry.id === catalog.defaultTechstackId)
    ?? DEFAULT_DASHBOARD_SETTINGS.techstackCatalog.entries[0]!;
  const entry = catalog.entries.find((candidate) => candidate.id === selectedTechstackId)
    ?? defaultEntry;

  return { id: entry.id, entry };
};

const buildCreateAppStackSummary = (
  kind: DashboardCreateAppQuickactionKind,
  techstackId: string,
  entry: TechstackCatalogEntrySettings,
): NonNullable<DashboardCreateAppQuickactionMetadata["quickaction"]["stackSummary"]> => ({
  techstackId,
  techstackName: entry.label,
  applicationKind: kind,
  language: findStackItemLabel(entry, ["typescript", "javascript", "python", "go", "rust", "java", "c#", "swift", "kotlin"]),
  framework: findStackItemLabel(entry, ["preact", "react", "next.js", "nextjs", "vue", "svelte", "angular", "solid", "vite"]),
  runtime: findStackItemLabel(entry, ["node.js", "nodejs", "node", "bun", "deno", "electron", "tauri"]),
  packageManager: findStackItemLabel(entry, ["pnpm", "npm", "yarn", "bun"]),
  styling: findStackItemLabel(entry, ["tailwind", "tailwindcss", "css", "sass", "scss", "styledcomponents", "vanillaextract"]),
  testFramework: findStackItemLabel(entry, ["vitest", "jest", "playwright", "cypress"]),
});

const buildCreateAppQuickactionMetadata = (
  kind: DashboardCreateAppQuickactionKind,
  dashboardSettings?: DashboardSettings | null,
): DashboardCreateAppQuickactionMetadata => {
  const { id, entry } = resolveCreateAppTechstackEntry(dashboardSettings);
  const spec = getCreateAppQuickactionSpec(kind);

  return {
    quickaction: {
      type: "create_app",
      kind,
      requestId: createQuickactionRequestId(kind),
      templateId: spec.templateId,
      designGuidance: { ...spec.designGuidance },
      stackSummary: buildCreateAppStackSummary(kind, id, entry),
      suggestionTags: uniqueStackSuggestionTags(entry),
    },
  };
};

const buildLocalDraftStorageKey = (input: {
  projectId: string;
  userId: string;
  contextKey: string;
}): string => `${LOCAL_CHAT_DRAFT_STORAGE_PREFIX}:${input.projectId}:${input.userId}:${input.contextKey}`;

const readLocalChatDraft = (input: {
  projectId: string;
  userId: string;
  contextKey: string;
}): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(buildLocalDraftStorageKey(input));
  } catch {
    return null;
  }
};

const writeLocalChatDraft = (input: {
  projectId: string | null;
  userId: string | null;
  contextKey: string | null;
  bodyMarkdown: string;
}): void => {
  if (typeof window === "undefined" || !input.projectId || !input.userId || !input.contextKey) {
    return;
  }
  try {
    window.localStorage.setItem(
      buildLocalDraftStorageKey({
        projectId: input.projectId,
        userId: input.userId,
        contextKey: input.contextKey,
      }),
      input.bodyMarkdown,
    );
  } catch {
    // Local draft persistence is a best-effort refresh fallback.
  }
};

export const useChatThreadData = (options: {
  selectedProject: { id: string } | null;
  cache: ReturnType<typeof useMessageCache>;
  execution: ExecutionDashboardSnapshot | null;
  dashboardSettings?: DashboardSettings | null;
  composerRef?: RefObject<HTMLTextAreaElement>;
  messagesRef?: RefObject<HTMLDivElement>;
  workerRouting?: unknown;
  onMessageSending?: (message: { projectId: string; createdAt: string }) => string | null | void;
  onMessageSent?: (payload: { message: ChatMessageRecord; optimisticInvocationId?: string | null }) => void;
  onMessageSendFailed?: (optimisticInvocationId: string) => void;
}) => {
  const { formatDate, translate } = useDashboardI18n();
  const { selectedProject, cache, execution, dashboardSettings, composerRef, messagesRef, onMessageSent } = options;

  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [selectedThreadId, setSelectedThreadIdState] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [input, setInputState] = useState("");
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedThreadIdRef = useRef<string | null>(null);
  const threadsRef = useRef<ChatThread[]>([]);
  const draftContextKeyRef = useRef<string | null>(null);
  const draftProjectIdRef = useRef<string | null>(null);
  const draftUserIdRef = useRef<string | null>(null);
  const inputContextKeyRef = useRef<string | null>(null);
  const inputRef = useRef("");
  const latestDraftRequestRef = useRef(0);
  const lastSavedDraftRef = useRef<{ contextKey: string; bodyMarkdown: string } | null>(null);
  const inflightMessageFetchesRef = useRef(new Map<string, Promise<ChatMessageRecord[]>>());
  const activationTokenRef = useRef(0);
  const sentHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const historyDraftRef = useRef<string>("");
  const isHistoryPreviewRef = useRef(false);
  const latestHistoryRequestRef = useRef(0);
  const [hydratedDraftContextKey, setHydratedDraftContextKey] = useState<string | null>(null);

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
  const resolveDraftContextKey = useCallback((threadId: string | null): string | null => {
    if (!selectedProject) {
      return null;
    }
    if (!threadId) {
      return NEW_THREAD_DRAFT_CONTEXT_KEY;
    }

    const thread = threadIndex.get(threadId);
    return thread?.projectId === selectedProject.id
      ? `thread:${threadId}`
      : NEW_THREAD_DRAFT_CONTEXT_KEY;
  }, [selectedProject?.id, threadIndex]);
  const activeDraftContextKey = useMemo(
    () => resolveDraftContextKey(selectedThreadId),
    [resolveDraftContextKey, selectedThreadId],
  );

  const flushDraftSnapshot = useCallback((snapshot: {
    projectId: string | null;
    userId: string | null;
    contextKey: string | null;
    bodyMarkdown: string;
  }): void => {
    writeLocalChatDraft(snapshot);
    if (!snapshot.projectId || !snapshot.userId || !snapshot.contextKey) {
      return;
    }
    const lastSaved = lastSavedDraftRef.current;
    if (lastSaved?.contextKey === snapshot.contextKey && lastSaved.bodyMarkdown === snapshot.bodyMarkdown) {
      return;
    }
    void upsertConversationDraft(snapshot.projectId, {
      userId: snapshot.userId,
      contextKey: snapshot.contextKey,
      bodyMarkdown: snapshot.bodyMarkdown,
    }).then(() => {
      lastSavedDraftRef.current = {
        contextKey: snapshot.contextKey!,
        bodyMarkdown: snapshot.bodyMarkdown,
      };
    }).catch(() => {
      // Draft persistence should never block navigation or unmount.
    });
  }, []);

  const getPersistableInput = useCallback((): string => (
    isHistoryPreviewRef.current ? historyDraftRef.current : inputRef.current
  ), []);

  const resetHistoryTraversal = useCallback((): void => {
    historyIndexRef.current = -1;
    historyDraftRef.current = "";
    isHistoryPreviewRef.current = false;
  }, []);

  const setSelectedThreadId = useCallback((threadId: string | null): void => {
    if (inputContextKeyRef.current === draftContextKeyRef.current) {
      flushDraftSnapshot({
        projectId: draftProjectIdRef.current,
        userId: draftUserIdRef.current,
        contextKey: draftContextKeyRef.current,
        bodyMarkdown: getPersistableInput(),
      });
    }
    draftContextKeyRef.current = resolveDraftContextKey(threadId);
    resetHistoryTraversal();
    setSelectedThreadIdState(threadId);
  }, [flushDraftSnapshot, getPersistableInput, resetHistoryTraversal, resolveDraftContextKey]);

  const setInput = useCallback((nextInput: string | ((current: string) => string)): void => {
    const contextKey = draftContextKeyRef.current;
    resetHistoryTraversal();
    setInputState((current) => {
      const nextValue = typeof nextInput === "function" ? nextInput(current) : nextInput;
      inputRef.current = nextValue;
      inputContextKeyRef.current = contextKey;
      writeLocalChatDraft({
        projectId: draftProjectIdRef.current,
        userId: draftUserIdRef.current,
        contextKey,
        bodyMarkdown: nextValue,
      });
      return nextValue;
    });
  }, [resetHistoryTraversal]);

  const setInputFromHistoryPreview = useCallback((nextInput: string): void => {
    const contextKey = draftContextKeyRef.current;
    isHistoryPreviewRef.current = true;
    setInputState(() => {
      inputRef.current = nextInput;
      inputContextKeyRef.current = contextKey;
      return nextInput;
    });
  }, []);

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  useEffect(() => {
    if (inputContextKeyRef.current === draftContextKeyRef.current) {
      flushDraftSnapshot({
        projectId: draftProjectIdRef.current,
        userId: draftUserIdRef.current,
        contextKey: draftContextKeyRef.current,
        bodyMarkdown: getPersistableInput(),
      });
    }

    draftContextKeyRef.current = activeDraftContextKey;
    draftProjectIdRef.current = selectedProject?.id ?? null;
    lastSavedDraftRef.current = null;
    setHydratedDraftContextKey(null);
    resetHistoryTraversal();
    if (inputContextKeyRef.current !== activeDraftContextKey) {
      inputContextKeyRef.current = activeDraftContextKey;
      inputRef.current = "";
      setInputState("");
    }

    if (!selectedProject || !activeDraftContextKey) {
      return;
    }

    const userId = getOrCreateDashboardDraftUserId();
    draftUserIdRef.current = userId;
    const localDraft = readLocalChatDraft({
      projectId: selectedProject.id,
      userId,
      contextKey: activeDraftContextKey,
    });
    const hasLocalDraft = localDraft !== null;
    if (localDraft !== null) {
      setInputState((current) => {
        if (inputRef.current) {
          return current;
        }
        inputRef.current = localDraft;
        inputContextKeyRef.current = activeDraftContextKey;
        return localDraft;
      });
    }
    const requestId = latestDraftRequestRef.current + 1;
    latestDraftRequestRef.current = requestId;

    void fetchConversationDraft(selectedProject.id, {
      userId,
      contextKey: activeDraftContextKey,
    })
      .then((draft) => {
        if (
          latestDraftRequestRef.current !== requestId
          || draftContextKeyRef.current !== activeDraftContextKey
        ) {
          return;
        }

        const restored = draft?.bodyMarkdown ?? "";
        lastSavedDraftRef.current = {
          contextKey: activeDraftContextKey,
          bodyMarkdown: restored,
        };
        if (hasLocalDraft) {
          setHydratedDraftContextKey(activeDraftContextKey);
          return;
        }
        setInputState((current) => {
          if (inputRef.current) {
            return current;
          }
          inputRef.current = restored;
          inputContextKeyRef.current = activeDraftContextKey;
          return restored;
        });
        setHydratedDraftContextKey(activeDraftContextKey);
      })
      .catch(() => {
        if (
          latestDraftRequestRef.current === requestId
          && draftContextKeyRef.current === activeDraftContextKey
        ) {
          lastSavedDraftRef.current = {
            contextKey: activeDraftContextKey,
            bodyMarkdown: inputRef.current,
          };
          setHydratedDraftContextKey(activeDraftContextKey);
        }
      });
  }, [activeDraftContextKey, flushDraftSnapshot, getPersistableInput, resetHistoryTraversal, selectedProject?.id]);

  useEffect(() => () => {
    if (inputContextKeyRef.current !== draftContextKeyRef.current) {
      return;
    }
    flushDraftSnapshot({
      projectId: draftProjectIdRef.current,
      userId: draftUserIdRef.current,
      contextKey: draftContextKeyRef.current,
      bodyMarkdown: getPersistableInput(),
    });
  }, [flushDraftSnapshot, getPersistableInput]);

  useEffect(() => {
    resetHistoryTraversal();
    if (!selectedProject) {
      sentHistoryRef.current = [];
      return;
    }

    const userId = draftUserIdRef.current ?? getOrCreateDashboardDraftUserId();
    draftUserIdRef.current = userId;
    const requestId = latestHistoryRequestRef.current + 1;
    latestHistoryRequestRef.current = requestId;

    void fetchConversationMessageHistory(selectedProject.id, { userId })
      .then((history) => {
        if (
          latestHistoryRequestRef.current !== requestId
          || draftProjectIdRef.current !== selectedProject.id
        ) {
          return;
        }
        sentHistoryRef.current = history
          .map((entry) => entry.bodyMarkdown.trim())
          .filter((entry) => entry.length > 0);
        resetHistoryTraversal();
      })
      .catch(() => {
        if (latestHistoryRequestRef.current === requestId) {
          sentHistoryRef.current = [];
          resetHistoryTraversal();
        }
      });
  }, [resetHistoryTraversal, selectedProject?.id]);

  useEffect(() => {
    if (
      !selectedProject
      || !activeDraftContextKey
      || hydratedDraftContextKey !== activeDraftContextKey
      || inputContextKeyRef.current !== activeDraftContextKey
      || isHistoryPreviewRef.current
    ) {
      return;
    }

    const userId = draftUserIdRef.current ?? getOrCreateDashboardDraftUserId();
    draftUserIdRef.current = userId;
    const currentInput = input;
    const lastSaved = lastSavedDraftRef.current;
    if (lastSaved?.contextKey === activeDraftContextKey && lastSaved.bodyMarkdown === currentInput) {
      return;
    }

    const timeout = window.setTimeout(() => {
      if (
        draftContextKeyRef.current !== activeDraftContextKey
        || inputContextKeyRef.current !== activeDraftContextKey
      ) {
        return;
      }
      const bodyMarkdown = inputRef.current;
      writeLocalChatDraft({
        projectId: selectedProject.id,
        userId,
        contextKey: activeDraftContextKey,
        bodyMarkdown,
      });
      void upsertConversationDraft(selectedProject.id, {
        userId,
        contextKey: activeDraftContextKey,
        bodyMarkdown,
      }).then(() => {
        if (draftContextKeyRef.current === activeDraftContextKey) {
          lastSavedDraftRef.current = {
            contextKey: activeDraftContextKey,
            bodyMarkdown,
          };
        }
      }).catch(() => {
        // Draft persistence should never block normal chat input or sending.
      });
    }, CHAT_DRAFT_WRITE_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [activeDraftContextKey, hydratedDraftContextKey, input, selectedProject?.id]);

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
      selectedThreadIdRef.current = threadId;
      setSelectedThreadId(threadId);
      setMessagesSnapshot(cachedMessages);
      setMessagesLoading(false);
      return;
    }

    if ((targetThread?.messageCount || 0) === 0) {
      cache.setMessages(threadId, []);
      selectedThreadIdRef.current = threadId;
      setSelectedThreadId(threadId);
      setMessagesSnapshot([]);
      setMessagesLoading(false);
      return;
    }

    if (activateOptions?.foreground) {
      selectedThreadIdRef.current = threadId;
      setSelectedThreadId(threadId);
      setMessagesSnapshot([]);
      setMessagesLoading(true);
    }

    try {
      const nextMessages = await ensureMessagesLoaded(threadId);
      if (activationToken !== activationTokenRef.current) {
        return;
      }
      selectedThreadIdRef.current = threadId;
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
      throw new Error(translate(chatMessages, "selectProjectBeforeThread"));
    }
    const thread = await createConversationThread(selectedProject.id, {
      title: translate(chatMessages, "projectChatTitle", { date: formatDate(new Date(), { month: "short", day: "numeric" }) }),
    });
    const nextThreads = upsertChatThread(cache.getThreads(selectedProject.id) || threadsRef.current, thread);
    cache.setThreads(selectedProject.id, nextThreads);
    cache.setMessages(thread.id, []);
    setThreadsSnapshot(nextThreads);
    await activateThread(thread.id, { preferredThread: thread });
    return thread;
  }, [activateThread, cache, selectedProject, setThreadsSnapshot]);

  const handleCompactThread = useCallback(async (): Promise<void> => {
    if (!selectedThread) {
      return;
    }

    const confirmed = await requestConfirm({
      title: translate(chatMessages, "compactThreadQuestion"),
      body: translate(chatMessages, "compactThreadBody"),
      confirmLabel: translate(chatMessages, "compact"),
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
      setSuccess(translate(chatMessages, "threadCompacted"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCompacting(false);
    }
  }, [cache, refreshMessages, requestConfirm, selectedProject, selectedThread, setSuccess, setThreadsSnapshot]);

  const handleCancelActiveTurn = useCallback(async (): Promise<void> => {
    if (!selectedThread) {
      return;
    }

    setIsCancelling(true);
    try {
      const result = await cancelThreadTurn(selectedThread.id);
      if (!result.cancelled) {
        return;
      }

      const nextThreads = (cache.getThreads(selectedProject?.id || "") || threadsRef.current).map((thread) => (
        thread.id === selectedThread.id
          ? { ...thread, pendingMessageCount: 0 }
          : thread
      ));

      if (selectedProject) {
        cache.setThreads(selectedProject.id, nextThreads);
      }
      setThreadsSnapshot(nextThreads);
      await refreshMessages(selectedThread.id, { force: true });
      setError(null);
      setSuccess(translate(chatMessages, "turnCancelled"));
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : String(cancelError));
    } finally {
      setIsCancelling(false);
    }
  }, [cache, refreshMessages, selectedProject, selectedThread, setSuccess, setThreadsSnapshot]);

  const handleRenameThread = useCallback(async (title: string): Promise<ChatThread> => {
    if (!selectedThread || !selectedProject) {
      throw new Error(translate(chatMessages, "selectThreadBeforeRename"));
    }

    const updated = await updateConversationThread(selectedThread.id, { title });
    const nextThreads = (cache.getThreads(selectedProject.id) || threadsRef.current).map((thread) => (
      thread.id === updated.id ? updated : thread
    ));
    cache.setThreads(selectedProject.id, nextThreads);
    setThreadsSnapshot(nextThreads);
    setError(null);
    setSuccess(translate(chatMessages, "threadRenamed"));
    return updated;
  }, [cache, selectedProject, selectedThread, setSuccess, setThreadsSnapshot]);

  const recordSentMessage = useCallback((message: string): void => {
    const normalizedMessage = message.trim();
    if (!normalizedMessage) {
      return;
    }
    sentHistoryRef.current = [...sentHistoryRef.current.filter((entry) => entry !== normalizedMessage), normalizedMessage].slice(-50);
    resetHistoryTraversal();
    if (!selectedProject) {
      return;
    }
    const userId = draftUserIdRef.current ?? getOrCreateDashboardDraftUserId();
    draftUserIdRef.current = userId;
    void recordConversationMessageHistory(selectedProject.id, {
      userId,
      bodyMarkdown: normalizedMessage,
    }).catch(() => {
      // Message history should not affect successful chat delivery.
    });
  }, [resetHistoryTraversal, selectedProject?.id]);

  const navigateHistory = useCallback((direction: "up" | "down"): boolean => {
    const history = sentHistoryRef.current;
    if (history.length === 0) {
      return false;
    }

    if (direction === "up") {
      if (historyIndexRef.current === -1) {
        historyDraftRef.current = input;
        if (inputContextKeyRef.current === draftContextKeyRef.current) {
          flushDraftSnapshot({
            projectId: draftProjectIdRef.current,
            userId: draftUserIdRef.current,
            contextKey: draftContextKeyRef.current,
            bodyMarkdown: input,
          });
        }
        historyIndexRef.current = history.length - 1;
      } else if (historyIndexRef.current > 0) {
        historyIndexRef.current -= 1;
      } else {
        return true;
      }
      setInputFromHistoryPreview(history[historyIndexRef.current]);
      return true;
    }

    if (historyIndexRef.current === -1) {
      return false;
    }
    if (historyIndexRef.current < history.length - 1) {
      historyIndexRef.current += 1;
      setInputFromHistoryPreview(history[historyIndexRef.current]);
    } else {
      historyIndexRef.current = -1;
      const restoredDraft = historyDraftRef.current;
      historyDraftRef.current = "";
      isHistoryPreviewRef.current = false;
      setInputState(() => {
        inputRef.current = restoredDraft;
        inputContextKeyRef.current = draftContextKeyRef.current;
        return restoredDraft;
      });
    }
    return true;
  }, [flushDraftSnapshot, input, setInputFromHistoryPreview]);

  const handleSend = useCallback(async (overrideText?: string): Promise<void> => {
    // overrideText lets UI affordances (stage quick actions) send a prompt
    // directly without round-tripping it through the composer draft state.
    const isComposerSend = overrideText === undefined;
    const bodyMarkdown = (overrideText ?? input).trim();
    if (!bodyMarkdown || !selectedProject) {
      return;
    }

    if (isComposerSend) {
      setInput("");
    }
    if (isComposerSend && composerRef?.current) {
      composerRef.current.style.height = "auto";
    }

    setSending(true);
    try {
      let thread = selectedThread || await createThreadForCompose();

      const created = await postConversationMessage(selectedProject.id, {
        threadId: thread.id,
        bodyMarkdown,
      });
      const nextMessages = upsertMessage(cache.getMessages(thread.id) || [], created);
      cache.setMessages(thread.id, nextMessages);
      if (thread.id === selectedThreadIdRef.current) {
        setMessagesSnapshot(nextMessages);
      }

      recordSentMessage(bodyMarkdown);
      // Removed refreshThreads() call since cache is optimistically updated and realtime
      // will handle the rest without needing full fetch.
      setError(null);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : String(sendError));
      if (isComposerSend) {
        setInput((current) => current || bodyMarkdown);
      }
      if (composerRef?.current) {
        composerRef.current.focus();
      }
    } finally {
      setSending(false);
    }
  }, [cache, composerRef, createThreadForCompose, input, recordSentMessage, selectedProject, selectedThread, setMessagesSnapshot]);

  const handleCreateAppQuickaction = useCallback(async (kind: DashboardCreateAppQuickactionKind): Promise<void> => {
    if (!selectedProject || sending) {
      return;
    }

    const appKindLabel = getCreateAppQuickactionSpec(kind).appKindLabel.toLowerCase();
    const bodyMarkdown = `Create ${kind === "online_shop" ? "an" : "a"} ${appKindLabel}`;
    const composerDraft = inputRef.current;
    setSending(true);
    try {
      const thread = selectedThread || await createThreadForCompose();
      if (!selectedThread) {
        setInput(composerDraft);
      }
      const created = await postConversationMessage(selectedProject.id, {
        threadId: thread.id,
        bodyMarkdown,
        metadata: buildCreateAppQuickactionMetadata(kind, dashboardSettings),
      });
      onMessageSent?.({ message: created, optimisticInvocationId: null });
      const nextMessages = upsertMessage(cache.getMessages(thread.id) || [], created);
      cache.setMessages(thread.id, nextMessages);
      if (thread.id === selectedThreadIdRef.current) {
        setMessagesSnapshot(nextMessages);
      }
      setError(null);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : String(sendError));
      if (composerRef?.current) {
        composerRef.current.focus();
      }
    } finally {
      setSending(false);
    }
  }, [cache, composerRef, createThreadForCompose, dashboardSettings, onMessageSent, selectedProject, selectedThread, sending, setInput, setMessagesSnapshot]);

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
      setSuccess(translate(chatMessages, "threadDeleted"));
    } catch (deleteError) {
      // Assuming parent handles broad refresh, but since we optimistically updated, if error, we might be out of sync.
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setDeletingThreadId((current) => current === threadId ? null : current);
    }
  }, [activateThread, cache, selectedProject, selectedThreadId, setSuccess, setThreadsSnapshot]);

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
    compacting,
    isCancelling,
    error,
    setError,
    selectedThread,
    threadIndex,
    activateThread,
    refreshMessages,
    createThreadForCompose,
    handleCompactThread,
    handleSend,
    handleCreateAppQuickaction,
    navigateHistory,
    handleDeleteThread,
    handleRenameThread,
    feedback,
    clearFeedback,
    isConfirmOpen,
    confirmOptions,
    handleConfirm,
    handleCancel,
    handleCancelActiveTurn,
  };
};
