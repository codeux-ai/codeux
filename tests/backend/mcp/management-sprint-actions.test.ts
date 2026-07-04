import { describe, it, expect, vi, beforeEach } from "vitest";
import { SprintActions } from "../../../src/mcp/management/sprint-actions.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ExecutionControlService } from "../../../src/services/execution-control-service.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { PlanningAgentService } from "../../../src/services/planning-agent-service.js";
import { SprintIssueService } from "../../../src/services/sprint-issue-service.js";
import type { ManageCodeUxArgs } from "../../../src/contracts/internal-management-types.js";
import { validateToolArguments } from "../../../src/api/mcp/validators/tool-validators.js";

describe("SprintActions", () => {
  let projectRepo: ProjectManagementRepository;
  let execControl: ExecutionControlService;
  let execRepo: ExecutionRepository;
  let planningAgentService: PlanningAgentService;
  let sprintIssueService: SprintIssueService;
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
    } as unknown as ExecutionRepository;

    planningAgentService = {
      planSprint: vi.fn(),
    } as unknown as PlanningAgentService;

    sprintIssueService = {
      searchIssues: vi.fn(),
      getIssuePromptContextsForReferences: vi.fn(),
      replaceLinkedIssues: vi.fn(),
    } as unknown as SprintIssueService;

    sprintActions = new SprintActions({
      projectManagementRepository: projectRepo,
      executionControlService: execControl,
      executionRepository: execRepo,
      planningAgentService,
      sprintIssueService,
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

  it("lists sprints", async () => {
    const mockResult = { sprints: [], selectedSprintId: null };
    vi.mocked(projectRepo.listSprints).mockReturnValue(mockResult);

    const result = await sprintActions.handleSprintAction(makeArgs("list", { projectId: "p1" }));
    expect(projectRepo.listSprints).toHaveBeenCalledWith("p1");
    expect(result.result).toEqual(mockResult);
  });

  it("gets sprint", async () => {
    const mockSprint = { id: "s1" };
    vi.mocked(projectRepo.getSprint).mockReturnValue(mockSprint as any);

    const result = await sprintActions.handleSprintAction(makeArgs("get", { sprintId: "s1" }));
    expect(projectRepo.getSprint).toHaveBeenCalledWith("s1");
    expect(result.result).toEqual(mockSprint);
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
      sprint: null,
      planning: null,
    });
  });

  it("rejects invalid import issue enum filters", async () => {
    await expect(sprintActions.handleSprintAction(makeArgs("import_issues", {
      projectId: "p1",
      provider: "bitbucket",
      search: "bug",
    }))).rejects.toThrow("Invalid value for provider. Must be one of: github, gitlab, jira");
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
    expect(projectRepo.replaceSprintLinkedIssues).toHaveBeenCalledWith("p1", "s1", [expect.not.objectContaining({
      issueBodyMarkdown: expect.any(String),
      issueConversationMarkdown: expect.any(String),
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

  it("plans a sprint with options", async () => {
    const mockPlanResult = { ok: true, createdTasksCount: 3 };
    vi.mocked(planningAgentService.planSprint).mockResolvedValue(mockPlanResult as any);

    const payload = {
      projectId: "p1",
      sprintId: "s1",
      autoStart: true,
      replan: false,
      planningAgentPresetId: "agent-1",
      overrides: { workerId: "w1" }
    };

    const result = await sprintActions.handleSprintAction(makeArgs("plan", payload));

    expect(planningAgentService.planSprint).toHaveBeenCalledWith("p1", "s1", {
      autoStart: true,
      replan: false,
      planningAgentPresetId: "agent-1",
      overrides: { workerId: "w1" }
    });
    expect(result.result).toEqual(mockPlanResult);
  });
});
