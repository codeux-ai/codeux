import { describe, expect, it, vi } from "vitest";
import type { AiProviderSettings, Subtask } from "../../../../../src/contracts/app-types.js";
import type { SprintRecord } from "../../../../../src/contracts/project-management-types.js";
import type { ExecutionRepository } from "../../../../../src/repositories/execution-repository.js";
import { buildSprintPrComposerInput } from "../../../../../src/domain/sprint/composer/sprint-pr-input-builder.js";

const allSections = {
  summary: true,
  taskChecklist: true,
  providerBreakdown: true,
  planningModel: true,
  mainPrompt: true,
  timing: true,
  tokenUsage: true,
  qaFindings: true,
  branchInfo: true,
};

function createExecutionRepository(): ExecutionRepository {
  return {
    getSprintRun: vi.fn(() => null),
    getSprintUsageGroups: vi.fn(() => []),
    listProviderInvocationsForSprint: vi.fn(() => []),
  } as unknown as ExecutionRepository;
}

describe("buildSprintPrComposerInput", () => {
  it("uses the supplied completion timestamp when the sprint run is not persisted as finished yet", () => {
    const executionRepository = createExecutionRepository();
    vi.mocked(executionRepository.getSprintRun).mockReturnValue({
      id: "sprint-run-1",
      projectId: "project-1",
      sprintId: "sprint-1",
      status: "running",
      triggerType: "mcp",
      triggeredBy: "worker",
      executorMode: "mixed",
      startedAt: "2026-07-03T02:18:16.000Z",
      finishedAt: null,
      lastHeartbeatAt: "2026-07-03T02:20:00.000Z",
      createdAt: "2026-07-03T02:18:16.000Z",
      updatedAt: "2026-07-03T02:20:00.000Z",
    });

    const input = buildSprintPrComposerInput({
      sprint: {
        id: "sprint-1",
        projectId: "project-1",
        number: 1,
        slug: "sprint-1",
        name: "Sprint 1",
        originalPrompt: "Complete sprint.",
        goal: "Complete sprint.",
        status: "running",
        showcasePinned: false,
        startDate: null,
        endDate: null,
        featureBranch: "sprint/1",
        baseCommitSha: null,
        tasksCount: 0,
        completion: 0,
        linkedIssues: [],
        createdAt: "2026-07-03T02:18:16.000Z",
        updatedAt: "2026-07-03T02:20:00.000Z",
      } as SprintRecord,
      sprintRunId: "sprint-run-1",
      subtasks: [] as Subtask[],
      featureBranch: "sprint/1",
      defaultBranch: "dev",
      aiProviderSettings: {
        provider: "codex",
        strategy: "SINGLE",
        providers: {},
        invocationRouting: {},
      } as unknown as AiProviderSettings,
      sections: allSections,
      completionTimestamp: "2026-07-03T02:31:30.000Z",
      executionRepository,
    });

    expect(input.startedAt).toBe("2026-07-03T02:18:16.000Z");
    expect(input.finishedAt).toBe("2026-07-03T02:31:30.000Z");
  });

  it("keeps persisted sprint run finishedAt authoritative over the completion timestamp", () => {
    const executionRepository = createExecutionRepository();
    vi.mocked(executionRepository.getSprintRun).mockReturnValue({
      id: "sprint-run-1",
      projectId: "project-1",
      sprintId: "sprint-1",
      status: "completed",
      triggerType: "mcp",
      triggeredBy: "worker",
      executorMode: "mixed",
      startedAt: "2026-07-03T02:18:16.000Z",
      finishedAt: "2026-07-03T02:45:00.000Z",
      lastHeartbeatAt: "2026-07-03T02:45:00.000Z",
      createdAt: "2026-07-03T02:18:16.000Z",
      updatedAt: "2026-07-03T02:45:00.000Z",
    });

    const input = buildSprintPrComposerInput({
      sprint: {
        id: "sprint-1",
        projectId: "project-1",
        number: 1,
        slug: "sprint-1",
        name: "Sprint 1",
        originalPrompt: "Complete sprint.",
        goal: "Complete sprint.",
        status: "completed",
        showcasePinned: false,
        startDate: null,
        endDate: null,
        featureBranch: "sprint/1",
        baseCommitSha: null,
        tasksCount: 0,
        completion: 100,
        linkedIssues: [],
        createdAt: "2026-07-03T02:18:16.000Z",
        updatedAt: "2026-07-03T02:45:00.000Z",
      } as SprintRecord,
      sprintRunId: "sprint-run-1",
      subtasks: [] as Subtask[],
      featureBranch: "sprint/1",
      defaultBranch: "dev",
      aiProviderSettings: {
        provider: "codex",
        strategy: "SINGLE",
        providers: {},
        invocationRouting: {},
      } as unknown as AiProviderSettings,
      sections: allSections,
      completionTimestamp: "2026-07-03T02:31:30.000Z",
      executionRepository,
    });

    expect(input.finishedAt).toBe("2026-07-03T02:45:00.000Z");
  });

  it("maps linked sprint issues into sprint PR composer input", () => {
    const sprint: SprintRecord = {
      id: "sprint-issue-links",
      projectId: "project-1",
      number: 12,
      slug: "issue-links",
      name: "Issue Links",
      originalPrompt: "Complete linked issue scope.",
      goal: "Complete linked issue scope.",
      status: "completed",
      showcasePinned: false,
      startDate: null,
      endDate: null,
      featureBranch: "sprint/12-issue-links",
      baseCommitSha: null,
      tasksCount: 0,
      completion: 0,
      linkedIssues: [
        {
          id: "linked-1",
          projectId: "project-1",
          sprintId: "sprint-issue-links",
          provider: "jira",
          hostDomain: "jira.example.test",
          projectKey: "OPS",
          repository: "OPS",
          issueNumber: 123,
          issueKey: "OPS-123",
          title: "Fix import status copy",
          url: "https://jira.example.test/browse/OPS-123",
          state: "In Progress",
          labels: [],
          assignees: [],
          importedAt: "2026-07-01T00:00:00.000Z",
          closedAt: null,
          closeState: "open",
          closeError: null,
          updatedAt: "2026-07-01T00:00:00.000Z",
        },
        {
          id: "linked-2",
          projectId: "project-1",
          sprintId: "sprint-issue-links",
          provider: "github",
          hostDomain: "github.example.test",
          repository: "example/app",
          issueNumber: 42,
          issueKey: "#42",
          title: "Restore completion note",
          url: "https://github.example.test/example/app/issues/42",
          state: "open",
          labels: [],
          assignees: [],
          importedAt: "2026-07-01T00:00:00.000Z",
          closedAt: null,
          closeState: "open",
          closeError: null,
          updatedAt: "2026-07-01T00:00:00.000Z",
        },
      ],
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    };

    const input = buildSprintPrComposerInput({
      sprint,
      sprintRunId: "sprint-run-1",
      subtasks: [] as Subtask[],
      featureBranch: "sprint/12-issue-links",
      defaultBranch: "dev",
      aiProviderSettings: {
        provider: "codex",
        strategy: "SINGLE",
        providers: {},
        invocationRouting: {},
      } as unknown as AiProviderSettings,
      sections: allSections,
      executionRepository: createExecutionRepository(),
    });

    expect(input.linkedIssues).toEqual([
      {
        provider: "jira",
        issueKey: "OPS-123",
        issueNumber: 123,
        title: "Fix import status copy",
        url: "https://jira.example.test/browse/OPS-123",
      },
      {
        provider: "github",
        issueKey: "#42",
        issueNumber: 42,
        title: "Restore completion note",
        url: "https://github.example.test/example/app/issues/42",
      },
    ]);
  });
});
