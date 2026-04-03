const fs = require('fs');
const body = fs.readFileSync('hook_body.txt', 'utf8');

const hookBoilerplate = `import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type {
  AgentConnection,
  ChatMessageRecord,
  ChatThread,
  ExecutionInvocationRecord,
  ExecutionInvocationMessageRecord,
} from "../types.js";
import type {
  DashboardRealtimeServerMessage,
  ExecutionDashboardSnapshot,
  ExecutionConnectionSummary,
} from "../../types.js";
import { useMessageCache } from "./useMessageCache.js";
import { useProjectData } from "../context/project-data.js";
import {
  createConversationThread,
  deleteConversationThread,
  fetchConversationMessages,
  fetchConversationThreads,
  fetchProjectConnections,
  postConversationMessage,
  updateConversationThread,
  updateThreadRoute,
  compactThreadSession,
} from "../lib/connection-api.js";
import {
  isDetailLoading,
  isListLoading,
  resolveSelectedItemId,
} from "../lib/chat-page-state-utils.js";
import { upsertChatThread } from "../lib/chat-thread-utils.js";
import { fetchInvocationMessages, fetchProjectInvocations } from "../lib/invocation-api.js";
import { subscribeToDashboardRealtime } from "../../lib/realtime/dashboard-realtime-client.js";
import { useExecutions } from "../../hooks/useExecutions.js";
import { getProjectWorkerOptions, type WorkerRoutingPreference } from "../lib/project-worker-options.js";
import { buildThreadIndex, buildInvocationIndex, buildConnectionIndex } from "../lib/chat-entity-index.js";
import { useProjectEffectiveSettings } from "./use-project-effective-settings.js";
import { toChatTimestampMs } from "../lib/chat-time.js";

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

const upsertMessage = (messages: ChatMessageRecord[], nextMessage: ChatMessageRecord): ChatMessageRecord[] => {
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

const removeThread = (threads: ChatThread[], threadId: string): ChatThread[] => (
  threads.filter((thread) => thread.id !== threadId)
);

const areThreadsEqual = (left: ChatThread[], right: ChatThread[]): boolean => (
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

const areMessagesEqual = (left: ChatMessageRecord[], right: ChatMessageRecord[]): boolean => (
  left.length === right.length
  && left.every((message, index) => {
    const candidate = right[index];
    return Boolean(candidate)
      && candidate.id === message.id
      && candidate.createdAt === message.createdAt
      && candidate.deliveryStatus === message.deliveryStatus;
  })
);

const areConnectionsEqual = (left: AgentConnection[], right: AgentConnection[]): boolean => (
  left.length === right.length
  && left.every((connection, index) => {
    const candidate = right[index];
    return Boolean(candidate)
      && candidate.id === connection.id
      && candidate.updatedAt === connection.updatedAt
      && candidate.status === connection.status
      && candidate.threadCount === connection.threadCount
      && candidate.messageCount === connection.messageCount
      && candidate.pendingInboxCount === connection.pendingInboxCount
      && candidate.activeDispatchCount === connection.activeDispatchCount;
  })
);

const toAgentConnection = (connection: ExecutionConnectionSummary): AgentConnection => ({
  id: connection.id,
  connectionKey: connection.connectionKey,
  displayName: connection.displayName,
  role: connection.role as AgentConnection["role"],
  transport: connection.transport,
  status: connection.status as AgentConnection["status"],
  capabilities: {
    instruction: connection.instruction || undefined,
    model: connection.model || undefined,
    labels: connection.labels,
    listenMode: connection.listenMode,
    machineName: connection.machineName || undefined,
    platform: connection.platform || undefined,
    arch: connection.arch || undefined,
    localExecutionRuntime: connection.localExecutionRuntime || undefined,
  },
  lastHeartbeatAt: connection.lastHeartbeatAt,
  createdAt: connection.lastHeartbeatAt || new Date().toISOString(),
  updatedAt: connection.lastHeartbeatAt || new Date().toISOString(),
  projectIds: connection.projectIds,
  activeProjectIds: connection.activeProjectIds,
  tasksRunCount: connection.tasksRunCount,
  threadCount: connection.threadCount,
  messageCount: connection.messageCount,
  pendingInboxCount: connection.pendingInboxCount,
  activeDispatchCount: connection.activeDispatchCount,
});

export const useChatPageData = () => {
`;

// Extract everything from `const selectedThreadIdRef = useRef<string | null>(null);` to `const handleDeleteThread = useCallback` (including its closing brace).
const hookRegex = /(const selectedThreadIdRef[\s\S]*?)const handleDeleteThread = useCallback\(async \(threadId: string\): Promise<void> => \{[\s\S]*?\}, \[activateThread, refreshThreads, selectedProject, selectedThreadId, setThreadsSnapshot\]\);/g;
let extractedBody = "";
const match = hookRegex.exec(body);
if (match) {
  extractedBody = match[0];
} else {
  console.log("Failed to match body");
}

const returns = `
  return {
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
    loading,
    messagesLoading,
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
    invocationsLoading,
    invocationMessagesLoading,
    refreshThreads,
    refreshMessages,
    refreshInvocationMessages,
    activateThread,
    activateInvocation,
    handleAssignRoute,
    handleCompactThread,
    handleSend,
    handleDeleteThread,
    createThreadForCompose,
    workerOptions,
    selectedProject,
  };
};
`;

const finalFileContent = hookBoilerplate + extractedBody + returns;
fs.writeFileSync('dashboard/src/v2/hooks/use-chat-page-data.ts', finalFileContent);
