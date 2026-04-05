import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleSprintAction } from "../../../src/mcp/management/sprint-actions.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ExecutionControlService } from "../../../src/services/execution-control-service.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";

describe("handleSprintAction", () => {
  let projectRepo: ProjectManagementRepository;
  let execControl: ExecutionControlService;
  let execRepo: ExecutionRepository;

  beforeEach(() => {
    projectRepo = {
      listSprints: vi.fn(),
      getSprint: vi.fn(),
      createSprint: vi.fn(),
      updateSprint: vi.fn(),
      deleteSprint: vi.fn(),
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
  });

  it("lists sprints", async () => {
    const mockResult = { sprints: [], selectedSprintId: null };
    vi.mocked(projectRepo.listSprints).mockReturnValue(mockResult);

    const result = await handleSprintAction("list", { projectId: "p1" }, projectRepo, execControl, execRepo, "sprints");
    expect(projectRepo.listSprints).toHaveBeenCalledWith("p1");
    expect(result.result).toEqual(mockResult);
  });

  it("gets sprint", async () => {
    const mockSprint = { id: "s1" };
    vi.mocked(projectRepo.getSprint).mockReturnValue(mockSprint as any);

    const result = await handleSprintAction("get", { sprintId: "s1" }, projectRepo, execControl, execRepo, "sprints");
    expect(projectRepo.getSprint).toHaveBeenCalledWith("s1");
    expect(result.result).toEqual(mockSprint);
  });

  it("creates sprint", async () => {
    const mockSprint = { id: "s1" };
    vi.mocked(projectRepo.createSprint).mockReturnValue(mockSprint as any);

    const input = { projectId: "p1", name: "test-sprint" };
    const result = await handleSprintAction("create", input, projectRepo, execControl, execRepo, "sprints");
    expect(projectRepo.createSprint).toHaveBeenCalledWith("p1", input);
    expect(result.result).toEqual(mockSprint);
  });

  it("updates sprint", async () => {
    const mockSprint = { id: "s1" };
    vi.mocked(projectRepo.updateSprint).mockReturnValue(mockSprint as any);

    const input = { sprintId: "s1", name: "test-update" };
    const result = await handleSprintAction("update", input, projectRepo, execControl, execRepo, "sprints");
    expect(projectRepo.updateSprint).toHaveBeenCalledWith("s1", input);
    expect(result.result).toEqual(mockSprint);
  });

  it("requires approval for delete", async () => {
    const result = await handleSprintAction("delete", { sprintId: "s1" }, projectRepo, execControl, execRepo, "sprints");
    expect(result.approvalRequired).toBe(true);
    expect(projectRepo.deleteSprint).not.toHaveBeenCalled();
  });

  it("deletes sprint with approval", async () => {
    const result = await handleSprintAction("delete", { sprintId: "s1" }, projectRepo, execControl, execRepo, "sprints", { confirmed: true });
    expect(projectRepo.deleteSprint).toHaveBeenCalledWith("s1");
    expect(result.result).toEqual({ status: "success", deletedSprintId: "s1" });
  });

  it("starts sprint run", async () => {
    const result = await handleSprintAction("start", { projectId: "p1", sprintId: "s1" }, projectRepo, execControl, execRepo, "sprints");
    expect(execControl.orchestrateSprint).toHaveBeenCalledWith("p1", "s1");
    expect(result.result).toEqual({ status: "success", message: "Sprint orchestration started" });
  });

  it("pauses sprint run", async () => {
    const mockRun = { id: "r1" };
    vi.mocked(execControl.pauseSprintRun).mockReturnValue(mockRun as any);

    const result = await handleSprintAction("pause", { sprintRunId: "r1" }, projectRepo, execControl, execRepo, "sprints");
    expect(execControl.pauseSprintRun).toHaveBeenCalledWith("r1");
    expect(result.result).toEqual(mockRun);
  });

  it("cancels sprint run", async () => {
    const mockRun = { id: "r1" };
    vi.mocked(execControl.cancelSprintRun).mockReturnValue(mockRun as any);

    const result = await handleSprintAction("cancel", { sprintRunId: "r1" }, projectRepo, execControl, execRepo, "sprints");
    expect(execControl.cancelSprintRun).toHaveBeenCalledWith("r1");
    expect(result.result).toEqual(mockRun);
  });

  it("force cancels sprint run", async () => {
    const mockRun = { id: "r1" };
    vi.mocked(execControl.forceCancelSprintRun).mockResolvedValue(mockRun as any);

    const result = await handleSprintAction("force_cancel", { sprintRunId: "r1" }, projectRepo, execControl, execRepo, "sprints");
    expect(execControl.forceCancelSprintRun).toHaveBeenCalledWith("r1");
    expect(result.result).toEqual(mockRun);
  });

  it("inspects run", async () => {
    const mockSprint = { id: "s1" };
    const mockRuns = [{ id: "r1" }];
    vi.mocked(projectRepo.getSprint).mockReturnValue(mockSprint as any);
    vi.mocked(execRepo.listSprintRuns).mockReturnValue(mockRuns as any);

    const result = await handleSprintAction("inspect_run", { projectId: "p1", sprintId: "s1" }, projectRepo, execControl, execRepo, "sprints");
    expect(projectRepo.getSprint).toHaveBeenCalledWith("s1");
    expect(execRepo.listSprintRuns).toHaveBeenCalledWith("p1", "s1");
    expect(result.result).toEqual({ sprint: mockSprint, runs: mockRuns });
  });

  it("inspects specific run by id", async () => {
    const mockSprint = { id: "s1" };
    const mockRun = { id: "r1" };
    vi.mocked(projectRepo.getSprint).mockReturnValue(mockSprint as any);
    execRepo.getSprintRun = vi.fn().mockReturnValue(mockRun);

    const result = await handleSprintAction("inspect_run", { projectId: "p1", sprintId: "s1", sprintRunId: "r1" }, projectRepo, execControl, execRepo, "sprints");
    expect(projectRepo.getSprint).toHaveBeenCalledWith("s1");
    expect(execRepo.getSprintRun).toHaveBeenCalledWith("r1");
    expect(result.result).toEqual({ sprint: mockSprint, runs: [mockRun] });
  });
});
