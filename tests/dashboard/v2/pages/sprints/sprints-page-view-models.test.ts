import { describe, it, expect } from "vitest";
import {
  buildPlanningConnection,
  buildPlanningRoute,
  getDefaultPlanningProviderMetadata,
  buildDisplaySprints,
  buildCiStatusBySprintId,
  countSprintsByStatus,
  countInWorkSprints,
} from "../../../../../dashboard/src/v2/pages/sprints/sprints-page-view-models.js";
import type { Sprint } from "../../../../../dashboard/src/v2/types.js";
import type { ConnectionState, DashboardSettings } from "../../../../../dashboard/src/types.js";
import type {
  ExecutionAttentionItemSummary,
  ExecutionRuntimeEventSummary,
  ExecutionSprintRunSummary,
  ExecutionTaskDispatchSummary,
} from "../../../../../src/contracts/app-types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../../../src/repositories/settings-defaults.js";

const dispatch = (
  taskId: string,
  taskKey: string,
  sprintId = "sprint-1",
): ExecutionTaskDispatchSummary => ({
  id: `dispatch-${taskId}`,
  projectId: "project-1",
  sprintId,
  sprintRunId: `run-${sprintId}`,
  sprintName: "Sprint",
  sprintNumber: 1,
  taskId,
  taskKey,
  taskTitle: taskKey,
  status: "running",
  executorType: "virtual",
  priority: 1,
  connectionId: null,
  connectionDisplayName: null,
  connectionRole: null,
  taskRunId: `run-${taskId}`,
  taskRunState: "in_progress",
  provider: null,
  sessionId: null,
  sessionName: null,
  workerBranch: null,
  prUrl: `https://example.test/pull/${taskId}`,
  queuedAt: "2026-07-13T09:00:00.000Z",
  claimedAt: null,
  startedAt: null,
  finishedAt: null,
  lastHeartbeatAt: null,
  errorMessage: null,
  activeLeaseOwnerKey: null,
  activeLeaseExpiresAt: null,
});

const sprintRun = (
  id: string,
  startedAt: string,
  overrides: Partial<ExecutionSprintRunSummary> = {},
): ExecutionSprintRunSummary => ({
  id,
  projectId: "project-1",
  sprintId: "sprint-1",
  sprintName: "Sprint",
  sprintNumber: 1,
  status: "completed",
  triggerType: "manual",
  triggeredBy: null,
  executorMode: "virtual",
  startedAt,
  finishedAt: null,
  lastHeartbeatAt: null,
  createdAt: startedAt,
  activeLeaseOwnerKey: null,
  activeLeaseExpiresAt: null,
  humanIntervention: null,
  ...overrides,
});

const ciEvent = (
  id: string,
  payload: Record<string, unknown>,
  overrides: Partial<ExecutionRuntimeEventSummary> = {},
): ExecutionRuntimeEventSummary => ({
  id,
  scopeType: "task_run",
  taskRunId: "run-task-1",
  sprintRunId: "run-sprint-1",
  dispatchId: "dispatch-task-1",
  projectId: "project-1",
  sprintId: "sprint-1",
  sprintName: "Sprint",
  sprintNumber: 1,
  sprintRunStatus: "running",
  taskId: "task-1",
  taskKey: "T01",
  taskTitle: "Task one",
  taskRunState: "in_progress",
  eventType: "ci_gate_status",
  originator: "system",
  sourceEventKey: null,
  provider: null,
  sessionId: null,
  sessionName: null,
  workerBranch: null,
  prUrl: "https://example.test/pull/1",
  connectionId: null,
  connectionDisplayName: null,
  connectionRole: null,
  createdAt: "2026-07-13T10:00:00.000Z",
  payload,
  ...overrides,
});

