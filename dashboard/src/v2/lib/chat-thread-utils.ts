import type { ChatThread } from "../types.js";
import { toChatTimestampMs } from "./chat-time.js";

export const upsertChatThread = (threads: ChatThread[], nextThread: ChatThread): ChatThread[] => {
  const withoutCurrent = threads.filter((thread) => thread.id !== nextThread.id);
  return [nextThread, ...withoutCurrent].sort((left, right) => {
    const leftTime = toChatTimestampMs(left.lastMessageAt, toChatTimestampMs(left.updatedAt));
    const rightTime = toChatTimestampMs(right.lastMessageAt, toChatTimestampMs(right.updatedAt));
    return rightTime - leftTime;
  });
};
