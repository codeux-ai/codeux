import type { ChatThread } from "../types.js";

export const resolveSelectedThreadId = (
  threads: ChatThread[],
  currentSelectedThreadId: string | null,
): string | null => {
  if (currentSelectedThreadId && threads.some((thread) => thread.id === currentSelectedThreadId)) {
    return currentSelectedThreadId;
  }

  return threads[0]?.id || null;
};

export const isThreadListLoading = (
  selectedProjectId: string | null,
  hasProjectSnapshot: boolean,
  loading: boolean,
): boolean => Boolean(selectedProjectId) && loading && !hasProjectSnapshot;

export const isThreadMessagesLoading = (
  selectedThreadId: string | null,
  hasThreadSnapshot: boolean,
  loading: boolean,
): boolean => Boolean(selectedThreadId) && loading && !hasThreadSnapshot;
