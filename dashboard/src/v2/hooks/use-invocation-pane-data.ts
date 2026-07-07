import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ExecutionInvocationRecord, ExecutionInvocationMessageRecord, AgentPresetRecord } from "../types.js";
import { useMessageCache } from "./useMessageCache.js";
import { fetchInvocationMessages } from "../lib/invocation-api.js";
import { buildInvocationIndex } from "../lib/chat-entity-index.js";
import { isDeepEqual } from "../lib/resource-equality.js";

export const CHAT_INVOCATION_PAGE_SIZE = 40;

export const areInvocationsEqual = (left: ExecutionInvocationRecord[], right: ExecutionInvocationRecord[]): boolean => (
  left.length === right.length
  && left.every((invocation, index) => {
    const candidate = right[index];
    return Boolean(candidate)
      && candidate.id === invocation.id
      && candidate.status === invocation.status
      && candidate.updatedAt === invocation.updatedAt
      && candidate.preservedAt === invocation.preservedAt
      && candidate.messageCount === invocation.messageCount
      && candidate.lastMessageAt === invocation.lastMessageAt;
  })
);

export const areInvocationMessagesEqual = (left: ExecutionInvocationMessageRecord[], right: ExecutionInvocationMessageRecord[]): boolean => (
  left.length === right.length
  && left.every((message, index) => {
    const candidate = right[index];
    return Boolean(candidate)
      && candidate.id === message.id
      && candidate.createdAt === message.createdAt
      && candidate.role === message.role
      && candidate.contentMarkdown === message.contentMarkdown
      && isDeepEqual(candidate.toolCallsJson, message.toolCallsJson)
      && isDeepEqual(candidate.metadata ?? null, message.metadata ?? null);
  })
);

