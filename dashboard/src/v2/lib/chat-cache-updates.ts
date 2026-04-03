import type { ChatMessageRecord, ChatThread, ExecutionInvocationRecord, ExecutionInvocationMessageRecord, AgentConnection } from "../types.js";
import { toChatTimestampMs } from "./chat-time.js";

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

export const removeThread = (threads: ChatThread[], threadIdToRemove: string): ChatThread[] => {
  return threads.filter((thread) => thread.id !== threadIdToRemove);
};

export const areThreadsEqual = (left: ChatThread[], right: ChatThread[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  for (let i = 0; i < left.length; i += 1) {
    if (left[i].id !== right[i].id) return false;
    if (left[i].updatedAt !== right[i].updatedAt) return false;
    if (left[i].lastMessageAt !== right[i].lastMessageAt) return false;
    if (left[i].messageCount !== right[i].messageCount) return false;
    if (left[i].title !== right[i].title) return false;
    if (left[i].connectionId !== right[i].connectionId) return false;
    if (left[i].lastMessagePreview !== right[i].lastMessagePreview) return false;
  }

  return true;
};

export const areMessagesEqual = (left: ChatMessageRecord[], right: ChatMessageRecord[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  for (let i = 0; i < left.length; i += 1) {
    if (left[i].id !== right[i].id) return false;
    if (left[i].deliveryStatus !== right[i].deliveryStatus) return false;
  }

  return true;
};

export const areConnectionsEqual = (left: AgentConnection[], right: AgentConnection[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  for (let i = 0; i < left.length; i += 1) {
    if (left[i].id !== right[i].id) return false;
    if (left[i].status !== right[i].status) return false;
    if (left[i].messageCount !== right[i].messageCount) return false;
    if (left[i].pendingInboxCount !== right[i].pendingInboxCount) return false;
    if (left[i].activeDispatchCount !== right[i].activeDispatchCount) return false;
  }

  return true;
};
