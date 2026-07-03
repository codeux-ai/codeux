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

  it("returns a clear validation error when sprint create has no title", async () => {
    await expect(sprintActions.handleSprintAction(makeArgs("create", { projectId: "p1" })))
      .rejects.toThrow("name or title is required");
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

  it("imports issues into a sprint", async () => {
    const mockIssues = [{ issueNumber: 123, title: "Test Issue" }];
    const mockLinkedRecords = [{ id: "link-1", issueNumber: 123 }];
    vi.mocked(sprintIssueService.searchIssues).mockResolvedValue(mockIssues as any);
    vi.mocked(projectRepo.replaceSprintLinkedIssues).mockReturnValue(mockLinkedRecords as any);

    const payload = {
      projectId: "p1",
      sprintId: "s1",
      search: "query",
      provider: "github",
      limit: 10
    };

    const result = await sprintActions.handleSprintAction(makeArgs("import_issues", payload));

    expect(sprintIssueService.searchIssues).toHaveBeenCalledWith("p1", {
      search: "query",
      provider: "github",
      limit: 10
    });
    expect(projectRepo.replaceSprintLinkedIssues).toHaveBeenCalledWith("p1", "s1", mockIssues);
    expect(result.result).toEqual(mockLinkedRecords);
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
