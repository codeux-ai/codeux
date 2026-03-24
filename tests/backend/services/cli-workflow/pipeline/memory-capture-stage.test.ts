import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseLearningsMarkdown, executeMemoryCaptureStage } from "../../../../../src/services/cli-workflow/pipeline/memory-capture-stage.js";
import type { PipelineContext } from "../../../../../src/services/cli-workflow/pipeline/pipeline-context.js";
import type { DashboardSettings } from "../../../../../src/contracts/app-types.js";

// Mock fs/promises
vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

import { readFile, unlink } from "fs/promises";

const mockReadFile = vi.mocked(readFile);
const mockUnlink = vi.mocked(unlink);

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
    createMemory: vi.fn().mockResolvedValue({ id: "mem-1" }),
  };

  const mockSessionTracking = {
    appendActivity: vi.fn(),
  };

  const mockExecutionRepository = {
    getTaskRun: vi.fn().mockReturnValue({
      id: "run-1",
      projectId: "proj-1",
      sprintId: "sprint-1",
    }),
  };

  function buildCtx(overrides?: Partial<{ memoryEnabled: boolean; autoCapture: boolean; taskRunId: string }>): PipelineContext {
    const memoryEnabled = overrides?.memoryEnabled ?? true;
    const autoCapture = overrides?.autoCapture ?? true;
    return {
      sessionId: "session-1",
      taskRunId: overrides?.taskRunId ?? "run-1",
      workerBranch: "worker/branch",
      featureBranch: "feature/branch",
      task: { id: "task-1", title: "Test task", prompt: "Do something" } as any,
      provider: "gemini",
      title: "Test",
      repoPath: "/repo",
      worktreePath: "/repo/.worktrees/test",
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
      prService: {} as any,
      providerRunner: {} as any,
      deps: {
        sessionTracking: mockSessionTracking as any,
        executionRepository: mockExecutionRepository as any,
        memoryService: mockMemoryService as any,
        getDashboardSettings: () => ({} as DashboardSettings),
        getWorkerInstruction: async () => "",
        getGithubToken: () => undefined,
      },
      runCommand: vi.fn() as any,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecutionRepository.getTaskRun.mockReturnValue({
      id: "run-1",
      projectId: "proj-1",
      sprintId: "sprint-1",
    });
  });

  it("returns 0 when memory is disabled", async () => {
    const ctx = buildCtx({ memoryEnabled: false });
    const result = await executeMemoryCaptureStage(ctx);
    expect(result.memoriesCaptured).toBe(0);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("returns 0 when autoCaptureSprint is off", async () => {
    const ctx = buildCtx({ autoCapture: false });
    const result = await executeMemoryCaptureStage(ctx);
    expect(result.memoriesCaptured).toBe(0);
  });

  it("returns 0 when learnings file does not exist", async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    const ctx = buildCtx();
    const result = await executeMemoryCaptureStage(ctx);
    expect(result.memoriesCaptured).toBe(0);
  });

  it("parses learnings file and creates memories", async () => {
    mockReadFile.mockResolvedValue(`## Category: architecture
- Uses constructor-based DI
- SQLite for persistence

## Category: error
- Build failed on first try due to missing import
` as any);

    const ctx = buildCtx();
    const result = await executeMemoryCaptureStage(ctx);
    expect(result.memoriesCaptured).toBe(3);
    expect(mockMemoryService.createMemory).toHaveBeenCalledTimes(3);

    const firstCall = mockMemoryService.createMemory.mock.calls[0];
    expect(firstCall[0]).toBe("proj-1");
    expect(firstCall[1].scope).toBe("sprint");
    expect(firstCall[1].sprintId).toBe("sprint-1");
    expect(firstCall[1].category).toBe("architecture");
    expect(firstCall[1].content).toBe("Uses constructor-based DI");
    expect(firstCall[1].strength).toBe(0.6);
    expect(firstCall[1].source.type).toBe("auto_capture");
    expect(firstCall[1].source.originType).toBe("worker_learnings_file");
  });

  it("deletes the learnings file after reading", async () => {
    mockReadFile.mockResolvedValue(`## Category: learning
- Something learned
` as any);
    const ctx = buildCtx();
    await executeMemoryCaptureStage(ctx);
    expect(mockUnlink).toHaveBeenCalled();
  });

  it("logs activity about captured memories", async () => {
    mockReadFile.mockResolvedValue(`## Category: codebase
- ESM throughout with .js extensions
` as any);
    const ctx = buildCtx();
    await executeMemoryCaptureStage(ctx);
    expect(mockSessionTracking.appendActivity).toHaveBeenCalledWith("session-1", {
      originator: "system",
      description: "Captured 1 learnings from .task-learnings.md.",
    });
  });

  it("passes agentPresetId from pipeline context to createMemory", async () => {
    mockReadFile.mockResolvedValue(`## Category: learning
- Worker learned something
` as any);
    const ctx = buildCtx();
    ctx.agentPresetId = "worker-agent-preset-123";
    const result = await executeMemoryCaptureStage(ctx);
    expect(result.memoriesCaptured).toBe(1);
    const call = mockMemoryService.createMemory.mock.calls[0];
    expect(call[1].agentPresetId).toBe("worker-agent-preset-123");
  });

  it("sets agentPresetId to null when not provided on context", async () => {
    mockReadFile.mockResolvedValue(`## Category: learning
- Worker learned something
` as any);
    const ctx = buildCtx();
    // agentPresetId is undefined by default
    const result = await executeMemoryCaptureStage(ctx);
    expect(result.memoriesCaptured).toBe(1);
    const call = mockMemoryService.createMemory.mock.calls[0];
    expect(call[1].agentPresetId).toBeNull();
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
});
