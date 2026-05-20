import type { ChatThread } from "../../../dashboard/src/v2/types.js";
import type { WorkerOption } from "../../../dashboard/src/v2/lib/project-worker-options.js";

export function buildMockChatThread(overrides: Partial<ChatThread> = {}): ChatThread {
  return {
    id: "mock-thread-1",
    projectId: "mock-project-1",
    connectionId: null,
    scope: "project",
    title: "Mock Thread",
    status: "open",
    createdAt: "2023-01-01T00:00:00Z",
    updatedAt: "2023-01-01T00:00:00Z",
    messageCount: 0,
    pendingMessageCount: 0,
    lastMessageAt: null,
    lastMessagePreview: null,
    runtimeState: null,
    ...overrides,
  };
}

export function buildMockWorkerOption(overrides: Partial<WorkerOption> = {}): WorkerOption {
  return {
    id: "mock-worker-1",
    label: "Mock Worker",
    status: "online",
    isPrimary: false,
    type: "connection",
    isSelectable: true,
    ...overrides,
  };
}
