import { useRef, useCallback, useMemo } from "preact/hooks";
import type {
  AgentConnection,
  ChatMessageRecord,
  ChatThread,
  ExecutionInvocationRecord,
  ExecutionInvocationMessageRecord,
} from "../types.js";

export function useMessageCache() {
  const messageCacheRef = useRef(new Map<string, ChatMessageRecord[]>());
  const threadCacheRef = useRef(new Map<string, ChatThread[]>());
  const connectionCacheRef = useRef(new Map<string, AgentConnection[]>());
  const invocationCacheRef = useRef(new Map<string, ExecutionInvocationRecord[]>());
  const invocationMessageCacheRef = useRef(new Map<string, ExecutionInvocationMessageRecord[]>());

  const getMessages = useCallback((threadId: string) => messageCacheRef.current.get(threadId), []);
  const setMessages = useCallback((threadId: string, messages: ChatMessageRecord[]) => {
    messageCacheRef.current.set(threadId, messages);
  }, []);
  const hasMessages = useCallback((threadId: string) => messageCacheRef.current.has(threadId), []);
  const deleteMessages = useCallback((threadId: string) => {
    messageCacheRef.current.delete(threadId);
  }, []);

  const getThreads = useCallback((projectId: string) => threadCacheRef.current.get(projectId), []);
  const setThreads = useCallback((projectId: string, threads: ChatThread[]) => {
    threadCacheRef.current.set(projectId, threads);
  }, []);
  const hasThreads = useCallback((projectId: string) => threadCacheRef.current.has(projectId), []);

  const getConnections = useCallback((projectId: string) => connectionCacheRef.current.get(projectId), []);
  const setConnections = useCallback((projectId: string, connections: AgentConnection[]) => {
    connectionCacheRef.current.set(projectId, connections);
  }, []);

  const getInvocations = useCallback((projectId: string) => invocationCacheRef.current.get(projectId), []);
  const setInvocations = useCallback((projectId: string, invocations: ExecutionInvocationRecord[]) => {
    invocationCacheRef.current.set(projectId, invocations);
  }, []);
  const hasInvocations = useCallback((projectId: string) => invocationCacheRef.current.has(projectId), []);

  const getInvocationMessages = useCallback((invocationId: string) => invocationMessageCacheRef.current.get(invocationId), []);
  const setInvocationMessages = useCallback((invocationId: string, messages: ExecutionInvocationMessageRecord[]) => {
    invocationMessageCacheRef.current.set(invocationId, messages);
  }, []);
  const hasInvocationMessages = useCallback((invocationId: string) => invocationMessageCacheRef.current.has(invocationId), []);

  const clearAll = useCallback(() => {
    messageCacheRef.current.clear();
    threadCacheRef.current.clear();
    connectionCacheRef.current.clear();
    invocationCacheRef.current.clear();
    invocationMessageCacheRef.current.clear();
  }, []);

  return useMemo(
    () => ({
      getMessages,
      setMessages,
      hasMessages,
      deleteMessages,
      getThreads,
      setThreads,
      hasThreads,
      getConnections,
      setConnections,
      getInvocations,
      setInvocations,
      hasInvocations,
      getInvocationMessages,
      setInvocationMessages,
      hasInvocationMessages,
      clearAll,
    }),
    []
  );
}
