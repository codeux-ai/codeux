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
