import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as os from "os";
import * as path from "path";
import {
  executeMemoryCaptureStage,
  parseSelfReflectionRatingMarkdown,
} from "../../../../../src/services/cli-workflow/pipeline/memory-capture-stage.js";
import { parseLearningsMarkdown } from "../../../../../src/services/memory-service.js";
import { LEARNINGS_FILENAME } from "../../../../../src/contracts/memory-types.js";
import type { PipelineContext } from "../../../../../src/services/cli-workflow/pipeline/pipeline-context.js";
import type { DashboardSettings } from "../../../../../src/contracts/app-types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("parseLearningsMarkdown", () => {
  it("parses multiple categories with bullet points", () => {
    const markdown = `## Category: architecture
- The system uses event-driven patterns for async workflows
- Database is SQLite with sync access

## Category: decision
- Chose fire-and-forget over blocking for memory capture
`;
    const entries = parseLearningsMarkdown(markdown);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ category: "architecture", content: "The system uses event-driven patterns for async workflows" });
    expect(entries[1]).toEqual({ category: "architecture", content: "Database is SQLite with sync access" });
    expect(entries[2]).toEqual({ category: "decision", content: "Chose fire-and-forget over blocking for memory capture" });
  });

  it("defaults to learning category for unrecognized headers", () => {
    const markdown = `## Category: random_stuff
- Some observation
`;
    const entries = parseLearningsMarkdown(markdown);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.category).toBe("learning");
  });

  it("defaults to learning for bullets before any header", () => {
    const markdown = `- Standalone bullet without header
`;
    const entries = parseLearningsMarkdown(markdown);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.category).toBe("learning");
  });

  it("handles empty input", () => {
    expect(parseLearningsMarkdown("")).toHaveLength(0);
    expect(parseLearningsMarkdown("\n\n")).toHaveLength(0);
  });

  it("ignores empty bullets", () => {
    const markdown = `## Category: error
-
- Actual error found
-
`;
    const entries = parseLearningsMarkdown(markdown);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.content).toBe("Actual error found");
  });

  it("handles asterisk bullets", () => {
    const markdown = `## Category: patterns
* Uses factory pattern for DI
`;
    const entries = parseLearningsMarkdown(markdown);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.content).toBe("Uses factory pattern for DI");
  });
});

