import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskService } from "./task-service.js";

describe("TaskService", () => {
  const createSession = vi.fn();
  const getGuideContent = vi.fn();

  const service = new TaskService({
    julesApi: { createSession } as any,
    guideRepository: { getGuideContent } as any,
    normalizeSourceName: (sourceId: string) => `sources/${sourceId}`,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates task_agent session with worker guide injected", async () => {
    getGuideContent.mockResolvedValue("## Worker Rules");
    createSession.mockResolvedValue({ id: "s1" });

    await service.createTaskAgentSession({
      prompt: "Implement feature X",
      source_id: "123",
      repo_path: "/tmp/repo",
      title: "Task Title",
      branch: "feature/branch",
    });

    expect(getGuideContent).toHaveBeenCalledWith("worker.md", "/tmp/repo");
    expect(createSession).toHaveBeenCalledTimes(1);
    const payload = createSession.mock.calls[0][0];
    expect(payload.prompt).toContain("## Worker Rules");
    expect(payload.prompt).toContain("Implement feature X");
    expect(payload.sourceContext.source).toBe("sources/123");
    expect(payload.sourceContext.githubRepoContext.startingBranch).toBe("feature/branch");
    expect(payload.title).toBe("Task Title");
    expect(payload.automationMode).toBe("AUTO_CREATE_PR");
  });

  it("falls back to raw prompt when worker guide is missing", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    getGuideContent.mockRejectedValue(new Error("missing"));
    createSession.mockResolvedValue({ id: "s2" });

    await service.createTaskAgentSession({
      prompt: "Raw prompt only",
      source_id: "321",
      repo_path: "/tmp/repo",
    });

    const payload = createSession.mock.calls[0][0];
    expect(payload.prompt).toBe("Raw prompt only");
    expect(consoleSpy).toHaveBeenCalledWith("Warning: worker.md guide not found for task_agent.");
    consoleSpy.mockRestore();
  });

  it("creates sprint task session payload with sprint metadata", async () => {
    getGuideContent.mockResolvedValue("Rules");
    createSession.mockResolvedValue({ id: "s3" });

    await service.startSprintTask(
      {
        id: "01-task",
        title: "Do Thing",
        prompt: "Implement",
        depends_on: [],
        is_independent: true,
      },
      "999",
      "feature/sprint1",
      "/tmp/repo",
      1
    );

    const payload = createSession.mock.calls[0][0];
    expect(payload.title).toBe("Sprint 1: [01-task] Do Thing");
    expect(payload.sourceContext.source).toBe("sources/999");
    expect(payload.sourceContext.githubRepoContext.startingBranch).toBe("feature/sprint1");
    expect(payload.prompt).toContain("SUBTASK TO EXECUTE");
  });
});
