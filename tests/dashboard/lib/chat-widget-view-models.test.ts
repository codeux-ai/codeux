import { describe, it, expect } from "vitest";
import {
  getChatWidgetData,
  getInvocationWidgetData,
  getReasoningWidgetData,
  getSelfReflectionWidgetData,
  getWorkingBubbleData,
  sanitizeInvocationOutputText,
} from "../../../dashboard/src/v2/lib/chat-widget-view-models.js";
import type { ExecutionDashboardSnapshot, ExecutionTaskDispatchSummary } from "../../../dashboard/src/types.js";
import type { ChatMessageRecord, ExecutionInvocationMessageRecord, ConversationRuntimeState, Task } from "../../../dashboard/src/v2/types.js";

const createTask = (overrides: Partial<Task> = {}): Task => ({
  recordId: "task-1",
  id: "TASK-1",
  source: "Test Project",
  sprint: "Sprint Alpha",
  sprintId: "sprint-1",
  title: "Build first task",
  status: "pending",
  priority: "medium",
  executorType: "docker_cli",
  assignee: "Runner",
  time: "--",
  createdAt: "2026-03-10T12:00:00.000Z",
  updatedAt: "2026-03-10T12:00:00.000Z",
  promptMarkdown: "Do the work",
  description: "",
  dependsOnTaskIds: [],
  isIndependent: true,
  isMerged: false,
  mergeIndicator: null,
  ...overrides,
});

const createDispatch = (overrides: Partial<ExecutionTaskDispatchSummary> = {}): ExecutionTaskDispatchSummary => ({
  id: "dispatch-1",
  projectId: "project-1",
  sprintId: "sprint-1",
  sprintRunId: "run-1",
  sprintName: "Sprint Alpha",
  sprintNumber: 7,
  taskId: "task-1",
  taskKey: "TASK-1",
  taskTitle: "Build first task",
  status: "running",
  executorType: "docker_cli",
  priority: 10,
  connectionId: null,
  connectionDisplayName: null,
  connectionRole: null,
  taskRunId: "task-run-1",
  taskRunState: "RUNNING",
  provider: "codex",
  sessionId: "session-1",
  sessionName: "sessions/session-1",
  workerBranch: null,
  prUrl: null,
  queuedAt: "2026-03-10T12:00:00.000Z",
  claimedAt: "2026-03-10T12:01:00.000Z",
  startedAt: "2026-03-10T12:02:00.000Z",
  finishedAt: null,
  lastHeartbeatAt: "2026-03-10T12:03:00.000Z",
  errorMessage: null,
  activeLeaseOwnerKey: null,
  activeLeaseExpiresAt: null,
  ...overrides,
});

const createExecution = (overrides: Partial<ExecutionDashboardSnapshot> = {}): ExecutionDashboardSnapshot => ({
  projectId: "project-1",
  projectName: "Test Project",
  sprintRuns: [{
    id: "run-1",
    projectId: "project-1",
    sprintId: "sprint-1",
    sprintName: "Sprint Alpha",
    sprintNumber: 7,
    status: "running",
    triggerType: "manual",
    triggeredBy: null,
    executorMode: "DOCKER",
    startedAt: "2026-03-10T12:00:00.000Z",
    finishedAt: null,
    lastHeartbeatAt: "2026-03-10T12:03:00.000Z",
    createdAt: "2026-03-10T12:00:00.000Z",
    activeLeaseOwnerKey: null,
    activeLeaseExpiresAt: null,
    humanIntervention: null,
  }],
  taskDispatches: [],
  connections: [],
  primaryAssignedWorker: null,
  overflowAssignedWorkers: [],
  attentionItems: [],
  recentEvents: [],
  updatedAt: "2026-03-10T12:03:00.000Z",
  ...overrides,
});

