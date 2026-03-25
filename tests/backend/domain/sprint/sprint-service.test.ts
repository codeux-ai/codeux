import { describe, it, expect, vi, beforeEach } from "vitest";
import { SprintService } from "../../../../src/domain/sprint/sprint-service.js";
import { ProjectManagementRepository } from "../../../../src/repositories/project-management-repository.js";
import { SprintRepository } from "../../../../src/infrastructure/repositories/sprint-repository.js";
import type { SprintRecord, ProjectSummary } from "../../../../src/contracts/project-management-types.js";

describe("SprintService", () => {
  let projectRepository: vi.Mocked<ProjectManagementRepository>;
  let sprintRepository: vi.Mocked<SprintRepository>;
  let sprintService: SprintService;

  beforeEach(() => {
    projectRepository = {
      getProject: vi.fn(),
      getSprint: vi.fn(),
      updateSprint: vi.fn(),
      deleteTasksBySprint: vi.fn(),
      createTask: vi.fn(),
    } as unknown as vi.Mocked<ProjectManagementRepository>;

    sprintRepository = {
      writeSingleTaskSprint: vi.fn(),
    } as unknown as vi.Mocked<SprintRepository>;

    sprintService = new SprintService(projectRepository, sprintRepository);
  });

  describe("createSingleTaskSprint", () => {
    const mockProject = { id: "p1", name: "Project 1", baseDir: "/repo" } as ProjectSummary;
    const mockSprint = {
      id: "s1",
      projectId: "p1",
      number: 42,
      name: "Sprint 42",
      status: "idle",
      goal: "",
    } as SprintRecord;

    it("should initialize a sprint directory and write T01.md", async () => {
      projectRepository.getProject.mockReturnValue(mockProject);
      projectRepository.getSprint.mockReturnValue(mockSprint);
      projectRepository.updateSprint.mockReturnValue({ ...mockSprint, goal: "New goal", status: "running" });

      const updatedSprint = await sprintService.createSingleTaskSprint(
        "p1",
        "s1",
        "New goal",
        "Do the thing",
        "/repo"
      );

      expect(projectRepository.getProject).toHaveBeenCalledWith("p1");
      expect(projectRepository.getSprint).toHaveBeenCalledWith("s1");

      expect(sprintRepository.writeSingleTaskSprint).toHaveBeenCalledWith(
        "/repo",
        42,
        "Complete sprint goal",
        "Do the thing"
      );

      expect(projectRepository.updateSprint).toHaveBeenCalledWith("s1", {
        goal: "New goal",
        status: "running",
      });

      expect(projectRepository.deleteTasksBySprint).toHaveBeenCalledWith("s1");
      expect(projectRepository.createTask).toHaveBeenCalledWith("p1", {
        sprintId: "s1",
        taskKey: "T01",
        title: "Complete sprint goal",
        promptMarkdown: "Do the thing",
        description: "Auto-generated single task sprint",
        status: "pending",
        priority: "medium",
        executorType: "auto",
        dependsOnTaskIds: [],
        isIndependent: true,
        isMerged: false,
      });

      expect(updatedSprint.goal).toBe("New goal");
      expect(updatedSprint.status).toBe("running");
    });

    it("should throw if project is not found", async () => {
      projectRepository.getProject.mockReturnValue(undefined);

      await expect(
        sprintService.createSingleTaskSprint("p1", "s1", "goal", "inst", "/repo")
      ).rejects.toThrowError("Project not found: p1");
    });

    it("should throw if sprint is not found", async () => {
      projectRepository.getProject.mockReturnValue(mockProject);
      projectRepository.getSprint.mockReturnValue(undefined);

      await expect(
        sprintService.createSingleTaskSprint("p1", "s1", "goal", "inst", "/repo")
      ).rejects.toThrowError("Sprint not found in project: s1");
    });
  });
});
