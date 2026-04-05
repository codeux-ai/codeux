import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ExecutionInvocationRecord, ExecutionInvocationMessageRecord } from "../types.js";
import { useMessageCache } from "./useMessageCache.js";
import { fetchInvocationMessages } from "../lib/invocation-api.js";
import { buildInvocationIndex } from "../lib/chat-entity-index.js";

export const areInvocationsEqual = (left: ExecutionInvocationRecord[], right: ExecutionInvocationRecord[]): boolean => (
  left.length === right.length
  && left.every((invocation, index) => {
    const candidate = right[index];
    return Boolean(candidate)
      && candidate.id === invocation.id
      && candidate.status === invocation.status
      && candidate.updatedAt === invocation.updatedAt
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
      && candidate.createdAt === message.createdAt;
  })
);

export const useInvocationPaneData = (options: {
  selectedProject: { id: string } | null;
  cache: ReturnType<typeof useMessageCache>;
}) => {
  const { selectedProject, cache } = options;

  const [invocations, setInvocations] = useState<ExecutionInvocationRecord[]>([]);
  const [selectedInvocationId, setSelectedInvocationId] = useState<string | null>(null);
  const [invocationMessages, setInvocationMessages] = useState<ExecutionInvocationMessageRecord[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedInvocationIdRef = useRef<string | null>(null);
  const inflightInvocationFetchesRef = useRef(new Map<string, Promise<ExecutionInvocationMessageRecord[]>>());
  const activationTokenRef = useRef(0);

  useEffect(() => {
    selectedInvocationIdRef.current = selectedInvocationId;
  }, [selectedInvocationId]);

  const invocationIndex = useMemo(() => buildInvocationIndex(invocations), [invocations]);
  const selectedInvocation = useMemo(
    () => (selectedInvocationId ? invocationIndex.get(selectedInvocationId) || null : null),
    [invocationIndex, selectedInvocationId]
  );

  const setInvocationsSnapshot = useCallback((nextInvocations: ExecutionInvocationRecord[]): void => {
    setInvocations((current) => areInvocationsEqual(current, nextInvocations) ? current : nextInvocations);
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

  return {
    invocations,
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
    invocationIndex,
    activateInvocation,
    refreshInvocationMessages,
  };
};
