import { describe, it, expect, vi, beforeEach } from "vitest";
import { SprintActions } from "../../../src/mcp/management/sprint-actions.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ExecutionControlService } from "../../../src/services/execution-control-service.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { PlanningAgentService } from "../../../src/services/planning-agent-service.js";
import { SprintIssueService } from "../../../src/services/sprint-issue-service.js";
import type { ManageCodeUxArgs } from "../../../src/contracts/internal-management-types.js";
import { validateToolArguments } from "../../../src/api/mcp/validators/tool-validators.js";
import { runWithMcpAgentContext } from "../../../src/server/mcp-agent-context.js";
import type { SchedulerService } from "../../../src/services/scheduler-service.js";
import type { Logger } from "../../../src/shared/logging/logger.js";
import type { ExecutionInvocationRecord } from "../../../src/contracts/invocation-types.js";

describe("SprintActions", () => {
  let projectRepo: ProjectManagementRepository;
  let execControl: ExecutionControlService;
  let execRepo: ExecutionRepository;
  let planningAgentService: PlanningAgentService;
  let sprintIssueService: SprintIssueService;
  let schedulerService: Pick<SchedulerService, "createEntry">;
  let logger: Logger;
  let sprintActions: SprintActions;

  beforeEach(() => {
    projectRepo = {
      listSprints: vi.fn(),
      getSprint: vi.fn(),
      createSprint: vi.fn(),
      updateSprint: vi.fn(),
      deleteSprint: vi.fn(),
      replaceSprintLinkedIssues: vi.fn(),
    } as unknown as ProjectManagementRepository;

    execControl = {
      orchestrateSprint: vi.fn().mockResolvedValue({ ok: true }),
      pauseSprintRun: vi.fn(),
      cancelSprintRun: vi.fn(),
      forceCancelSprintRun: vi.fn(),
    } as unknown as ExecutionControlService;

    execRepo = {
      listSprintRuns: vi.fn(),
      listExecutionInvocations: vi.fn().mockReturnValue([]),
    } as unknown as ExecutionRepository;

    planningAgentService = {
      planSprint: vi.fn(),
      startPlanSprint: vi.fn(),
    } as unknown as PlanningAgentService;

    schedulerService = {
      createEntry: vi.fn(),
    };
    logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    };

    sprintIssueService = {
      searchIssues: vi.fn(),
      getIssuePromptContextsForReferences: vi.fn(),
      replaceLinkedIssues: vi.fn(),
      importLinkedIssues: vi.fn(async (sprintId: string, projectId: string, issues: any[]) => ({
        linkedIssues: projectRepo.replaceSprintLinkedIssues(projectId, sprintId, issues) as any,
        warnings: [],
      })),
    } as unknown as SprintIssueService;

    sprintActions = new SprintActions({
      projectManagementRepository: projectRepo,
      executionControlService: execControl,
      executionRepository: execRepo,
      planningAgentService,
      sprintIssueService,
      schedulerService,
      logger,
    });
  });

  const makeArgs = (action: ManageCodeUxArgs["action"], payload: Record<string, unknown>, approval?: any): ManageCodeUxArgs => {
    return {
      domain: "sprints",
      action: action as any,
      payload,
      approval
    };
  };

  const makeInvocation = (
    overrides: Partial<ExecutionInvocationRecord> = {},
  ): ExecutionInvocationRecord => ({
    id: "inv-1",
    projectId: "p1",
    sprintId: "s1",
    taskId: null,
    sprintRunId: null,
    dispatchId: null,
    taskRunId: null,
    attentionItemId: null,
    providerInvocationId: null,
    type: "planning",
    status: "running",
    provider: null,
    model: null,
    systemPrompt: null,
    startedAt: "2026-07-13T10:00:00.000Z",
    finishedAt: null,
    errorMessage: null,
    lastErrorCategory: null,
    lastErrorMessage: null,
    lastRetryAfterIso: null,
    messageCount: 0,
    lastMessageAt: null,
    createdAt: "2026-07-13T10:00:00.000Z",
    updatedAt: "2026-07-13T10:00:00.000Z",
    ...overrides,
  });

  it("lists sprints", async () => {
    const mockResult = { sprints: [], selectedSprintId: null };
    vi.mocked(projectRepo.listSprints).mockReturnValue(mockResult);

    const result = await sprintActions.handleSprintAction(makeArgs("list", { projectId: "p1" }));
    expect(projectRepo.listSprints).toHaveBeenCalledWith("p1");
    expect(result.result).toEqual(mockResult);
  });

  it("gets sprint", async () => {
    const mockSprint = { id: "s1", projectId: "p1" };
    vi.mocked(projectRepo.getSprint).mockReturnValue(mockSprint as any);

    const result = await sprintActions.handleSprintAction(makeArgs("get", { sprintId: "s1" }));
    expect(projectRepo.getSprint).toHaveBeenCalledWith("s1");
    expect(result.result).toEqual(mockSprint);
    expect(execRepo.listExecutionInvocations).toHaveBeenCalledWith({ projectId: "p1", sprintId: "s1" });
  });

  it("adds one-minute guidance to get while the latest durable planning invocation is running", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T10:05:00.000Z"));
    try {
      const sprint = { id: "s1", projectId: "p1", name: "Planning sprint" };
      const running = makeInvocation();
      const completedSample = makeInvocation({
        id: "sample-1",
        sprintId: "older-sprint",
        status: "completed",
        startedAt: "2026-07-13T09:00:00.000Z",
        finishedAt: "2026-07-13T09:02:00.000Z",
      });
      vi.mocked(projectRepo.getSprint).mockReturnValue(sprint as any);
      vi.mocked(execRepo.listExecutionInvocations).mockImplementation((params) => (
        params.sprintId ? [running] : [running, completedSample]
      ));

      const response = await sprintActions.handleSprintAction(makeArgs("get", { sprintId: "s1" }));

      expect(response.result).toMatchObject({
        ...sprint,
        planningGuidance: {
          status: "in_progress",
          invocationId: "inv-1",
          estimatedDurationMs: 120_000,
          nextCheckAt: "2026-07-13T10:06:00.000Z",
          isTerminal: false,
        },
      });
      expect(schedulerService.createEntry).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["completed", "succeeded"],
    ["failed", "failed"],
    ["cancelled", "cancelled"],
    ["paused", "paused"],
  ] as const)("maps durable %s planning to terminal %s get guidance", async (status, guidanceStatus) => {
    const sprint = { id: "s1", projectId: "p1", name: "Planning sprint" };
    const terminal = makeInvocation({
      status,
      finishedAt: "2026-07-13T10:02:00.000Z",
      errorMessage: status === "failed" ? "Provider unavailable." : null,
    });
    vi.mocked(projectRepo.getSprint).mockReturnValue(sprint as any);
    vi.mocked(execRepo.listExecutionInvocations).mockImplementation((params) => (
      params.sprintId ? [terminal] : [terminal]
    ));

    const response = await sprintActions.handleSprintAction(makeArgs("get", { sprintId: "s1" }));

    expect(response.result).toMatchObject({
      ...sprint,
      planningGuidance: {
        status: guidanceStatus,
        invocationId: "inv-1",
        isTerminal: true,
        nextCheckAt: null,
        ...(status === "failed" ? { errorMessage: "Provider unavailable." } : {}),
      },
    });
  });

  it("creates sprint", async () => {
    const mockSprint = { id: "s1" };
    vi.mocked(projectRepo.createSprint).mockReturnValue(mockSprint as any);

    const input = { projectId: "p1", name: "test-sprint", goal: "Ship it" };
    const result = await sprintActions.handleSprintAction(makeArgs("create", input));
    expect(projectRepo.createSprint).toHaveBeenCalledWith("p1", { name: "test-sprint", goal: "Ship it" });
    expect(result.result).toEqual(mockSprint);
  });

  it("creates sprint from public MCP title aliases", async () => {
    const mockSprint = { id: "s1" };
    vi.mocked(projectRepo.createSprint).mockReturnValue(mockSprint as any);

    const result = await sprintActions.handleSprintAction(makeArgs("create", {
      projectId: "p1",
      title: "MCP Sprint",
      goalMarkdown: "Build the MCP path",
    }));

    expect(projectRepo.createSprint).toHaveBeenCalledWith("p1", {
      name: "MCP Sprint",
      goal: "Build the MCP path",
    });
    expect(result.result).toEqual(mockSprint);
  });

  it("allows sprint creation without a title", async () => {
    const mockSprint = { id: "s1", name: "Untitled sprint 1" };
    vi.mocked(projectRepo.createSprint).mockReturnValue(mockSprint as any);

    const result = await sprintActions.handleSprintAction(makeArgs("create", { projectId: "p1" }));

    expect(projectRepo.createSprint).toHaveBeenCalledWith("p1", {});
    expect(result.result).toEqual(mockSprint);
  });

  it("saves follow-up work as an idle unplanned draft without starting planning", async () => {
    const mockSprint = {
      id: "s-followup",
      projectId: "p1",
      name: "Deferred follow-up",
      goal: "Apply the findings after the current sprint.",
      status: "idle",
    };
    vi.mocked(projectRepo.createSprint).mockReturnValue(mockSprint as any);

    const result = await sprintActions.handleSprintAction(makeArgs("followup", {
      projectId: "p1",
      title: "Deferred follow-up",
      goalMarkdown: "Apply the findings after the current sprint.",
      status: "running",
    }));

    expect(projectRepo.createSprint).toHaveBeenCalledWith("p1", {
      name: "Deferred follow-up",
      goal: "Apply the findings after the current sprint.",
      status: "idle",
    });
    expect(planningAgentService.planSprint).not.toHaveBeenCalled();
    expect(planningAgentService.startPlanSprint).not.toHaveBeenCalled();
    expect(execControl.orchestrateSprint).not.toHaveBeenCalled();
    expect(schedulerService.createEntry).not.toHaveBeenCalled();
    expect(result.result).toEqual(mockSprint);
  });

  it("rejects blank required strings before repository calls", async () => {
    await expect(sprintActions.handleSprintAction(makeArgs("list", { projectId: "   " })))
      .rejects.toThrow("projectId is required");
    expect(projectRepo.listSprints).not.toHaveBeenCalled();
  });

  it("rejects invalid sprint status enum values", async () => {
    await expect(sprintActions.handleSprintAction(makeArgs("create", {
      projectId: "p1",
      title: "Sprint",
      status: "not-real",
    }))).rejects.toThrow("Invalid value for status. Must be one of: running, paused, completed, failed, cancelled, idle");
    expect(projectRepo.createSprint).not.toHaveBeenCalled();
  });

  it("updates sprint", async () => {
    const mockSprint = { id: "s1" };
    vi.mocked(projectRepo.updateSprint).mockReturnValue(mockSprint as any);

    const input = { sprintId: "s1", title: "test-update", goalMarkdown: "Updated goal" };
    const result = await sprintActions.handleSprintAction(makeArgs("update", input));
    expect(projectRepo.updateSprint).toHaveBeenCalledWith("s1", { name: "test-update", goal: "Updated goal" });
    expect(result.result).toEqual(mockSprint);
  });

  it("requires approval for delete", async () => {
    const result = await sprintActions.handleSprintAction(makeArgs("delete", { sprintId: "s1" }));
    expect(result.approvalRequired).toBe(true);
    expect(projectRepo.deleteSprint).not.toHaveBeenCalled();
  });

  it("deletes sprint with approval", async () => {
    const result = await sprintActions.handleSprintAction(makeArgs("delete", { sprintId: "s1" }, { confirmed: true }));
    expect(projectRepo.deleteSprint).toHaveBeenCalledWith("s1");
    expect(result.result).toEqual({ status: "success", deletedSprintId: "s1" });
  });

  it("starts sprint run", async () => {
    const result = await sprintActions.handleSprintAction(makeArgs("start", { projectId: "p1", sprintId: "s1" }));
    expect(execControl.orchestrateSprint).toHaveBeenCalledWith("p1", "s1");
    expect(result.result).toEqual({ status: "success", message: "Sprint orchestration started", orchestration: { ok: true } });
  });

  it("pauses sprint run", async () => {
    const mockRun = { id: "r1" };
    vi.mocked(execControl.pauseSprintRun).mockReturnValue(mockRun as any);

    const result = await sprintActions.handleSprintAction(makeArgs("pause", { sprintRunId: "r1" }));
    expect(execControl.pauseSprintRun).toHaveBeenCalledWith("r1");
    expect(result.result).toEqual(mockRun);
  });

  it("cancels sprint run", async () => {
    const mockRun = { id: "r1" };
    vi.mocked(execControl.cancelSprintRun).mockReturnValue(mockRun as any);

    const result = await sprintActions.handleSprintAction(makeArgs("cancel", { sprintRunId: "r1" }));
    expect(execControl.cancelSprintRun).toHaveBeenCalledWith("r1");
    expect(result.result).toEqual(mockRun);
  });

  it("force cancels sprint run", async () => {
    const mockRun = { id: "r1" };
    vi.mocked(execControl.forceCancelSprintRun).mockResolvedValue(mockRun as any);

    const result = await sprintActions.handleSprintAction(makeArgs("force_cancel", { sprintRunId: "r1" }));
    expect(execControl.forceCancelSprintRun).toHaveBeenCalledWith("r1");
    expect(result.result).toEqual(mockRun);
  });

  it("inspects run", async () => {
    const mockSprint = { id: "s1" };
    const mockRuns = [{ id: "r1" }];
    vi.mocked(projectRepo.getSprint).mockReturnValue(mockSprint as any);
    vi.mocked(execRepo.listSprintRuns).mockReturnValue(mockRuns as any);

    const result = await sprintActions.handleSprintAction(makeArgs("inspect_run", { projectId: "p1", sprintId: "s1" }));
    expect(projectRepo.getSprint).toHaveBeenCalledWith("s1");
    expect(execRepo.listSprintRuns).toHaveBeenCalledWith("p1", "s1");
    expect(result.result).toEqual({ sprint: mockSprint, runs: mockRuns });
  });

  it("inspects specific run by id", async () => {
    const mockSprint = { id: "s1" };
    const mockRun = { id: "r1" };
    vi.mocked(projectRepo.getSprint).mockReturnValue(mockSprint as any);
    execRepo.getSprintRun = vi.fn().mockReturnValue(mockRun);

    const result = await sprintActions.handleSprintAction(makeArgs("inspect_run", { projectId: "p1", sprintId: "s1", sprintRunId: "r1" }));
    expect(projectRepo.getSprint).toHaveBeenCalledWith("s1");
    expect(execRepo.getSprintRun).toHaveBeenCalledWith("r1");
    expect(result.result).toEqual({ sprint: mockSprint, runs: [mockRun] });
  });

  it("searches GitHub issues without requiring a sprint", async () => {
    const mockIssues = [{
      provider: "github",
      hostDomain: "github.com",
      repository: "acme/widgets",
      issueNumber: 123,
      issueKey: "#123",
      title: "Test Issue",
      url: "https://github.com/acme/widgets/issues/123",
      state: "open",
      labels: ["bug"],
      assignees: ["alice"],
      bodyPreview: "preview",
      createdAt: null,
      updatedAt: null,
      issueAuthor: null,
      issueReporter: null,
      issueMilestone: null,
      issueType: null,
      issuePriority: null,
      issueCommentCount: null,
      sourceProvider: "github",
    }];
    vi.mocked(sprintIssueService.searchIssues).mockResolvedValue(mockIssues as any);

    const result = await sprintActions.handleSprintAction(makeArgs("import_issues", {
      projectId: "p1",
      search: " query ",
      provider: "github",
      labels: [" bug ", ""],
      assignee: " alice ",
      limit: 500,
    }));

    expect(sprintIssueService.searchIssues).toHaveBeenCalledWith("p1", expect.objectContaining({
      search: "query",
      provider: "github",
      labels: ["bug"],
      assignee: "alice",
      limit: 100,
    }));
    expect(projectRepo.replaceSprintLinkedIssues).not.toHaveBeenCalled();
    expect(result.result).toEqual({
      mode: "search",
      provider: "github",
      searchedIssues: mockIssues,
      importedContexts: [],
      linkedIssues: [],
      warnings: [],
      sprint: null,
      planning: null,
    });
  });

  it("rejects invalid import issue enum filters", async () => {
    await expect(sprintActions.handleSprintAction(makeArgs("import_issues", {
      projectId: "p1",
      provider: "bitbucket",
      search: "bug",
    }))).rejects.toThrow("Invalid value for provider. Must be one of: github, gitlab, jira, notion, asana, linear, miro, lucid, figma, mural");
    expect(sprintIssueService.searchIssues).not.toHaveBeenCalled();
  });

  it("rejects invalid numeric string import limits", async () => {
    await expect(sprintActions.handleSprintAction(makeArgs("import_issues", {
      projectId: "p1",
      provider: "github",
      search: "bug",
      limit: "many",
    }))).rejects.toThrow("Invalid value for limit. Must be a valid integer.");
    expect(sprintIssueService.searchIssues).not.toHaveBeenCalled();
  });

  it("searches GitLab issues with repository filters and attaches legacy sprint search imports", async () => {
    const mockIssues = [{
      provider: "gitlab",
      hostDomain: "gitlab.example.com",
      repository: "acme/widgets",
      issueNumber: 7,
      issueKey: "!7",
      title: "GitLab Issue",
      url: "https://gitlab.example.com/acme/widgets/-/issues/7",
      state: "opened",
    }];
    const mockLinkedRecords = [{ id: "link-1", issueNumber: 7 }];
    vi.mocked(sprintIssueService.searchIssues).mockResolvedValue(mockIssues as any);
    vi.mocked(projectRepo.getSprint).mockReturnValue({ id: "s1", projectId: "p1", goal: "Existing goal" } as any);
    vi.mocked(projectRepo.replaceSprintLinkedIssues).mockReturnValue(mockLinkedRecords as any);

    const result = await sprintActions.handleSprintAction(makeArgs("import_issues", {
      projectId: "p1",
      sprintId: "s1",
      search: "query",
      provider: "gitlab",
      repository: " acme/widgets ",
      hostDomain: " gitlab.example.com ",
      limit: 10,
    }));

    expect(sprintIssueService.searchIssues).toHaveBeenCalledWith("p1", expect.objectContaining({
      search: "query",
      provider: "gitlab",
      repository: "acme/widgets",
      hostDomain: "gitlab.example.com",
      limit: 10,
    }));
    expect(projectRepo.replaceSprintLinkedIssues).toHaveBeenCalledWith("p1", "s1", [expect.objectContaining({
      provider: "gitlab",
      issueNumber: 7,
      title: "GitLab Issue",
    })]);
    expect(result.result).toMatchObject({
      mode: "search",
      provider: "gitlab",
      searchedIssues: mockIssues,
      linkedIssues: mockLinkedRecords,
      planning: null,
    });
  });

  it("searches Jira issues with Jira-specific filters", async () => {
    vi.mocked(sprintIssueService.searchIssues).mockResolvedValue([{ provider: "jira", issueKey: "OPS-42" }] as any);

    const result = await sprintActions.handleSprintAction(makeArgs("import_issues", {
      projectId: "p1",
      provider: "jira",
      projectKey: " OPS ",
      search: "login failure",
      status: "in_progress",
      assigneeText: " me ",
      limit: 0,
    }));

    expect(sprintIssueService.searchIssues).toHaveBeenCalledWith("p1", expect.objectContaining({
      provider: "jira",
      projectKey: "OPS",
      search: "login failure",
      status: "in_progress",
      assigneeText: "me",
      limit: 1,
    }));
    expect(result.result).toMatchObject({
      mode: "search",
      provider: "jira",
      linkedIssues: [],
    });
  });

  it("uses full Jira search result body when attaching and planning after import", async () => {
    const fullJiraBody = [
      "## Problem",
      "",
      "The login flow fails for SSO users after token refresh.",
      "",
      "### Acceptance Criteria",
      "",
      "- Keep this exact Jira acceptance criterion in the sprint goal.",
    ].join("\n");
    const searchedIssues = [{
      provider: "jira",
      sourceProvider: "jira",
      hostDomain: "acme.atlassian.net",
      projectKey: "OPS",
      repository: "OPS",
      issueNumber: 42,
      issueKey: "OPS-42",
      title: "SSO login refresh failure",
      url: "https://acme.atlassian.net/browse/OPS-42",
      state: "In Progress",
      labels: ["sso", "bug"],
      assignees: ["alice"],
      bodyPreview: "The login flow fails for SSO users...",
      issueBodyMarkdown: fullJiraBody,
      issueConversationMarkdown: "",
      includeConversation: false,
      createdAt: "2026-05-19T10:00:00.000+0000",
      updatedAt: "2026-05-20T10:00:00.000+0000",
      issueAuthor: "Morgan Reporter",
      issueCreatedAt: "2026-05-19T10:00:00.000+0000",
      issueUpdatedAt: "2026-05-20T10:00:00.000+0000",
      issueReporter: "Morgan Reporter",
      issueMilestone: "v1",
      issueType: "Bug",
      issuePriority: "High",
      issueCommentCount: 3,
      metadata: { issueType: "Bug", priority: "High" },
    }];
    const linkedRecords = [{ id: "link-1", issueKey: "OPS-42" }];
    const planResult = { createdTasksCount: 1 };
    vi.mocked(sprintIssueService.searchIssues).mockResolvedValue(searchedIssues as any);
    vi.mocked(projectRepo.getSprint).mockReturnValue({ id: "s1", projectId: "p1", goal: "Existing goal" } as any);
    vi.mocked(projectRepo.replaceSprintLinkedIssues).mockReturnValue(linkedRecords as any);
    vi.mocked(projectRepo.updateSprint).mockReturnValue({ id: "s1", projectId: "p1", goal: "updated goal" } as any);
    vi.mocked(planningAgentService.planSprint).mockResolvedValue(planResult as any);

    const result = await sprintActions.handleSprintAction(makeArgs("import_issues", {
      projectId: "p1",
      sprintId: "s1",
      provider: "jira",
      search: "SSO login",
      planAfterImport: true,
    }));

    expect(sprintIssueService.searchIssues).toHaveBeenCalledWith("p1", expect.objectContaining({
      provider: "jira",
      search: "SSO login",
    }));
    expect(sprintIssueService.getIssuePromptContextsForReferences).not.toHaveBeenCalled();
    expect(sprintIssueService.importLinkedIssues).toHaveBeenCalledWith("s1", "p1", [expect.objectContaining({
      provider: "jira",
      issueKey: "OPS-42",
      issueBodyMarkdown: fullJiraBody,
      includeConversation: false,
      issueAuthor: "Morgan Reporter",
      issueCreatedAt: "2026-05-19T10:00:00.000+0000",
      issueUpdatedAt: "2026-05-20T10:00:00.000+0000",
      metadata: { issueType: "Bug", priority: "High" },
    })]);
    const updatedGoal = vi.mocked(projectRepo.updateSprint).mock.calls[0]?.[1].goal;
    expect(updatedGoal).toContain("Keep this exact Jira acceptance criterion in the sprint goal.");
    expect(updatedGoal).not.toContain("_No issue body was provided._");
    expect(projectRepo.updateSprint).toHaveBeenCalledBefore(planningAgentService.planSprint as any);
    expect(result.result).toMatchObject({
      mode: "search",
      provider: "jira",
      searchedIssues,
      linkedIssues: linkedRecords,
      planning: planResult,
    });
  });

  it("searches Linear issues without requiring a sprint", async () => {
    const mockIssues = [{
      provider: "linear",
      sourceProvider: "linear",
      sourceKind: "issue",
      externalId: "lin-id-1",
      hostDomain: "linear.app",
      repository: "LIN",
      issueNumber: null,
      issueKey: "LIN-42",
      title: "Linear Issue",
      url: "https://linear.app/acme/issue/LIN-42/linear-issue",
      state: "In Progress",
      labels: ["integration"],
      assignees: ["alice"],
      bodyPreview: "preview",
      createdAt: null,
      updatedAt: null,
      issueAuthor: null,
      issueReporter: null,
      issueMilestone: null,
      issueType: "Issue",
      issuePriority: null,
      issueCommentCount: null,
    }];
    vi.mocked(sprintIssueService.searchIssues).mockResolvedValue(mockIssues as any);

    const result = await sprintActions.handleSprintAction(makeArgs("import_issues", {
      projectId: "p1",
      provider: "linear",
      search: " import ",
      state: "In Progress",
      labels: [" integration "],
      teamKey: " lin ",
      externalProjectId: " project-1 ",
      includeConversation: true,
      limit: 5,
    }));

    expect(sprintIssueService.searchIssues).toHaveBeenCalledWith("p1", expect.objectContaining({
      provider: "linear",
      search: "import",
      state: "In Progress",
      labels: ["integration"],
      teamKey: "lin",
      providerProjectId: "project-1",
      includeConversation: true,
      limit: 5,
    }));
    expect(projectRepo.replaceSprintLinkedIssues).not.toHaveBeenCalled();
    expect(result.result).toMatchObject({
      mode: "search",
      provider: "linear",
      searchedIssues: mockIssues,
      linkedIssues: [],
      planning: null,
    });
  });

  it("imports explicit Jira issue keys into a sprint", async () => {
    const contexts = [{
      provider: "jira",
      hostDomain: "acme.atlassian.net",
      repository: "OPS",
      projectKey: "OPS",
      issueNumber: 42,
      issueKey: "OPS-42",
      title: "Ship Jira import",
      url: "https://acme.atlassian.net/browse/OPS-42",
      state: "In Progress",
      labels: ["backend"],
      assignees: ["alice"],
      issueBodyMarkdown: "Full Jira body",
      issueConversationMarkdown: "Jira comments",
      includeConversation: true,
      issueAuthor: "bob",
      issueCreatedAt: "2026-05-01T00:00:00.000Z",
      issueUpdatedAt: "2026-05-02T00:00:00.000Z",
      metadata: { issueType: "Story", priority: "High" },
    }];
    const linkedRecords = [{ id: "link-1", issueKey: "OPS-42" }];
    vi.mocked(sprintIssueService.getIssuePromptContextsForReferences).mockResolvedValue(contexts as any);
    vi.mocked(projectRepo.getSprint).mockReturnValue({ id: "s1", projectId: "p1", goal: "Existing goal" } as any);
    vi.mocked(projectRepo.replaceSprintLinkedIssues).mockReturnValue(linkedRecords as any);
    vi.mocked(projectRepo.updateSprint).mockReturnValue({ id: "s1", projectId: "p1", goal: "updated" } as any);

    const result = await sprintActions.handleSprintAction(makeArgs("import_issues", {
      projectId: "p1",
      sprintId: "s1",
      provider: "jira",
      issueKeys: [" OPS-42 "],
    }));

    expect(sprintIssueService.getIssuePromptContextsForReferences).toHaveBeenCalledWith("p1", expect.objectContaining({
      provider: "jira",
      issueKeys: ["OPS-42"],
    }));
    expect(projectRepo.replaceSprintLinkedIssues).toHaveBeenCalledWith("p1", "s1", [expect.objectContaining({
      issueBodyMarkdown: "Full Jira body",
      issueConversationMarkdown: "Jira comments",
      includeConversation: true,
      issueAuthor: "bob",
      issueCreatedAt: "2026-05-01T00:00:00.000Z",
      issueUpdatedAt: "2026-05-02T00:00:00.000Z",
      metadata: { issueType: "Story", priority: "High" },
    })]);
    expect(projectRepo.updateSprint).toHaveBeenCalledWith("s1", {
      goal: expect.stringContaining("Full Jira body"),
    });
    expect(result.result).toMatchObject({
      mode: "explicit",
      provider: "jira",
      searchedIssues: [],
      importedContexts: contexts,
      linkedIssues: linkedRecords,
      warnings: [],
    });
  });

  it("imports explicit Notion external IDs into a sprint and appends prompt context", async () => {
    const contexts = [{
      provider: "notion",
      sourceProvider: "notion",
      sourceKind: "page",
      externalId: "page-1",
      hostDomain: "notion.so",
      repository: "workspace",
      issueNumber: null,
      issueKey: "page:page-1",
      title: "Notion roadmap",
      url: "https://www.notion.so/page-1",
      state: "open",
      labels: ["page"],
      assignees: [],
      issueBodyMarkdown: "Notion acceptance criteria",
      issueConversationMarkdown: "",
      includeConversation: false,
      issueAuthor: null,
      issueCreatedAt: "2026-05-01T00:00:00.000Z",
      issueUpdatedAt: "2026-05-02T00:00:00.000Z",
    }];
    const linkedRecords = [{ id: "link-1", externalId: "page-1" }];
    vi.mocked(sprintIssueService.getIssuePromptContextsForReferences).mockResolvedValue(contexts as any);
    vi.mocked(projectRepo.getSprint).mockReturnValue({ id: "s1", projectId: "p1", goal: "Existing goal" } as any);
    vi.mocked(projectRepo.replaceSprintLinkedIssues).mockReturnValue(linkedRecords as any);
    vi.mocked(projectRepo.updateSprint).mockReturnValue({ id: "s1", projectId: "p1", goal: "updated" } as any);

    const result = await sprintActions.handleSprintAction(makeArgs("import_issues", {
      projectId: "p1",
      sprintId: "s1",
      provider: "notion",
      externalIds: [" page-1 "],
    }));

    expect(sprintIssueService.getIssuePromptContextsForReferences).toHaveBeenCalledWith("p1", expect.objectContaining({
      provider: "notion",
      externalIds: ["page-1"],
    }));
    expect(sprintIssueService.importLinkedIssues).toHaveBeenCalledWith("s1", "p1", [expect.objectContaining({
      provider: "notion",
      sourceKind: "page",
      externalId: "page-1",
      issueNumber: null,
    })]);
    expect(projectRepo.updateSprint).toHaveBeenCalledWith("s1", {
      goal: expect.stringContaining("Notion acceptance criteria"),
    });
    expect(result.result).toMatchObject({
      mode: "explicit",
      provider: "notion",
      importedContexts: contexts,
      linkedIssues: linkedRecords,
    });
  });

  it("parses canvas import fields and imports explicit Figma file context", async () => {
    const contexts = [{
      provider: "figma",
      sourceProvider: "figma",
      sourceKind: "file",
      externalId: "file-1",
      hostDomain: "figma.com",
      repository: "files",
      issueNumber: null,
      issueKey: "file:file-1",
      title: "Design spec",
      url: "https://www.figma.com/file/file-1",
      state: "open",
      labels: ["file"],
      assignees: [],
      issueBodyMarkdown: "## Page 1",
      issueConversationMarkdown: "##### Comment 1 - @Alice\n\nPlease preserve this layout",
      includeConversation: true,
      issueAuthor: null,
      issueCreatedAt: null,
      issueUpdatedAt: "2026-05-02T00:00:00.000Z",
    }];
    const linkedRecords = [{ id: "link-1", externalId: "file-1" }];
    vi.mocked(sprintIssueService.getIssuePromptContextsForReferences).mockResolvedValue(contexts as any);
    vi.mocked(projectRepo.getSprint).mockReturnValue({ id: "s1", projectId: "p1", goal: "Existing goal" } as any);
    vi.mocked(projectRepo.replaceSprintLinkedIssues).mockReturnValue(linkedRecords as any);
    vi.mocked(projectRepo.updateSprint).mockReturnValue({ id: "s1", projectId: "p1", goal: "updated" } as any);

    const result = await sprintActions.handleSprintAction(makeArgs("import_issues", {
      projectId: "p1",
      sprintId: "s1",
      provider: "figma",
      fileKey: " file-1 ",
      boardId: " board-1 ",
      documentId: " doc-1 ",
      workspaceId: " workspace-1 ",
      muralId: " mural-1 ",
      itemTypes: [" sticky_note ", "text"],
      includeConversation: true,
    }));

    expect(sprintIssueService.getIssuePromptContextsForReferences).toHaveBeenCalledWith("p1", expect.objectContaining({
      provider: "figma",
      fileKey: "file-1",
      boardId: "board-1",
      documentId: "doc-1",
      workspaceId: "workspace-1",
      muralId: "mural-1",
      itemTypes: ["sticky_note", "text"],
      includeConversation: true,
    }));
    expect(sprintIssueService.importLinkedIssues).toHaveBeenCalledWith("s1", "p1", [expect.objectContaining({
      provider: "figma",
      sourceKind: "file",
      externalId: "file-1",
      issueNumber: null,
    })]);
    expect(projectRepo.updateSprint).toHaveBeenCalledWith("s1", {
      goal: expect.stringContaining("Please preserve this layout"),
    });
    expect(result.result).toMatchObject({
      mode: "explicit",
      provider: "figma",
      importedContexts: contexts,
      linkedIssues: linkedRecords,
    });
  });

  it("returns Jira import transition warnings without dropping linked issues", async () => {
    const contexts = [{
      provider: "jira",
      hostDomain: "acme.atlassian.net",
      repository: "OPS",
      projectKey: "OPS",
      issueNumber: 42,
      issueKey: "OPS-42",
      title: "Ship Jira import",
      url: "https://acme.atlassian.net/browse/OPS-42",
      issueBodyMarkdown: "",
      issueConversationMarkdown: "",
      includeConversation: false,
      issueAuthor: null,
      issueCreatedAt: null,
      issueUpdatedAt: null,
    }];
    const linkedRecords = [{ id: "link-1", issueKey: "OPS-42" }];
    vi.mocked(sprintIssueService.getIssuePromptContextsForReferences).mockResolvedValue(contexts as any);
    vi.mocked(projectRepo.getSprint).mockReturnValue({ id: "s1", projectId: "p1", goal: "Existing goal" } as any);
    vi.mocked(sprintIssueService.importLinkedIssues).mockResolvedValue({
      linkedIssues: linkedRecords as any,
      warnings: [{ issueId: "link-1", issueKey: "OPS-42", message: "Transition 'In Work' not found for Jira issue OPS-42" }],
    });

    const result = await sprintActions.handleSprintAction(makeArgs("import_issues", {
      projectId: "p1",
      sprintId: "s1",
      provider: "jira",
      issueKeys: ["OPS-42"],
    }));

    expect(sprintIssueService.importLinkedIssues).toHaveBeenCalledWith("s1", "p1", [expect.objectContaining({
      provider: "jira",
      issueKey: "OPS-42",
    })]);
    expect(result.result).toMatchObject({
      linkedIssues: linkedRecords,
      warnings: [{ issueId: "link-1", issueKey: "OPS-42", message: "Transition 'In Work' not found for Jira issue OPS-42" }],
    });
  });

  it("imports explicit GitHub and GitLab issue numbers", async () => {
    const contexts = [
      {
        provider: "github",
        hostDomain: "github.com",
        repository: "acme/widgets",
        issueNumber: 42,
        issueKey: "#42",
        title: "GitHub issue",
        url: "https://github.com/acme/widgets/issues/42",
        state: "open",
        labels: [],
        assignees: [],
        issueBodyMarkdown: "GitHub body",
        issueConversationMarkdown: "",
        includeConversation: true,
        issueAuthor: null,
        issueCreatedAt: null,
        issueUpdatedAt: null,
      },
      {
        provider: "gitlab",
        hostDomain: "gitlab.example.com",
        repository: "acme/widgets",
        issueNumber: 7,
        issueKey: "!7",
        title: "GitLab issue",
        url: "https://gitlab.example.com/acme/widgets/-/issues/7",
        state: "opened",
        labels: [],
        assignees: [],
        issueBodyMarkdown: "GitLab body",
        issueConversationMarkdown: "",
        includeConversation: true,
        issueAuthor: null,
        issueCreatedAt: null,
        issueUpdatedAt: null,
      },
    ];
    vi.mocked(sprintIssueService.getIssuePromptContextsForReferences).mockResolvedValue(contexts as any);
    vi.mocked(projectRepo.getSprint).mockReturnValue({ id: "s1", projectId: "p1", goal: "Existing goal" } as any);
    vi.mocked(projectRepo.replaceSprintLinkedIssues).mockReturnValue([{ id: "link-1" }, { id: "link-2" }] as any);
    vi.mocked(projectRepo.updateSprint).mockReturnValue({ id: "s1", projectId: "p1", goal: "updated" } as any);

    await sprintActions.handleSprintAction(makeArgs("import_issues", {
      projectId: "p1",
      sprintId: "s1",
      provider: "github",
      issueNumbers: [42, "7"],
      issueRefs: ["#42", "!7"],
    }));

    expect(sprintIssueService.getIssuePromptContextsForReferences).toHaveBeenCalledWith("p1", expect.objectContaining({
      provider: "github",
      issueNumbers: [42, 7],
      issueRefs: ["#42", "!7"],
    }));
    expect(projectRepo.replaceSprintLinkedIssues).toHaveBeenCalledWith("p1", "s1", [
      expect.objectContaining({ provider: "github", issueNumber: 42 }),
      expect.objectContaining({ provider: "gitlab", issueNumber: 7 }),
    ]);
  });

  it("passes includeConversation false for explicit imports", async () => {
    vi.mocked(sprintIssueService.getIssuePromptContextsForReferences).mockResolvedValue([] as any);

    await sprintActions.handleSprintAction(makeArgs("import_issues", {
      projectId: "p1",
      provider: "github",
      issueRefs: ["#42"],
      includeConversation: false,
    }));

    expect(sprintIssueService.getIssuePromptContextsForReferences).toHaveBeenCalledWith("p1", expect.objectContaining({
      includeConversation: false,
    }));
    expect(projectRepo.replaceSprintLinkedIssues).not.toHaveBeenCalled();
  });

  it("does not attach imported issues when attachToSprint is false", async () => {
    const contexts = [{
      provider: "github",
      hostDomain: "github.com",
      repository: "acme/widgets",
      issueNumber: 42,
      title: "GitHub issue",
      url: "https://github.com/acme/widgets/issues/42",
      issueBodyMarkdown: "Body",
      issueConversationMarkdown: "",
      includeConversation: true,
      issueAuthor: null,
      issueCreatedAt: null,
      issueUpdatedAt: null,
    }];
    vi.mocked(sprintIssueService.getIssuePromptContextsForReferences).mockResolvedValue(contexts as any);

    const result = await sprintActions.handleSprintAction(makeArgs("import_issues", {
      projectId: "p1",
      sprintId: "s1",
      provider: "github",
      issueRefs: ["#42"],
      attachToSprint: false,
    }));

    expect(projectRepo.getSprint).not.toHaveBeenCalled();
    expect(projectRepo.replaceSprintLinkedIssues).not.toHaveBeenCalled();
    expect(projectRepo.updateSprint).not.toHaveBeenCalled();
    expect(result.result).toMatchObject({
      mode: "explicit",
      linkedIssues: [],
      sprint: null,
      planning: null,
    });
  });

  it("enriches the sprint goal with imported issue body and conversation", async () => {
    const contexts = [{
      provider: "github",
      hostDomain: "github.com",
      repository: "acme/widgets",
      issueNumber: 42,
      issueKey: "#42",
      title: "Improve import UX",
      url: "https://github.com/acme/widgets/issues/42",
      state: "open",
      labels: ["ux"],
      assignees: ["alice"],
      issueBodyMarkdown: "Acceptance criteria",
      issueConversationMarkdown: "##### Comment 1 - @bob\n\nNeeds care",
      includeConversation: true,
      issueAuthor: "alice",
      issueCreatedAt: null,
      issueUpdatedAt: null,
    }];
    vi.mocked(sprintIssueService.getIssuePromptContextsForReferences).mockResolvedValue(contexts as any);
    vi.mocked(projectRepo.getSprint).mockReturnValue({ id: "s1", projectId: "p1", goal: "Existing goal" } as any);
    vi.mocked(projectRepo.replaceSprintLinkedIssues).mockReturnValue([{ id: "link-1" }] as any);
    vi.mocked(projectRepo.updateSprint).mockReturnValue({ id: "s1", projectId: "p1", goal: "updated goal" } as any);

    await sprintActions.handleSprintAction(makeArgs("import_issues", {
      projectId: "p1",
      sprintId: "s1",
      provider: "github",
      issueRefs: ["#42"],
    }));

    expect(projectRepo.updateSprint).toHaveBeenCalledWith("s1", {
      goal: expect.stringContaining("Acceptance criteria"),
    });
    expect(vi.mocked(projectRepo.updateSprint).mock.calls[0]?.[1].goal).toContain("Needs care");
    expect(vi.mocked(projectRepo.updateSprint).mock.calls[0]?.[1]).not.toHaveProperty("name");
  });

  it("plans after import only when requested", async () => {
    const contexts = [{
      provider: "github",
      hostDomain: "github.com",
      repository: "acme/widgets",
      issueNumber: 42,
      title: "GitHub issue",
      url: "https://github.com/acme/widgets/issues/42",
      issueBodyMarkdown: "Body",
      issueConversationMarkdown: "",
      includeConversation: true,
      issueAuthor: null,
      issueCreatedAt: null,
      issueUpdatedAt: null,
    }];
    const planResult = { createdTasksCount: 2 };
    vi.mocked(sprintIssueService.getIssuePromptContextsForReferences).mockResolvedValue(contexts as any);
    vi.mocked(projectRepo.getSprint).mockReturnValue({ id: "s1", projectId: "p1", goal: "Existing goal" } as any);
    vi.mocked(projectRepo.replaceSprintLinkedIssues).mockReturnValue([{ id: "link-1" }] as any);
    vi.mocked(projectRepo.updateSprint).mockReturnValue({ id: "s1", projectId: "p1", goal: "updated goal" } as any);
    vi.mocked(planningAgentService.planSprint).mockResolvedValue(planResult as any);

    const result = await sprintActions.handleSprintAction(makeArgs("import_issues", {
      projectId: "p1",
      sprintId: "s1",
      provider: "github",
      issueRefs: ["#42"],
      planAfterImport: true,
      autoStart: true,
      replan: true,
      planningAgentPresetId: "agent-1",
      overrides: { workerId: "w1" },
    }));

    expect(projectRepo.replaceSprintLinkedIssues).toHaveBeenCalledBefore(planningAgentService.planSprint as any);
    expect(projectRepo.updateSprint).toHaveBeenCalledBefore(planningAgentService.planSprint as any);
    expect(planningAgentService.planSprint).toHaveBeenCalledWith("p1", "s1", {
      autoStart: true,
      replan: true,
      planningAgentPresetId: "agent-1",
      overrides: { workerId: "w1" },
    });
    expect(result.result).toMatchObject({
      planning: planResult,
    });
  });

  it("validates the expanded import_issues MCP payload contract", () => {
    expect(() => validateToolArguments("manage_sprints", {
      action: "import_issues",
      projectId: "p1",
      sprintId: "s1",
      provider: "jira",
      repository: "acme/widgets",
      hostDomain: "acme.atlassian.net",
      projectKey: "OPS",
      search: "login failure",
      state: "all",
      status: "in_progress",
      labels: ["triage", "backend"],
      assignee: "alice",
      assigneeText: "me",
      issueKeys: ["OPS-42"],
      issueNumbers: [42],
      issueRefs: ["#42", "OPS-42"],
      externalIds: ["page-1", "LIN-42"],
      workspaceId: "workspace-1",
      providerProjectId: "provider-project-1",
      teamId: "team-1",
      teamKey: "LIN",
      databaseId: "database-1",
      boardId: "board-1",
      documentId: "document-1",
      fileKey: "file-1",
      muralId: "mural-1",
      itemTypes: ["sticky_note", "text"],
      includeConversation: true,
      attachToSprint: true,
      planAfterImport: true,
      autoStart: false,
      limit: 25,
      planningAgentPresetId: "agent-1",
      replan: true,
      overrides: { route: "planner" },
    })).not.toThrow();

    expect(() => validateToolArguments("manage_sprints", {
      action: "import_issues",
      provider: "bitbucket",
    })).toThrow("Invalid arguments for tool manage_sprints");
  });

  it("validates the followup MCP action and its public sprint aliases", () => {
    expect(() => validateToolArguments("manage_sprints", {
      action: "followup",
      projectId: "p1",
      title: "Deferred follow-up",
      goalMarkdown: "Plan this only when the scheduled sprint starts.",
    })).not.toThrow();
  });

  it("returns before background planning settles and queues a success wakeup", async () => {
    let resolvePlanning!: (value: any) => void;
    const planning = new Promise<any>((resolve) => {
      resolvePlanning = resolve;
    });
    vi.mocked(planningAgentService.startPlanSprint).mockReturnValue(planning);
    vi.mocked(execRepo.listExecutionInvocations).mockReturnValue([
      makeInvocation({
        id: "sample-new",
        status: "completed",
        startedAt: "2026-07-13T09:00:00.000Z",
        finishedAt: "2026-07-13T09:02:00.000Z",
      }),
      makeInvocation({
        id: "sample-old",
        status: "completed",
        startedAt: "2026-07-12T09:00:00.000Z",
        finishedAt: "2026-07-12T09:04:00.000Z",
      }),
    ]);

    const payload = {
      projectId: "p1",
      sprintId: "s1",
      autoStart: true,
      replan: false,
      planningAgentPresetId: "agent-1",
      overrides: { workerId: "w1" }
    };

    const result = await runWithMcpAgentContext("agent-1", "thread-1", () =>
      sprintActions.handleSprintAction(makeArgs("plan", payload)));

    expect(planningAgentService.startPlanSprint).toHaveBeenCalledWith("p1", "s1", {
      autoStart: true,
      replan: false,
      planningAgentPresetId: "agent-1",
      overrides: { workerId: "w1" }
    });
    expect(result.result).toMatchObject({
      status: "started",
      message: "Sprint planning started in the background. You will be notified when it completes or fails.",
      projectId: "p1",
      sprintId: "s1",
      planningGuidance: {
        status: "in_progress",
        asynchronous: true,
        isTerminal: false,
        estimatedDurationMs: 180_000,
        sampleSize: 2,
        isFallbackEstimate: false,
      },
    });
    expect((result.result as any).planningGuidance.invocationId).toMatch(/^mcp-plan:p1:s1:/);
    expect((result.result as any).planningGuidance.nextCheckAt)
      .toBe((result.result as any).planningGuidance.estimatedCompletionAt);
    expect(schedulerService.createEntry).not.toHaveBeenCalled();

    resolvePlanning({ ok: true, invocationId: "inv-1", agentId: "planner-1", createdTaskIds: ["t1", "t2"], started: true });
    await vi.waitFor(() => expect(schedulerService.createEntry).toHaveBeenCalledTimes(1));
    expect(schedulerService.createEntry).toHaveBeenCalledWith("p1", expect.objectContaining({
      targetType: "agent_wakeup",
      scheduledFor: expect.any(String),
      recurrence: { frequency: "none", interval: 1, endMode: "never" },
      agentWakeupTarget: expect.objectContaining({
        threadId: "thread-1",
        origin: "agent_scheduler",
        source: "agent_scheduler",
        createdByAgentId: "agent-1",
        bodyMarkdown: expect.stringMatching(/2 task\(s\).*Execution started: yes/s),
      }),
    }));
  });

  it("suppresses duplicate in-flight planning and returns one-minute guidance", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T10:00:00.000Z"));
    try {
      let resolvePlanning!: (value: any) => void;
      const planning = new Promise<any>((resolve) => {
        resolvePlanning = resolve;
      });
      const persisted = makeInvocation({
        id: "inv-active",
        startedAt: "2026-07-13T10:00:01.000Z",
      });
      vi.mocked(planningAgentService.startPlanSprint).mockReturnValue(planning);
      vi.mocked(execRepo.listExecutionInvocations)
        .mockReturnValueOnce([])
        .mockReturnValue([persisted]);

      const first = await runWithMcpAgentContext("agent-1", "thread-1", () =>
        sprintActions.handleSprintAction(makeArgs("plan", { projectId: "p1", sprintId: "s1" })));
      vi.setSystemTime(new Date("2026-07-13T10:00:30.000Z"));
      const duplicate = await runWithMcpAgentContext("agent-1", "thread-1", () =>
        sprintActions.handleSprintAction(makeArgs("plan", { projectId: "p1", sprintId: "s1" })));

      expect(first.result).toMatchObject({ status: "started" });
      expect(duplicate.result).toMatchObject({
        status: "in_progress",
        projectId: "p1",
        sprintId: "s1",
        planningGuidance: {
          status: "in_progress",
          invocationId: "inv-active",
          nextCheckAt: "2026-07-13T10:01:30.000Z",
          isTerminal: false,
        },
      });
      expect(planningAgentService.startPlanSprint).toHaveBeenCalledTimes(1);
      expect(schedulerService.createEntry).not.toHaveBeenCalled();

      resolvePlanning({ ok: true, invocationId: "inv-active", agentId: "planner-1", createdTaskIds: [], started: false });
      await vi.runAllTimersAsync();
      expect(schedulerService.createEntry).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("prefers the active planning promise over a prematurely completed audit row", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T10:00:00.000Z"));
    try {
      const planning = new Promise<any>(() => undefined);
      const completedAudit = makeInvocation({
        id: "inv-active",
        status: "completed",
        startedAt: "2026-07-13T10:00:01.000Z",
        finishedAt: "2026-07-13T10:00:20.000Z",
      });
      vi.mocked(projectRepo.getSprint).mockReturnValue({ id: "s1", projectId: "p1", name: "Sprint" } as any);
      vi.mocked(planningAgentService.startPlanSprint).mockReturnValue(planning);
      vi.mocked(execRepo.listExecutionInvocations)
        .mockReturnValueOnce([])
        .mockReturnValue([completedAudit]);

      await sprintActions.handleSprintAction(makeArgs("plan", { projectId: "p1", sprintId: "s1" }));
      vi.setSystemTime(new Date("2026-07-13T10:00:30.000Z"));
      const response = await sprintActions.handleSprintAction(makeArgs("get", { sprintId: "s1" }));

      expect(response.result).toMatchObject({
        planningGuidance: {
          status: "in_progress",
          invocationId: "inv-active",
          nextCheckAt: "2026-07-13T10:01:30.000Z",
          isTerminal: false,
        },
      });
      expect(schedulerService.createEntry).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps synchronous planning precondition failures on the error path", async () => {
    vi.mocked(planningAgentService.startPlanSprint).mockImplementation(() => {
      throw new Error("Sprint already has tasks; replan is required.");
    });

    await expect(sprintActions.handleSprintAction(makeArgs("plan", {
      projectId: "p1",
      sprintId: "s1",
    }))).rejects.toThrow("Sprint already has tasks; replan is required.");

    await expect(sprintActions.handleSprintAction(makeArgs("plan", {
      projectId: "p1",
      sprintId: "s1",
    }))).rejects.toThrow("Sprint already has tasks; replan is required.");
    expect(planningAgentService.startPlanSprint).toHaveBeenCalledTimes(2);
  });

  it("queues a same-thread failure wakeup after background planning rejects", async () => {
    let rejectPlanning!: (error: Error) => void;
    const planning = new Promise<any>((_resolve, reject) => {
      rejectPlanning = reject;
    });
    vi.mocked(planningAgentService.startPlanSprint).mockReturnValue(planning);

    const result = await runWithMcpAgentContext("agent-2", "thread-2", () =>
      sprintActions.handleSprintAction(makeArgs("plan", { projectId: "p1", sprintId: "s1" })));
    expect(result.result).toMatchObject({ status: "started" });

    rejectPlanning(new Error("provider unavailable"));
    await vi.waitFor(() => expect(schedulerService.createEntry).toHaveBeenCalledTimes(1));
    expect(schedulerService.createEntry).toHaveBeenCalledWith("p1", expect.objectContaining({
      agentWakeupTarget: expect.objectContaining({
        threadId: "thread-2",
        createdByAgentId: "agent-2",
        bodyMarkdown: expect.stringContaining("provider unavailable"),
      }),
    }));
  });

  it("skips completion wakeups when MCP chat context is unavailable", async () => {
    vi.mocked(planningAgentService.startPlanSprint).mockResolvedValue({
      ok: true,
      invocationId: "inv-1",
      agentId: "planner-1",
      createdTaskIds: [],
      started: false,
    });

    const result = await sprintActions.handleSprintAction(makeArgs("plan", { projectId: "p1", sprintId: "s1" }));
    expect(result.result).toMatchObject({ status: "started" });
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalled());
    expect(schedulerService.createEntry).not.toHaveBeenCalled();
  });
});
