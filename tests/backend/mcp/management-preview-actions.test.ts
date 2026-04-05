import { describe, it, expect, vi, beforeEach } from "vitest";
import { handlePreviewActions } from "../../../src/mcp/management/preview-actions.js";
import type { SprintPreviewService } from "../../../src/services/sprint-preview-service.js";

describe("management-preview-actions", () => {
  let mockSprintPreviewService: vi.Mocked<SprintPreviewService>;

  beforeEach(() => {
    mockSprintPreviewService = {
      listSessions: vi.fn(),
      startSession: vi.fn(),
      rebuildSession: vi.fn(),
      stopSession: vi.fn(),
      removeSession: vi.fn(),
      getScript: vi.fn(),
      getLogs: vi.fn(),
    } as unknown as vi.Mocked<SprintPreviewService>;
  });

  it("should get_url", async () => {
    const result = await handlePreviewActions(
      { domain: "preview", action: "get_url", payload: { sessionId: "sess-123", path: "/test" } },
      mockSprintPreviewService,
      "test.host"
    );
    expect(result.result).toBeDefined();
    expect((result.result as any).data.url).toBe("https://preview-sess-123.test.host/test");
  });

  it("should start_session", async () => {
    mockSprintPreviewService.startSession.mockResolvedValueOnce({ id: "sess-123" } as any);
    const result = await handlePreviewActions(
      { domain: "preview", action: "start_session", payload: { projectId: "proj-1", sprintId: "sprint-1" } },
      mockSprintPreviewService,
      null
    );
    expect(mockSprintPreviewService.startSession).toHaveBeenCalledWith("proj-1", "sprint-1");
    expect(result.result).toBeDefined();
    expect((result.result as any).data.id).toBe("sess-123");
  });

  it("should block remove_session without approval", async () => {
    const result = await handlePreviewActions(
      { domain: "preview", action: "remove_session", payload: { sessionId: "sess-123" } },
      mockSprintPreviewService,
      null
    );
    expect(result.approvalRequired).toBe(true);
    expect(mockSprintPreviewService.removeSession).not.toHaveBeenCalled();
  });

  it("should allow remove_session with approval", async () => {
    const result = await handlePreviewActions(
      { domain: "preview", action: "remove_session", payload: { sessionId: "sess-123" }, approval: { confirmed: true } },
      mockSprintPreviewService,
      null
    );
    expect(result.approvalRequired).toBeUndefined();
    expect(mockSprintPreviewService.removeSession).toHaveBeenCalledWith("sess-123");
  });
});