describe("Chat Widget View Models", () => {
  describe("sanitizeInvocationOutputText", () => {
    it("removes only code-ux bootstrap unborn branch fatal lines", () => {
      const input = [
        "before",
        "fatal: your current branch 'code-ux-bootstrap-1' does not have any commits yet",
        "fatal: your current branch 'feature/main' does not have any commits yet",
        "after",
      ].join("\n");

      expect(sanitizeInvocationOutputText(input)).toBe([
        "before",
        "fatal: your current branch 'feature/main' does not have any commits yet",
        "after",
      ].join("\n"));
    });
  });

  describe("getChatWidgetData", () => {
    it("returns none if there is no metadata", () => {
      const message = {
        id: "msg_1",
        metadata: null,
      } as ChatMessageRecord;

      const result = getChatWidgetData(message);
      expect(result).toEqual({ type: "none", status: "completed", planName: "" });
    });

    it("returns planning if type is planning", () => {
      const message = {
        metadata: {
          type: "planning",
          status: "running",
          planName: "Test Plan"
        }
      } as unknown as ChatMessageRecord;

      const result = getChatWidgetData(message);
      expect(result).toEqual({ type: "planning", status: "running", planName: "Test Plan" });
    });

    it("returns planning if bodyMarkdown includes 'planning'", () => {
      const message = {
        bodyMarkdown: "I am planning the task now.",
        metadata: {
          status: "running",
          title: "My custom plan title"
        }
      } as unknown as ChatMessageRecord;

      const result = getChatWidgetData(message);
      expect(result).toEqual({ type: "planning", status: "running", planName: "My custom plan title" });
    });

    it("defaults to Execution Plan and completed if fields are missing on planning type", () => {
      const message = {
        metadata: {
          type: "planning"
        }
      } as unknown as ChatMessageRecord;

      const result = getChatWidgetData(message);
      expect(result).toEqual({ type: "planning", status: "completed", planName: "Execution Plan" });
    });

    it("keeps the generic planning fallback when live sibling data is missing", () => {
      const message = {
        metadata: {
          type: "planning",
          status: "queued",
          planName: "Sprint request",
          sprintId: "sprint-1",
        }
      } as unknown as ChatMessageRecord;

      const result = getChatWidgetData(message);
      expect(result).toEqual({ type: "planning", status: "queued", planName: "Sprint request" });
    });

    it("builds live queued sprint progress from metadata and project tasks", () => {
      const message = {
        metadata: {
          widget_metadata: {
            type: "planning_request",
            status: "queued",
            route_path: "Sprint request",
            sprintId: "sprint-1",
          },
        }
      } as unknown as ChatMessageRecord;

      const projectTasks = Array.from({ length: 7 }, (_, index) => createTask({
        recordId: `task-${index + 1}`,
        id: `TASK-${index + 1}`,
        title: `Task ${index + 1}`,
      }));

      const result = getChatWidgetData(message, {
        projectId: "project-1",
        projectTasks,
        projectTasksLoading: false,
        projectTasksLoaded: true,
        execution: createExecution({ sprintRuns: [createExecution().sprintRuns[0]!, { ...createExecution().sprintRuns[0]!, id: "run-queued", status: "queued" }] }),
        executionLoading: false,
        executionLoaded: true,
        sprintKeyPrefix: "SPR",
      });

      expect(result.status).toBe("queued");
      expect(result.liveStatus?.sprintKey).toBe("SPR-7");
      expect(result.liveStatus?.progressLabel).toBe("0/7 · 0%");
      expect(result.liveStatus?.queuedTasks).toBe(7);
      expect(result.liveStatus?.tasks.map((task) => task.statusLabel)).toEqual([
        "Queued",
        "Queued",
        "Queued",
        "Queued",
        "Queued",
        "Queued",
        "Queued",
      ]);
    });

    it("calculates partial completion and running task status from live dispatches", () => {
      const message = {
        metadata: {
          type: "planning",
          status: "running",
          sprintId: "sprint-1",
        },
      } as unknown as ChatMessageRecord;

      const result = getChatWidgetData(message, {
        projectId: "project-1",
        projectTasks: [
          createTask({ recordId: "task-1", id: "TASK-1", status: "completed", title: "Completed one" }),
          createTask({ recordId: "task-2", id: "TASK-2", status: "completed", title: "Completed two" }),
          createTask({ recordId: "task-3", id: "TASK-3", status: "in_progress", title: "Running task" }),
        ],
        projectTasksLoading: false,
        projectTasksLoaded: true,
        execution: createExecution({
          taskDispatches: [
            createDispatch({ id: "dispatch-3", taskId: "task-3", taskKey: "TASK-3", status: "running", taskRunState: "RUNNING" }),
          ],
        }),
        executionLoading: false,
        executionLoaded: true,
      });

      expect(result.liveStatus?.progressLabel).toBe("2/3 · 67%");
      expect(result.liveStatus?.completedTasks).toBe(2);
      expect(result.liveStatus?.tasks.find((task) => task.id === "TASK-3")?.statusLabel).toBe("Running");
    });

    it("surfaces failed, blocked, and quota task statuses from dispatch state", () => {
      const message = {
        metadata: {
          type: "planning",
          status: "running",
          sprintId: "sprint-1",
        },
      } as unknown as ChatMessageRecord;

      const result = getChatWidgetData(message, {
        projectId: "project-1",
        projectTasks: [
          createTask({ recordId: "task-failed", id: "TASK-F", title: "Failed task" }),
          createTask({ recordId: "task-blocked", id: "TASK-B", title: "Blocked task" }),
          createTask({ recordId: "task-quota", id: "TASK-Q", title: "Quota task" }),
        ],
        projectTasksLoading: false,
        projectTasksLoaded: true,
        execution: createExecution({
          taskDispatches: [
            createDispatch({ id: "dispatch-failed", taskId: "task-failed", taskKey: "TASK-F", status: "failed", taskRunState: "FAILED", finishedAt: "2026-03-10T12:05:00.000Z" }),
            createDispatch({ id: "dispatch-blocked", taskId: "task-blocked", taskKey: "TASK-B", status: "blocked", taskRunState: "BLOCKED", finishedAt: "2026-03-10T12:06:00.000Z" }),
            createDispatch({ id: "dispatch-quota", taskId: "task-quota", taskKey: "TASK-Q", status: "quota", taskRunState: "QUOTA", finishedAt: "2026-03-10T12:07:00.000Z" }),
          ],
        }),
        executionLoading: false,
        executionLoaded: true,
      });

      expect(result.liveStatus?.tasks.map((task) => task.statusLabel)).toEqual(["Failed", "Blocked", "Quota wait"]);
    });

    it("keeps the generic planning fallback while execution and task data are still loading", () => {
      const message = {
        metadata: {
          type: "planning",
          status: "queued",
          planName: "Sprint request",
          sprintId: "sprint-1",
        }
      } as unknown as ChatMessageRecord;

      const result = getChatWidgetData(message, {
        projectId: "project-1",
        projectTasks: [createTask()],
        projectTasksLoading: true,
        projectTasksLoaded: false,
        execution: createExecution(),
        executionLoading: false,
        executionLoaded: true,
      });

      expect(result).toEqual({ type: "planning", status: "queued", planName: "Sprint request" });
    });
  });

  describe("getInvocationWidgetData", () => {
    it("returns planning if metadata.routeKind is virtual", () => {
      const message = {
        metadata: {
          routeKind: "virtual",
          status: "queued"
        }
      } as unknown as ExecutionInvocationMessageRecord;

      const result = getInvocationWidgetData(message);
      expect(result).toEqual({ type: "planning", status: "queued", planName: "Execution Plan" });
    });

    it("returns planning if metadata.routeKind is worker", () => {
      const message = {
        metadata: {
          routeKind: "worker",
          status: "failed",
          planName: "Worker Execution"
        }
      } as unknown as ExecutionInvocationMessageRecord;

      const result = getInvocationWidgetData(message);
      expect(result).toEqual({ type: "planning", status: "failed", planName: "Worker Execution" });
    });
  });

  describe("getReasoningWidgetData", () => {
    it("returns sanitized reasoning text and stable accessibility labels", () => {
      const message = {
        contentMarkdown: [
          "before",
          "fatal: your current branch 'code-ux-bootstrap-1' does not have any commits yet",
          "after",
        ].join("\n"),
        createdAt: "2026-03-10T12:00:00.000Z",
        metadata: {
          provider: "anthropic",
          model: "claude-3.7-sonnet",
          tokens: { reasoning: 17 },
          kind: "reasoning",
        },
      } as unknown as ExecutionInvocationMessageRecord;

      const result = getReasoningWidgetData(message);
      expect(result.text).toBe("before\nafter");
      expect(result.providerLabel).toBe("anthropic");
      expect(result.modelLabel).toBe("claude-3.7-sonnet");
      expect(result.tokens).toEqual({ reasoning: 17 });
      expect(result.createdAtLabel).not.toBe("");
      expect(result.ariaLabel).toContain("Reasoning turn");
      expect(result.ariaLabel).toContain("anthropic");
      expect(result.ariaLabel).toContain("claude-3.7-sonnet");
      expect(result.ariaLabel).toContain("17 tokens");
    });
  });

  describe("getSelfReflectionWidgetData", () => {
    it("normalizes passing planning reflection metadata", () => {
      const message = {
        metadata: {
          reflection: {
            event: "reflection_evaluated",
            purpose: "planning",
            attempt: 0,
            criteria: [{ id: "coverage", label: "Coverage", threshold: 0.8 }],
            scores: [{
              id: "coverage",
              score: 9,
              passed: true,
              rationale: "The plan covers the required contract.",
              improvementInstructions: "",
            }],
            passed: true,
            finalDecision: "passed",
          },
        },
      } as unknown as ExecutionInvocationMessageRecord;

      const result = getSelfReflectionWidgetData(message);

      expect(result?.purposeLabel).toBe("Planning self-reflection");
      expect(result?.attemptLabel).toBe("Attempt 1");
      expect(result?.stateLabel).toBe("Passed");
      expect(result?.finalDecisionLabel).toBe("Passed");
      expect(result?.criteria[0]).toEqual(expect.objectContaining({
        id: "coverage",
        label: "Coverage",
        score: 9,
        scoreLabel: "9/10",
        starRating: 5,
        threshold: 8,
        thresholdLabel: "Threshold 8/10",
        passed: true,
        stateLabel: "Passed",
        rationale: "The plan covers the required contract.",
        improvementInstructions: null,
      }));
    });

    it("normalizes failing QA reflection metadata with improvement instructions", () => {
      const message = {
        metadata: {
          reflection: {
            purpose: "qa_review",
            attempt: 1,
            criteria: [{ id: "correctness", label: "Correctness", threshold: 0.85 }],
            scores: [{
              id: "correctness",
              score: 6,
              rationale: "The review missed a blocking defect.",
              improvementInstructions: "Add the missing regression finding.",
            }],
            passed: false,
            finalDecision: "improvement_requested",
          },
        },
      } as unknown as ExecutionInvocationMessageRecord;

      const result = getSelfReflectionWidgetData(message);

      expect(result?.purposeLabel).toBe("QA self-reflection");
      expect(result?.attemptLabel).toBe("Attempt 2");
      expect(result?.stateLabel).toBe("Needs improvement");
      expect(result?.finalDecisionLabel).toBe("Improvement Requested");
      expect(result?.criteria[0]).toEqual(expect.objectContaining({
        label: "Correctness",
        scoreLabel: "6/10",
        starRating: 3,
        thresholdLabel: "Threshold 8.5/10",
        passed: false,
        stateLabel: "Needs improvement",
        rationale: "The review missed a blocking defect.",
        improvementInstructions: "Add the missing regression finding.",
      }));
    });

    it("tolerates partial legacy and error reflection metadata without throwing", () => {
      const message = {
        metadata: {
          reflection: {
            purpose: "planning",
            criteria: [{ id: "scope_control", label: "Scope control", score: 7, threshold: 8 }],
            final_decision: "reflection_failed",
            error_message: "Reflection JSON could not be parsed.",
          },
        },
      } as unknown as ExecutionInvocationMessageRecord;

      const result = getSelfReflectionWidgetData(message);

      expect(result?.stateLabel).toBe("Reflection error");
      expect(result?.errorMessage).toBe("Reflection JSON could not be parsed.");
      expect(result?.finalDecisionLabel).toBe("Reflection Failed");
      expect(result?.criteria[0]).toEqual(expect.objectContaining({
        id: "scope_control",
        label: "Scope control",
        scoreLabel: "7/10",
        thresholdLabel: "Threshold 8/10",
        passed: false,
      }));
    });
  });

  describe("getWorkingBubbleData", () => {
    it("returns isPlanning: false when no runtime state", () => {
      const result = getWorkingBubbleData(null);
      expect(result).toEqual({ isPlanning: false });
    });

    it("returns isPlanning: true for virtual route", () => {
      const state: ConversationRuntimeState = {
        routeKind: "virtual"
      };
      const result = getWorkingBubbleData(state);
      expect(result.isPlanning).toBe(true);
      expect(result.planName).toBe("Execution Plan");
    });

    it("returns isPlanning: true for worker route with providerLabel", () => {
      const state: ConversationRuntimeState = {
        routeKind: "worker",
        providerLabel: "Anthropic"
      };
      const result = getWorkingBubbleData(state);
      expect(result.isPlanning).toBe(true);
      expect(result.planName).toBe("Task via Anthropic");
      expect(result.providerLabel).toBe("Anthropic");
    });

    it("returns isPlanning: true for continuationStatus === 'planning'", () => {
      const state: ConversationRuntimeState = {
        continuationStatus: "planning",
        modelLabel: "claude-3-opus"
      };
      const result = getWorkingBubbleData(state);
      expect(result.isPlanning).toBe(true);
      expect(result.modelLabel).toBe("claude-3-opus");
    });
  });
});