const ciAttention = (
  status: ExecutionAttentionItemSummary["status"] = "open",
  overrides: Partial<ExecutionAttentionItemSummary> = {},
): ExecutionAttentionItemSummary => ({
  id: "attention-1",
  sprintId: "sprint-1",
  taskId: "task-1",
  sprintRunId: "run-sprint-1",
  dispatchId: "dispatch-task-1",
  attentionType: "ci_fix_required",
  severity: "high",
  ownerType: "worker",
  status,
  assignedWorkerEndpointId: null,
  title: "CI fix required",
  summaryMarkdown: "Checks failed.",
  payload: { taskKey: "T01", prNumber: 1 },
  openedAt: "2026-07-13T10:00:00.000Z",
  claimedAt: null,
  resolvedAt: status === "resolved" ? "2026-07-13T10:05:00.000Z" : null,
  updatedAt: "2026-07-13T10:05:00.000Z",
  ...overrides,
});

describe("Sprints Page View Models", () => {
  describe("buildPlanningConnection", () => {
    it("orders by role priority then status priority", () => {
      const connections: ConnectionState[] = [
        { id: "1", role: "listener", status: "connected", listenMode: true, displayName: "A", metadata: {} } as ConnectionState,
        { id: "2", role: "worker", status: "connected", listenMode: true, displayName: "B", metadata: {} } as ConnectionState,
        { id: "3", role: "worker", status: "listening", listenMode: true, displayName: "C", metadata: {} } as ConnectionState,
      ];
      const selected = buildPlanningConnection(connections);
      // worker online should be top
      expect(selected?.id).toBe("3");
    });
  });

  describe("buildPlanningRoute", () => {
    it("returns virtual worker label if virtual mode", () => {
      const result = buildPlanningRoute(null, { executionMode: "VIRTUAL", virtualWorkerProvider: "gemini" });
      expect(result.available).toBe(true);
      expect(result.label).toBe("Gemini Primary");
    });

    it("returns connection display name if no virtual mode and connection exists", () => {
      const connection = { displayName: "Local Worker" } as ConnectionState;
      const result = buildPlanningRoute(connection, { executionMode: "MANUAL" });
      expect(result.available).toBe(true);
      expect(result.label).toBe("Local Worker");
    });

    it("returns unavailable if no connection and manual mode", () => {
      const result = buildPlanningRoute(null, { executionMode: "MANUAL" });
      expect(result.available).toBe(false);
      expect(result.label).toBeNull();
    });
  });

  describe("getDefaultPlanningProviderMetadata", () => {
    it("uses the planning route provider and model instead of the worker default", () => {
      const settings: DashboardSettings = {
        ...DEFAULT_DASHBOARD_SETTINGS,
        aiProvider: {
          ...DEFAULT_DASHBOARD_SETTINGS.aiProvider,
          providers: {
            ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers,
            gemini: {
              ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.gemini,
              name: "Worker Gemini",
              model: "gemini-2.5-pro",
            },
            codex: {
              ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.codex,
              name: "Planning Codex",
              model: "gpt-5.5",
            },
          },
          invocationRouting: {
            ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.invocationRouting,
            planning: {
              profile: "WORKER",
              strategy: "MANUAL",
              provider: "codex",
              allowedProviders: [],
              providers: {
                codex: {
                  model: "gpt-5.4",
                },
              },
            },
          },
        },
        workers: {
          ...DEFAULT_DASHBOARD_SETTINGS.workers,
          virtualWorkerProvider: "gemini",
          model: "gemini-2.5-pro",
        },
      };

      const metadata = getDefaultPlanningProviderMetadata(settings);

      expect(metadata).toMatchObject({
        providerConfigId: "codex",
        provider: "codex",
        displayLabel: "Planning Codex",
        iconProviderId: "codex",
        effectiveModel: "gpt-5.4",
      });
    });

    it("inherits the worker provider only when the planning route has no pinned provider", () => {
      const settings: DashboardSettings = {
        ...DEFAULT_DASHBOARD_SETTINGS,
        aiProvider: {
          ...DEFAULT_DASHBOARD_SETTINGS.aiProvider,
          providers: {
            ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers,
            gemini: {
              ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.gemini,
              name: "Worker Gemini",
              model: "default",
            },
          },
          invocationRouting: {
            ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.invocationRouting,
            planning: {
              profile: "WORKER",
              strategy: "MANUAL",
              provider: null,
              allowedProviders: [],
              providers: {},
            },
          },
        },
        workers: {
          ...DEFAULT_DASHBOARD_SETTINGS.workers,
          virtualWorkerProvider: "gemini",
          model: "gemini-2.5-pro",
        },
      };

      const metadata = getDefaultPlanningProviderMetadata(settings);

      expect(metadata).toMatchObject({
        providerConfigId: "gemini",
        provider: "gemini",
        displayLabel: "Worker Gemini",
        effectiveModel: "gemini-2.5-pro",
      });
    });
  });

  describe("buildDisplaySprints", () => {
    it("overrides status based on optimistic statuses", () => {
      const sprints = [{ id: "1", status: "running" }] as Sprint[];
      const optimistic = { "1": "running" };
      const suppressed = new Set<string>();
      const result = buildDisplaySprints(sprints, optimistic, suppressed);
      expect(result[0].status).toBe("running");
    });

    it("cancels running status if sprint is suppressed", () => {
      const sprints = [{ id: "1", status: "running" }] as Sprint[];
      const optimistic = {};
      const suppressed = new Set(["1"]);
      const result = buildDisplaySprints(sprints, optimistic, suppressed);
      expect(result[0].status).toBe("cancelled");
    });
  });

  describe("buildCiStatusBySprintId", () => {
    it("projects task-level and main-merge progress without merging their identities", () => {
      const taskProgress = buildCiStatusBySprintId(
        [{ id: "sprint-1" }],
        [dispatch("task-1", "T01")],
        [ciEvent("task-progress", { state: "waiting_checks", prNumber: 1, hasPendingChecks: true })],
        [],
      ).get("sprint-1");
      expect(taskProgress).toMatchObject({ state: "in_progress", label: "CI running" });

      const mainProgress = buildCiStatusBySprintId(
        [{ id: "sprint-1" }],
        [dispatch("task-1", "T01")],
        [
          ciEvent("task-success", { state: "merge_confirmed", prNumber: 1 }),
          ciEvent("main-progress", { state: "pending_checks", prNumber: 8 }, {
            scopeType: "sprint_run",
            taskRunId: null,
            dispatchId: null,
            taskId: null,
            taskKey: null,
            taskTitle: null,
            eventType: "main_merge_gate_status",
            createdAt: "2026-07-13T10:01:00.000Z",
          }),
        ],
        [],
      ).get("sprint-1");
      expect(mainProgress).toMatchObject({ state: "in_progress", label: "CI running" });
      expect(mainProgress?.steps[2]).toMatchObject({ id: "merge", state: "pending" });
    });

    it("gives active CI attention failure precedence and clears it once resolved with newer success", () => {
      const events = [ciEvent("success", { state: "ready_for_merge", prNumber: 1 })];
      const active = buildCiStatusBySprintId(
        [{ id: "sprint-1" }],
        [dispatch("task-1", "T01")],
        events,
        [ciAttention()],
      ).get("sprint-1");
      expect(active).toMatchObject({ state: "failed", label: "CI failed", failureKind: "ci_checks" });

      const resolved = buildCiStatusBySprintId(
        [{ id: "sprint-1" }],
        [dispatch("task-1", "T01")],
        events,
        [ciAttention("resolved")],
      ).get("sprint-1");
      expect(resolved).toMatchObject({ state: "pending", label: "CI pending" });
      expect(resolved?.failureKind).toBeUndefined();
    });

    it("supersedes stale per-task failures and aggregates mixed tasks by failure then progress precedence", () => {
      const associations = [dispatch("task-1", "T01"), dispatch("task-2", "T02")];
      const recoveredAndRunning = [
        ciEvent("t1-failure", { state: "waiting_checks", prNumber: 1, hasFailedChecks: true }),
        ciEvent("t1-success", { state: "merge_confirmed", prNumber: 1 }, {
          taskId: null,
          taskKey: "T01",
          createdAt: "2026-07-13T10:01:00.000Z",
        }),
        ciEvent("t2-progress", { state: "waiting_checks", prNumber: 2, hasPendingChecks: true }, {
          taskId: "task-2",
          taskKey: "T02",
          createdAt: "2026-07-13T10:02:00.000Z",
        }),
      ];
      const running = buildCiStatusBySprintId(
        [{ id: "sprint-1" }],
        associations,
        recoveredAndRunning,
        [],
      ).get("sprint-1");
      expect(running).toMatchObject({ state: "in_progress", label: "CI running" });

      const failed = buildCiStatusBySprintId(
        [{ id: "sprint-1" }],
        associations,
        [...recoveredAndRunning, ciEvent("t2-failure", { state: "waiting_checks", prNumber: 2, hasFailedChecks: true }, {
          taskId: "task-2",
          taskKey: "T02",
          createdAt: "2026-07-13T10:03:00.000Z",
        })],
        [],
      ).get("sprint-1");
      expect(failed).toMatchObject({ state: "failed", label: "CI failed" });
    });

    it("isolates unrelated sprint evidence", () => {
      const statuses = buildCiStatusBySprintId(
        [{ id: "sprint-1" }, { id: "sprint-2" }],
        [dispatch("task-2", "T02", "sprint-2")],
        [ciEvent("other-failure", { state: "waiting_checks", hasFailedChecks: true }, {
          sprintId: "sprint-2",
          sprintRunId: "run-sprint-2",
          taskId: "task-2",
          taskKey: "T02",
        })],
        [],
      );

      expect(statuses.has("sprint-1")).toBe(false);
      expect(statuses.get("sprint-2")).toMatchObject({ state: "failed", label: "CI failed" });
    });

    it("scopes CI evidence to the latest sprint rerun", () => {
      const oldRun = sprintRun("run-old", "2026-07-13T09:00:00.000Z");
      const currentRun = sprintRun("run-current", "2026-07-13T11:00:00.000Z", { status: "running" });
      const oldFailure = ciEvent("old-failure", { state: "waiting_checks", prNumber: 1, hasFailedChecks: true }, {
        sprintRunId: oldRun.id,
      });
      const currentProgress = ciEvent("current-progress", { state: "waiting_checks", prNumber: 2, hasPendingChecks: true }, {
        sprintRunId: currentRun.id,
        createdAt: "2026-07-13T11:05:00.000Z",
      });
      const oldAttention = ciAttention("open", { sprintRunId: oldRun.id });
      const oldDispatch = { ...dispatch("task-1", "T01"), sprintRunId: oldRun.id };
      const currentDispatch = { ...dispatch("task-1", "T01"), sprintRunId: currentRun.id };

      const status = buildCiStatusBySprintId(
        [{ id: "sprint-1" }],
        [oldDispatch, currentDispatch],
        [oldFailure, currentProgress],
        [oldAttention],
        [currentRun, oldRun],
      ).get("sprint-1");

      expect(status).toMatchObject({ state: "in_progress", label: "CI running" });
      expect(status?.failureKind).toBeUndefined();
    });

    it("does not resurrect a previous run badge when the current rerun has no CI evidence", () => {
      const oldRun = sprintRun("run-old", "2026-07-13T09:00:00.000Z");
      const currentRun = sprintRun("run-current", "2026-07-13T11:00:00.000Z", { status: "running" });
      const oldFailure = ciEvent("old-failure", { state: "waiting_checks", prNumber: 1, hasFailedChecks: true }, {
        sprintRunId: oldRun.id,
      });

      const statuses = buildCiStatusBySprintId(
        [{ id: "sprint-1" }],
        [{ ...dispatch("task-1", "T01"), sprintRunId: oldRun.id }],
        [oldFailure],
        [ciAttention("open", { sprintRunId: oldRun.id })],
        [oldRun, currentRun],
      );

      expect(statuses.has("sprint-1")).toBe(false);
    });
  });

  describe("Sprint Counts", () => {
    it("counts sprints by status", () => {
      const sprints = [
        { id: "1", status: "completed" },
        { id: "2", status: "completed" },
        { id: "3", status: "running" },
      ] as Sprint[];
      expect(countSprintsByStatus(sprints, "completed")).toBe(2);
      expect(countInWorkSprints(sprints)).toBe(1);
    });
  });
});