export const useInvocationPaneData = (options: {
  selectedProject: { id: string } | null;
  cache: ReturnType<typeof useMessageCache>;
  agentPresets?: AgentPresetRecord[];
}) => {
  const { selectedProject, cache, agentPresets = [] } = options;

  const [invocations, setInvocations] = useState<ExecutionInvocationRecord[]>([]);
  const [invocationTotalCount, setInvocationTotalCount] = useState(0);
  const [selectedInvocationId, setSelectedInvocationId] = useState<string | null>(null);
  const [invocationMessages, setInvocationMessages] = useState<ExecutionInvocationMessageRecord[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedInvocationIdRef = useRef<string | null>(null);
  const selectedInvocationRefreshIdRef = useRef<string | null>(null);
  const selectedInvocationSummaryRef = useRef<string | null>(null);
  const selectedInvocationStatusRef = useRef<ExecutionInvocationRecord["status"] | null>(null);
  const serverInvocationsRef = useRef<ExecutionInvocationRecord[]>([]);
  const inflightInvocationFetchesRef = useRef(new Map<string, Promise<ExecutionInvocationMessageRecord[]>>());
  const activationTokenRef = useRef(0);

  useEffect(() => {
    serverInvocationsRef.current = invocations;
  }, [invocations]);

  useEffect(() => {
    selectedInvocationIdRef.current = selectedInvocationId;
  }, [selectedInvocationId]);

  const invocationIndex = useMemo(() => buildInvocationIndex(invocations), [invocations]);
  const selectedInvocation = useMemo(
    () => (selectedInvocationId ? invocationIndex.get(selectedInvocationId) || null : null),
    [invocationIndex, selectedInvocationId]
  );

  const selectedAgentPreset = useMemo(() => {
    if (selectedInvocation?.agentPresetId) {
      return agentPresets.find(p => p.id === selectedInvocation.agentPresetId);
    }
    return undefined;
  }, [selectedInvocation?.agentPresetId, agentPresets]);

  const selectedInvocationRefreshKey = useMemo(() => {
    if (!selectedInvocation) {
      return null;
    }
    return [
      selectedInvocation.id,
      selectedInvocation.status,
      selectedInvocation.messageCount,
      selectedInvocation.lastMessageAt || "",
      selectedInvocation.updatedAt,
    ].join("|");
  }, [selectedInvocation]);

  const setInvocationsSnapshot = useCallback((nextInvocations: ExecutionInvocationRecord[], totalCount = nextInvocations.length): void => {
    setInvocations((current) => areInvocationsEqual(current, nextInvocations) ? current : nextInvocations);
    setInvocationTotalCount(totalCount);
  }, []);

  const setInvocationMessagesSnapshot = useCallback((nextMessages: ExecutionInvocationMessageRecord[]): void => {
    setInvocationMessages((current) => areInvocationMessagesEqual(current, nextMessages) ? current : nextMessages);
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
  }, [cache]);

  const activateInvocation = useCallback(async (
    invocationId: string | null,
    activateOptions?: { foreground?: boolean; preferredInvocation?: ExecutionInvocationRecord | null },
  ): Promise<void> => {
    activationTokenRef.current += 1;
    const activationToken = activationTokenRef.current;

    if (!invocationId) {
      setSelectedInvocationId(null);
      setInvocationMessagesSnapshot([]);
      setMessagesLoading(false);
      return;
    }

    const targetInvocation = activateOptions?.preferredInvocation || cache.getInvocations(selectedProject?.id || "")?.find((inv) => inv.id === invocationId) || null;
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

    if (activateOptions?.foreground) {
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
  }, [cache, ensureInvocationMessagesLoaded, selectedProject?.id, setInvocationMessagesSnapshot]);

  const refreshInvocationMessages = useCallback(async (
    invocationId: string | null,
    refreshOptions?: { foreground?: boolean; force?: boolean },
  ): Promise<void> => {
    if (!invocationId) {
      setInvocationMessagesSnapshot([]);
      setMessagesLoading(false);
      return;
    }

    if (refreshOptions?.foreground) {
      setMessagesLoading(true);
    }

    try {
      const nextMessages = refreshOptions?.force
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
      if (refreshOptions?.foreground) {
        setMessagesLoading(false);
      }
    }
  }, [cache, ensureInvocationMessagesLoaded, setInvocationMessagesSnapshot]);

  useEffect(() => {
    const previousSelectedInvocationId = selectedInvocationRefreshIdRef.current;
    const currentSelectedInvocation = selectedInvocation;
    const nextSummaryKey = selectedInvocationRefreshKey;
    const previousSummaryKey = selectedInvocationSummaryRef.current;
    const previousStatus = selectedInvocationStatusRef.current;

    selectedInvocationRefreshIdRef.current = selectedInvocationId;
    selectedInvocationSummaryRef.current = nextSummaryKey;
    selectedInvocationStatusRef.current = currentSelectedInvocation?.status || null;

    if (!selectedInvocationId || !currentSelectedInvocation || !nextSummaryKey) {
      return;
    }

    if (previousSummaryKey === null || previousSummaryKey === nextSummaryKey) {
      return;
    }

    if (previousSelectedInvocationId !== selectedInvocationId) {
      return;
    }

    if (previousStatus !== "running" && currentSelectedInvocation.status !== "running") {
      return;
    }

    void refreshInvocationMessages(currentSelectedInvocation.id, { force: true });
  }, [refreshInvocationMessages, selectedInvocation, selectedInvocationId, selectedInvocationRefreshKey]);

  return {
    invocations,
    serverInvocationCount: invocations.length,
    invocationTotalCount,
    hasMoreInvocations: invocations.length < invocationTotalCount,
    serverInvocationsRef,
    setInvocationsSnapshot,
    selectedInvocationId,
    setSelectedInvocationId,
    selectedInvocationIdRef,
    invocationMessages,
    setInvocationMessagesSnapshot,
    messagesLoading,
    error,
    setError,
    selectedInvocation,
    selectedAgentPreset,
    invocationIndex,
    activateInvocation,
    refreshInvocationMessages,
  };
};
