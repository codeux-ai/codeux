/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPage } from "../../../dashboard/src/v2/ChatPage.js";
import type {
  ChatMessageRecord,
  ChatThread,
  Source,
  Sprint,
  Task,
} from "../../../dashboard/src/v2/types.js";

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
    to: vi.fn(),
    set: vi.fn(),
    context: vi.fn((callback: () => void) => {
      callback();
      return { revert: vi.fn() };
    }),
  },
}));

const mocks: { data: Record<string, unknown> } = {
  data: {},
};

vi.mock("../../../dashboard/src/v2/hooks/use-chat-page-data.js", () => ({
  useChatPageData: () => mocks.data,
}));

const createProject = (): Source => ({
  id: "project-1",
  slug: "project-1",
  name: "Project One",
  baseDir: "/workspace/project-one",
  repoUrl: null,
  sourceType: "local",
  sourceRef: "/workspace/project-one",
  gitProvider: "local",
  gitHostDomain: null,
  defaultBranch: "dev",
  featureBranchPrefix: null,
  status: "idle",
  sprintsCount: 1,
  openTasks: 1,
  completedTasks: 0,
  isRunning: false,
  settingsOverrides: {},
  agentBindings: [],
  lastRunAt: null,
  lastRunStatus: null,
  createdAt: "2026-03-10T12:00:00.000Z",
  updatedAt: "2026-03-10T12:00:00.000Z",
});

const createThread = (): ChatThread => ({
  id: "thread-1",
  projectId: "project-1",
  scope: "project",
  title: "Live entity thread",
  connectionId: null,
  status: "open",
  runtimeState: null,
  metadata: null,
  messageCount: 1,
  lastMessageAt: "2026-03-10T12:00:00.000Z",
  createdAt: "2026-03-10T12:00:00.000Z",
  updatedAt: "2026-03-10T12:00:00.000Z",
});

const createMessage = (): ChatMessageRecord => ({
  id: "message-1",
  threadId: "thread-1",
  direction: "connection_to_dashboard",
  authorType: "connection",
  authorConnectionId: null,
  bodyMarkdown: "Current implementation target is SPR-1 and T01.",
  deliveryStatus: "processed",
  createdAt: "2026-03-10T12:00:00.000Z",
  metadata: null,
});

const createSprint = (): Sprint => ({
  id: "sprint-1",
  projectId: "project-1",
  number: 1,
  slug: "sprint-1",
  name: "Live sprint",
  isGeneratedName: false,
  originalPrompt: null,
  goal: "Render current entities",
  status: "running",
  showcasePinned: false,
  startDate: null,
  endDate: null,
  featureBranch: null,
  baseCommitSha: null,
  tasksCount: 1,
  completion: 0,
  linkedIssues: [],
  date: "Schedule TBD",
  createdAt: "2026-03-10T12:00:00.000Z",
  updatedAt: "2026-03-10T12:00:00.000Z",
});

const createTask = (status: Task["status"]): Task => ({
  recordId: "task-1",
  id: "T01",
  source: "Project One",
  sprint: "Live sprint",
  sprintId: "sprint-1",
  title: "Connect live chat entities",
  status,
  priority: "high",
  executorType: "docker_cli",
  assignee: "Codex",
  time: "--",
  createdAt: "2026-03-10T12:00:00.000Z",
  updatedAt: "2026-03-10T12:00:00.000Z",
  promptMarkdown: "Connect resolver output to chat bubbles.",
  description: "",
  dependsOnTaskIds: [],
  isIndependent: true,
  isMerged: false,
  mergeIndicator: null,
});

const createChatPageData = (taskStatus: Task["status"]): Record<string, unknown> => {
  const project = createProject();
  const thread = createThread();
  const message = createMessage();
  const sprint = createSprint();
  const task = createTask(taskStatus);

  return {
    chatMode: "threads",
    setChatMode: vi.fn(),
    threads: [thread],
    invocations: [],
    invocationTotalCount: 0,
    hasMoreInvocations: false,
    selectedThreadId: thread.id,
    selectedInvocationId: null,
    messages: [message],
    invocationMessages: [],
    input: "",
    setInput: vi.fn(),
    loading: false,
    messagesLoading: false,
    manualRefreshing: false,
    deletingThreadId: null,
    sending: false,
    compacting: false,
    error: null,
    selectedThread: thread,
    selectedInvocation: null,
    selectedAgentPreset: null,
    activeConnection: null,
    pendingDashboardMessages: 0,
    hasWorkingReply: false,
    threadsLoading: false,
    threadMessagesLoading: false,
    connections: [],
    invocationsLoading: false,
    invocationMessagesLoading: false,
    invocationsLoadingMore: false,
    refreshThreads: vi.fn(() => Promise.resolve()),
    loadMoreInvocations: vi.fn(() => Promise.resolve()),
    activateThread: vi.fn(() => Promise.resolve()),
    activateInvocation: vi.fn(() => Promise.resolve()),
    handleCompactThread: vi.fn(() => Promise.resolve()),
    handleCancelActiveTurn: vi.fn(() => Promise.resolve()),
    isCancelling: false,
    handleSend: vi.fn(() => Promise.resolve()),
    navigateHistory: vi.fn(() => false),
    handleDeleteThread: vi.fn(() => Promise.resolve()),
    handleRenameThread: vi.fn(() => Promise.resolve()),
    createThreadForCompose: vi.fn(() => Promise.resolve()),
    threadIndex: new Map([[thread.id, thread]]),
    invocationIndex: new Map(),
    selectedProject: project,
    agentPresets: [],
    feedback: { status: "idle", message: null },
    clearFeedback: vi.fn(),
    isConfirmOpen: false,
    confirmOptions: null,
    handleConfirm: vi.fn(),
    handleCancel: vi.fn(),
    execution: { projectId: project.id },
    executionLoading: false,
    executionLoaded: true,
    projectTasks: [task],
    projectTasksLoading: false,
    projectTasksLoaded: true,
    sprintKeyPrefix: "SPR",
    liveEntityContext: {
      sprints: [sprint],
      tasks: [task],
      loading: false,
      loaded: true,
      error: null,
      sprintKeyPrefix: "SPR",
    },
  };
};

describe("ChatPage live entity integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.data = createChatPageData("in_progress");
  });

  afterEach(() => {
    cleanup();
  });

  it("renders live sprint and task links from page data and updates when task status changes", () => {
    const { rerender } = render(<ChatPage />);

    expect(screen.getByText("Live sprint context")).toBeInTheDocument();
    expect(screen.getByRole("link", {
      name: "Open sprint SPR-1: Live sprint. Live status: Running.",
    })).toHaveAttribute("href", "/sprints?sprintKey=SPR-1");
    expect(screen.getByRole("link", {
      name: "Open task T01: Connect live chat entities. Live status: In Progress.",
    })).toHaveAttribute("href", "/tasks?sprintId=sprint-1&taskId=task-1");

    mocks.data = createChatPageData("completed");
    rerender(<ChatPage />);

    expect(screen.getByRole("link", {
      name: "Open task T01: Connect live chat entities. Live status: Completed.",
    })).toHaveAttribute("href", "/tasks?sprintId=sprint-1&taskId=task-1");
    expect(screen.queryByRole("link", {
      name: "Open task T01: Connect live chat entities. Live status: In Progress.",
    })).not.toBeInTheDocument();
  });
});
