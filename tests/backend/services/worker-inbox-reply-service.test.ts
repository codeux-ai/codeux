import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkerInboxReplyService } from "../../../src/services/worker-inbox-reply-service.js";

vi.mock("../../../src/services/cli-process-runner.js", () => ({
  runCommandStrict: vi.fn(),
}));

import { runCommandStrict } from "../../../src/services/cli-process-runner.js";

describe("WorkerInboxReplyService", () => {
  const settings = {
    aiProvider: {
      providers: {
        jules: { enabled: true, model: "default", weight: 0, thinkingMode: "MEDIUM", apiKey: "" },
        gemini: { enabled: true, model: "gemini-2.5-pro", weight: 10, thinkingMode: "SMALL", apiKey: "g-key" },
        codex: { enabled: true, model: "gpt-5.3-codex", weight: 10, thinkingMode: "HIGH", apiKey: "o-key" },
        "claude-code": { enabled: false, model: "default", weight: 0, thinkingMode: "MEDIUM", apiKey: "" },
      },
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates a markdown reply with listener guide context", async () => {
    vi.mocked(runCommandStrict).mockResolvedValue({
      ok: true,
      code: 0,
      stdout: "Current status: one task is running.",
      stderr: "",
    });

    const service = new WorkerInboxReplyService({
      projectManagementRepository: {
        getProject: vi.fn().mockReturnValue({
          id: "project-1",
          name: "Sprint OS",
          baseDir: "/repo",
        }),
      } as any,
      taskService: {
        selectCliProviderForTask: vi.fn().mockReturnValue("gemini"),
      } as any,
      getDashboardSettings: () => settings,
      getGuideContent: vi.fn().mockResolvedValue("Always answer with operational clarity."),
      getGithubToken: () => "gh-token",
    });

    const result = await service.generateReply({
      projectId: "project-1",
      threadId: "thread-1",
      threadTitle: "Status",
      bodyMarkdown: "What is the current worker status?",
    });

    expect(result.bodyMarkdown).toBe("Current status: one task is running.");
    expect(result.provider).toBe("gemini");
    expect(runCommandStrict).toHaveBeenCalledWith(
      "gemini",
      expect.arrayContaining(["--yolo", "--p", expect.stringContaining("What is the current worker status?")]),
      "/repo",
      expect.objectContaining({
        GEMINI_API_KEY: "g-key",
        GEMINI_MODEL: "gemini-2.5-pro",
        GITHUB_TOKEN: "gh-token",
      }),
    );
  });

  it("falls back from missing listener guide to worker guide", async () => {
    vi.mocked(runCommandStrict).mockResolvedValue({
      ok: true,
      code: 0,
      stdout: "Use the worker queue view in Live.",
      stderr: "",
    });

    const getGuideContent = vi.fn()
      .mockRejectedValueOnce(new Error("Guide not found"))
      .mockResolvedValueOnce("Worker guide fallback");

    const service = new WorkerInboxReplyService({
      projectManagementRepository: {
        getProject: vi.fn().mockReturnValue({
          id: "project-1",
          name: "Sprint OS",
          baseDir: "/repo",
        }),
      } as any,
      taskService: {
        selectCliProviderForTask: vi.fn().mockReturnValue("gemini"),
      } as any,
      getDashboardSettings: () => settings,
      getGuideContent,
      getGithubToken: () => undefined,
    });

    const result = await service.generateReply({
      projectId: "project-1",
      threadId: "thread-1",
      bodyMarkdown: "How do I inspect the queue?",
    });

    expect(result.bodyMarkdown).toContain("worker queue");
    expect(getGuideContent).toHaveBeenNthCalledWith(1, "listener.md", "/repo");
    expect(getGuideContent).toHaveBeenNthCalledWith(2, "worker.md", "/repo");
  });
});
