import { describe, expect, it, vi } from "vitest";
import { SprintExecutionStateService } from "../../../src/services/sprint-execution-state-service.js";
import type { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import type { ExecutionRepository } from "../../../src/repositories/execution-repository.js";

describe("SprintExecutionStateService", () => {
  const mockProjectManagementRepository = {
    getProject: vi.fn(),
    getSprint: vi.fn(),
    getSelectedProjectId: vi.fn(),
    findProjectByBaseDir: vi.fn(),
    findSprintByProjectAndNumber: vi.fn(),
    listTasks: vi.fn(),
  } as unknown as ProjectManagementRepository;

  const mockExecutionRepository = {
    listLatestTaskRuns: vi.fn(),
  } as unknown as ExecutionRepository;

  const service = new SprintExecutionStateService(
    mockProjectManagementRepository,
    mockExecutionRepository,
  );

  describe("resolveContext", () => {
    it("should resolve context for a project and sprint", () => {
      const mockProject = { id: "p1", name: "P1", baseDir: "/tmp" };
      const mockSprint = { id: "s1", number: 1, projectId: "p1" };
      
      vi.mocked(mockProjectManagementRepository.getProject).mockReturnValue(mockProject);
      vi.mocked(mockProjectManagementRepository.getSprint).mockReturnValue(mockSprint);

      const args = { project_id: "p1", sprint_id: "s1" };
      const settings = { git: { defaultBranch: "main", sprintBranchScheme: "sprint-{sprint}" } } as any;

      const context = service.resolveContext(args, settings);

      expect(context.project).toBe(mockProject);
      expect(context.sprint).toBe(mockSprint);
      expect(context.sprintNumber).toBe(1);
      expect(context.featureBranch).toBe("sprint-1");
    });

    it("should throw error if project not found", () => {
      vi.mocked(mockProjectManagementRepository.getProject).mockReturnValue(undefined);
      const args = { project_id: "p1", sprint_id: "s1" };
      const settings = {} as any;

      expect(() => service.resolveContext(args, settings)).toThrow("Project not found: p1");
    });

    it("should resolve project by repo_path if project_id is missing", () => {
      const mockProject = { id: "p1", name: "P1", baseDir: "/tmp" };
      vi.mocked(mockProjectManagementRepository.findProjectByBaseDir).mockReturnValue(mockProject);
      vi.mocked(mockProjectManagementRepository.getSprint).mockReturnValue({ id: "s1", number: 1, projectId: "p1" });

      const args = { repo_path: "/tmp", sprint_id: "s1" };
      const settings = { git: { defaultBranch: "main" } } as any;

      const context = service.resolveContext(args, settings);
      expect(context.project).toBe(mockProject);
    });

    it("should resolve project by selected project if others are missing", () => {
      const mockProject = { id: "p1", name: "P1", baseDir: "/tmp" };
      vi.mocked(mockProjectManagementRepository.getSelectedProjectId).mockReturnValue("p1");
      vi.mocked(mockProjectManagementRepository.getProject).mockReturnValue(mockProject);
      vi.mocked(mockProjectManagementRepository.getSprint).mockReturnValue({ id: "s1", number: 1, projectId: "p1" });

      const args = { sprint_id: "s1" };
      const settings = { git: { defaultBranch: "main" } } as any;

      const context = service.resolveContext(args, settings);
      expect(context.project).toBe(mockProject);
    });

    it("should throw error if no project scope can be resolved", () => {
      vi.mocked(mockProjectManagementRepository.getSelectedProjectId).mockReturnValue(null);
      const args = { sprint_id: "s1" };
      const settings = {} as any;
      expect(() => service.resolveContext(args, settings)).toThrow("No project scope could be resolved");
    });

    it("should resolve sprint by number", () => {
      const mockProject = { id: "p1", name: "P1", baseDir: "/tmp" };
      const mockSprint = { id: "s1", number: 5, projectId: "p1" };
      vi.mocked(mockProjectManagementRepository.getProject).mockReturnValue(mockProject);
      vi.mocked(mockProjectManagementRepository.findSprintByProjectAndNumber).mockReturnValue(mockSprint);

      const args = { project_id: "p1", sprint_number: 5 };
      const settings = { git: { defaultBranch: "main" } } as any;

      const context = service.resolveContext(args, settings);
      expect(context.sprint).toBe(mockSprint);
      expect(context.sprintNumber).toBe(5);
    });

    it("should throw error if sprint not found by id", () => {
      const mockProject = { id: "p1", name: "P1", baseDir: "/tmp" };
      vi.mocked(mockProjectManagementRepository.getProject).mockReturnValue(mockProject);
      vi.mocked(mockProjectManagementRepository.getSprint).mockReturnValue(undefined);

      const args = { project_id: "p1", sprint_id: "s2" };
      const settings = {} as any;
      expect(() => service.resolveContext(args, settings)).toThrow("Sprint not found: s2");
    });

    it("should throw error if sprint belongs to another project", () => {
      const mockProject = { id: "p1", name: "P1", baseDir: "/tmp" };
      const mockSprint = { id: "s1", number: 1, projectId: "p2" };
      vi.mocked(mockProjectManagementRepository.getProject).mockReturnValue(mockProject);
      vi.mocked(mockProjectManagementRepository.getSprint).mockReturnValue(mockSprint);

      const args = { project_id: "p1", sprint_id: "s1" };
      const settings = {} as any;
      expect(() => service.resolveContext(args, settings)).toThrow("does not belong to project p1");
    });

    it("should throw error if sprint has no number", () => {
      const mockProject = { id: "p1", name: "P1", baseDir: "/tmp" };
      const mockSprint = { id: "s1", number: null, projectId: "p1" };
      vi.mocked(mockProjectManagementRepository.getProject).mockReturnValue(mockProject);
      vi.mocked(mockProjectManagementRepository.getSprint).mockReturnValue(mockSprint);

      const args = { project_id: "p1", sprint_id: "s1" };
      const settings = {} as any;
      expect(() => service.resolveContext(args, settings)).toThrow("has no number configured");
    });

    it("should throw error if sprint number not found", () => {
       const mockProject = { id: "p1", name: "P1", baseDir: "/tmp" };
      vi.mocked(mockProjectManagementRepository.getProject).mockReturnValue(mockProject);
      vi.mocked(mockProjectManagementRepository.findSprintByProjectAndNumber).mockReturnValue(undefined);

      const args = { project_id: "p1", sprint_number: 10 };
      const settings = {} as any;
      expect(() => service.resolveContext(args, settings)).toThrow("was not found for project P1");
    });

    it("should throw error if no sprint number or id provided", () => {
      const mockProject = { id: "p1", name: "P1", baseDir: "/tmp" };
      vi.mocked(mockProjectManagementRepository.getProject).mockReturnValue(mockProject);

      const args = { project_id: "p1" };
      const settings = {} as any;
      expect(() => service.resolveContext(args, settings)).toThrow("No sprint scope could be resolved");
    });
  });

  describe("loadSubtasks", () => {
    it("should map task status correctly", async () => {
      const mockTasks = [
        { id: "t1", projectId: "p1", sprintId: "s1", taskKey: "TSK-1", status: "coding_completed", dependsOnTaskIds: [] },
        { id: "t2", projectId: "p1", sprintId: "s1", taskKey: "TSK-2", status: "completed", dependsOnTaskIds: [] },
        { id: "t3", projectId: "p1", sprintId: "s1", taskKey: "TSK-3", status: "in_progress", dependsOnTaskIds: [] },
        { id: "t4", projectId: "p1", sprintId: "s1", taskKey: "TSK-4", status: "pending", dependsOnTaskIds: [] },
        { id: "t5", projectId: "p1", sprintId: "s1", taskKey: "TSK-5", status: "other", dependsOnTaskIds: [] },
      ];
      vi.mocked(mockProjectManagementRepository.listTasks).mockReturnValue(mockTasks as any);
      
      const mockRuns = new Map([
        ["t3", { state: "COMPLETED" }], // Should proceed to switch and return RUNNING
        ["t4", { state: "FAILED" }],
      ]);
      vi.mocked(mockExecutionRepository.listLatestTaskRuns).mockReturnValue(mockRuns as any);

      const subtasks = await service.loadSubtasks("p1", "s1");

      expect(subtasks.find(s => s.record_id === "t1")?.status).toBe("CODING_COMPLETED");
      expect(subtasks.find(s => s.record_id === "t2")?.status).toBe("COMPLETED");
      expect(subtasks.find(s => s.record_id === "t3")?.status).toBe("RUNNING");
      expect(subtasks.find(s => s.record_id === "t4")?.status).toBe("FAILED");
      expect(subtasks.find(s => s.record_id === "t5")?.status).toBe("PENDING");
    });

    it("should handle all merge indicators", async () => {
       const indicators = ["CI", "AUTOMERGE", "MERGED", "MERGE_BLOCKED", "MERGE_CONFLICT"];
       const mockTasks = indicators.map((ind, i) => ({
         id: `t${i}`, projectId: "p1", sprintId: "s1", taskKey: `TSK-${i}`, mergeIndicator: ind, dependsOnTaskIds: []
       }));
       
      vi.mocked(mockProjectManagementRepository.listTasks).mockReturnValue(mockTasks as any);
      vi.mocked(mockExecutionRepository.listLatestTaskRuns).mockReturnValue(new Map());

      const subtasks = await service.loadSubtasks("p1", "s1");
      indicators.forEach((ind, i) => {
        expect(subtasks[i].merge_indicator).toBe(ind);
      });

      // Invalid indicator
      vi.mocked(mockProjectManagementRepository.listTasks).mockReturnValue([{ id: "t", mergeIndicator: "INVALID", dependsOnTaskIds: [] }] as any);
      const subtasks2 = await service.loadSubtasks("p1", "s1");
      expect(subtasks2[0].merge_indicator).toBeUndefined();
    });

    it("should map dependency keys correctly", async () => {
      const mockTasks = [
        { id: "t1", taskKey: "TSK-1", dependsOnTaskIds: ["t2"] },
        { id: "t2", taskKey: "TSK-2", dependsOnTaskIds: [] },
      ];
      vi.mocked(mockProjectManagementRepository.listTasks).mockReturnValue(mockTasks as any);
      vi.mocked(mockExecutionRepository.listLatestTaskRuns).mockReturnValue(new Map());

      const subtasks = await service.loadSubtasks("p1", "s1");
      expect(subtasks.find(s => s.record_id === "t1")?.depends_on).toEqual(["TSK-2"]);
    });
  });

  describe("hasPlannedTasks", () => {
    it("should return true if tasks exist", () => {
      vi.mocked(mockProjectManagementRepository.listTasks).mockReturnValue([{} as any]);
      expect(service.hasPlannedTasks("p1", "s1")).toBe(true);
    });

    it("should return false if no tasks exist", () => {
      vi.mocked(mockProjectManagementRepository.listTasks).mockReturnValue([]);
      expect(service.hasPlannedTasks("p1", "s1")).toBe(false);
    });
  });
});