describe("executeMemoryCaptureStage", () => {
  const mockMemoryService = {
    captureMemoriesFromContent: vi.fn().mockResolvedValue(0),
    captureMemoriesFromWorktree: vi.fn().mockResolvedValue(0),
  };

  const mockSessionTracking = {
    appendActivity: vi.fn(),
  };

  const mockExecutionRepository = {
    getTaskRun: vi.fn().mockReturnValue({
      id: "run-1",
      projectId: "proj-1",
      sprintId: "sprint-1",
      taskId: "task-1",
    }),
  };

  const mockRatingRepository = {
    upsertForTaskRun: vi.fn(),
  };

  function createWorktree(markdown = "## Category: learning\n- Captured learning\n"): string {
    const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), "code-ux-memory-capture-stage-"));
    tempDirs.push(dir);
    fsSync.writeFileSync(path.join(dir, LEARNINGS_FILENAME), markdown, "utf-8");
    return dir;
  }

  function buildCtx(overrides?: Partial<{
    memoryEnabled: boolean;
    autoCapture: boolean;
    taskRunId: string;
    markdown: string;
  }>): PipelineContext {
    const memoryEnabled = overrides?.memoryEnabled ?? true;
    const autoCapture = overrides?.autoCapture ?? true;
    const worktreePath = createWorktree(overrides?.markdown);
    return {
      sessionId: "session-1",
      taskRunId: overrides?.taskRunId ?? "run-1",
      workerBranch: "worker/branch",
      featureBranch: "feature/branch",
      task: { id: "task-1", title: "Test task", prompt: "Do something" } as any,
      provider: "gemini",
      title: "Test",
      repoPath: "/repo",
      worktreePath,
      workflowSettings: {} as any,
      settings: {
        memory: {
          enabled: memoryEnabled,
          autoCaptureSprint: autoCapture,
          workerLearningsInstruction: "Write learnings",
        },
      } as DashboardSettings,
      initialHead: "abc123",
      workflowSucceeded: false,
      workspaceManager: {} as any,
      workspaceArtifactService: {} as any,
      prService: {} as any,
      providerRunner: {} as any,
      deps: {
        sessionTracking: mockSessionTracking as any,
        executionRepository: mockExecutionRepository as any,
        memoryService: mockMemoryService as any,
        taskSelfReflectionRatingRepository: mockRatingRepository as any,
        getDashboardSettings: () => ({} as DashboardSettings),
        getWorkerInstruction: async () => "",
        getGithubToken: () => undefined,
      },
      runCommand: vi.fn() as any,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockMemoryService.captureMemoriesFromContent.mockResolvedValue(0);
    mockMemoryService.captureMemoriesFromWorktree.mockResolvedValue(0);
    mockRatingRepository.upsertForTaskRun.mockReset();
    mockExecutionRepository.getTaskRun.mockReturnValue({
      id: "run-1",
      projectId: "proj-1",
      sprintId: "sprint-1",
      taskId: "task-1",
    });
  });

  it("returns 0 when memory is disabled", async () => {
    const ctx = buildCtx({ memoryEnabled: false });
    const result = await executeMemoryCaptureStage(ctx);
    expect(result.memoriesCaptured).toBe(0);
    expect(mockMemoryService.captureMemoriesFromContent).not.toHaveBeenCalled();
  });

  it("returns 0 when autoCaptureSprint is off", async () => {
    const ctx = buildCtx({ autoCapture: false });
    const result = await executeMemoryCaptureStage(ctx);
    expect(result.memoriesCaptured).toBe(0);
    expect(mockMemoryService.captureMemoriesFromContent).not.toHaveBeenCalled();
  });

  it("calls memoryService.captureMemoriesFromContent and passes params", async () => {
    mockMemoryService.captureMemoriesFromContent.mockResolvedValue(3);
    const ctx = buildCtx();
    const result = await executeMemoryCaptureStage(ctx);
    expect(result.memoriesCaptured).toBe(3);
    expect(mockMemoryService.captureMemoriesFromContent).toHaveBeenCalledWith(
      "proj-1",
      "sprint-1",
      null,
      "## Category: learning\n- Captured learning\n",
      "run-1"
    );
  });

  it("logs activity about captured memories", async () => {
    mockMemoryService.captureMemoriesFromContent.mockResolvedValue(1);
    const ctx = buildCtx();
    await executeMemoryCaptureStage(ctx);
    expect(mockSessionTracking.appendActivity).toHaveBeenCalledWith("session-1", {
      originator: "system",
      description: "Captured 1 learnings from .task-learnings.md.",
    });
  });

  it("does not log activity when no memories are captured", async () => {
    mockMemoryService.captureMemoriesFromContent.mockResolvedValue(0);
    const ctx = buildCtx();
    await executeMemoryCaptureStage(ctx);
    expect(mockSessionTracking.appendActivity).not.toHaveBeenCalled();
  });

  it("passes agentPresetId from pipeline context to captureMemoriesFromContent", async () => {
    mockMemoryService.captureMemoriesFromContent.mockResolvedValue(1);
    const ctx = buildCtx();
    ctx.agentPresetId = "worker-agent-preset-123";
    const result = await executeMemoryCaptureStage(ctx);
    expect(result.memoriesCaptured).toBe(1);
    expect(mockMemoryService.captureMemoriesFromContent).toHaveBeenCalledWith(
      "proj-1",
      "sprint-1",
      "worker-agent-preset-123",
      "## Category: learning\n- Captured learning\n",
      "run-1"
    );
  });

  it("returns 0 when no memoryService is available", async () => {
    const ctx = buildCtx();
    ctx.deps.memoryService = undefined;
    const result = await executeMemoryCaptureStage(ctx);
    expect(result.memoriesCaptured).toBe(0);
  });

  it("returns 0 when taskRunId is missing", async () => {
    const ctx = buildCtx({ taskRunId: undefined });
    (ctx as any).taskRunId = undefined;
    const result = await executeMemoryCaptureStage(ctx);
    expect(result.memoriesCaptured).toBe(0);
  });

  it("captures self-reflection ratings separately from learning bullets", async () => {
    mockMemoryService.captureMemoriesFromContent.mockResolvedValue(1);
    const ctx = buildCtx({
      markdown: [
        "## Category: patterns",
        "- Keep parser behavior focused.",
        "",
        "## Self Reflection Rating",
        "Overall: 4/5",
        "- Implementation: 5/5 - clean path",
        "- Tests: 3/5 - focused coverage",
      ].join("\n"),
    });

    const result = await executeMemoryCaptureStage(ctx);

    expect(result.memoriesCaptured).toBe(1);
    expect(mockMemoryService.captureMemoriesFromContent).toHaveBeenCalledWith(
      "proj-1",
      "sprint-1",
      null,
      "## Category: patterns\n- Keep parser behavior focused.\n",
      "run-1",
    );
    expect(mockRatingRepository.upsertForTaskRun).toHaveBeenCalledWith({
      projectId: "proj-1",
      sprintId: "sprint-1",
      taskId: "task-1",
      sourceTaskRunId: "run-1",
      overallRating: 4,
      sections: [
        { label: "Implementation", normalizedLabel: "implementation", rating: 5, note: "clean path" },
        { label: "Tests", normalizedLabel: "tests", rating: 3, note: "focused coverage" },
      ],
    });
  });

  it("ignores malformed self-reflection ratings without failing memory capture", async () => {
    mockMemoryService.captureMemoriesFromContent.mockResolvedValue(1);
    mockRatingRepository.upsertForTaskRun.mockImplementation(() => {
      throw new Error("should not be called");
    });
    const ctx = buildCtx({
      markdown: [
        "## Category: codebase",
        "- Existing learning remains valid.",
        "",
        "## Self Reflection Rating",
        "Overall: excellent",
        "- Implementation: no score",
      ].join("\n"),
    });

    await expect(executeMemoryCaptureStage(ctx)).resolves.toEqual({ memoriesCaptured: 1 });
    expect(mockRatingRepository.upsertForTaskRun).not.toHaveBeenCalled();
  });
});

describe("parseSelfReflectionRatingMarkdown", () => {
  it("parses overall and per-section ratings", () => {
    expect(parseSelfReflectionRatingMarkdown([
      "Overall: 4/5",
      "- Implementation: 5/5 - complete",
      "* Integration Fit: 3.5/5 - needs follow-up",
    ].join("\n"))).toEqual({
      overallRating: 4,
      sections: [
        { label: "Implementation", normalizedLabel: "implementation", rating: 5, note: "complete" },
        { label: "Integration Fit", normalizedLabel: "integration-fit", rating: 3.5, note: "needs follow-up" },
      ],
    });
  });

  it("clamps numeric ratings and rejects missing overall ratings", () => {
    expect(parseSelfReflectionRatingMarkdown("Overall: 9/5\n- Tests: -1/5")).toEqual({
      overallRating: 5,
      sections: [
        { label: "Tests", normalizedLabel: "tests", rating: 0, note: null },
      ],
    });
    expect(parseSelfReflectionRatingMarkdown("- Tests: 4/5")).toBeNull();
  });
});
