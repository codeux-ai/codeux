import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import { SprintRepository } from "../../../../src/infrastructure/repositories/sprint-repository.js";
import { getSprintSubtasksDir } from "../../../../src/shared/config/sprint-os-paths.js";
import { SubtaskParser } from "../../../../src/infrastructure/repositories/subtask-parser.js";

vi.mock("fs/promises");
vi.mock("../../../../src/shared/config/sprint-os-paths.js", () => ({
  getSprintSubtasksDir: vi.fn(),
}));
vi.mock("../../../../src/infrastructure/repositories/subtask-parser.js", () => ({
  SubtaskParser: {
    stringify: vi.fn(),
  },
}));

describe("SprintRepository", () => {
  let sprintRepository: SprintRepository;

  beforeEach(() => {
    sprintRepository = new SprintRepository();
    vi.resetAllMocks();
  });

  describe("writeSingleTaskSprint", () => {
    it("should create the expected directory structure and T01.md file content", async () => {
      const mockRepoPath = "/mock/repo";
      const mockSprintNumber = 42;
      const mockTaskTitle = "Complete sprint goal";
      const mockInstructions = "These are the sprint instructions.";
      const mockSubtasksDir = "/mock/repo/.sprint-os/sprints/sprint42-subtasks";
      const mockStringifiedContent = "mock markdown content";

      vi.mocked(getSprintSubtasksDir).mockReturnValue(mockSubtasksDir);
      vi.mocked(SubtaskParser.stringify).mockReturnValue(mockStringifiedContent);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await sprintRepository.writeSingleTaskSprint(
        mockRepoPath,
        mockSprintNumber,
        mockTaskTitle,
        mockInstructions
      );

      // Verify directory structure creation
      expect(getSprintSubtasksDir).toHaveBeenCalledWith(mockRepoPath, mockSprintNumber);
      expect(fs.mkdir).toHaveBeenCalledWith(mockSubtasksDir, { recursive: true });

      // Verify task parsing
      expect(SubtaskParser.stringify).toHaveBeenCalledWith({
        id: "T01",
        title: mockTaskTitle,
        prompt: mockInstructions,
        depends_on: [],
        is_independent: true,
        is_merged: false,
        status: "PENDING",
      });

      // Verify T01.md file content creation
      const expectedFilePath = path.join(mockSubtasksDir, "T01.md");
      expect(fs.writeFile).toHaveBeenCalledWith(expectedFilePath, mockStringifiedContent, "utf-8");
    });
  });
});
