import { describe, it, expect, vi, beforeEach } from "vitest";
import { PreviewActions } from "../../../src/mcp/management/preview-actions.js";
import type { SprintPreviewService } from "../../../src/services/sprint-preview-service.js";

describe("management-preview-actions", () => {
  let mockSprintPreviewService: vi.Mocked<SprintPreviewService>;
  let previewActions: PreviewActions;

  beforeEach(() => {
    mockSprintPreviewService = {
      listSessions: vi.fn(),
      startSession: vi.fn(),
      rebuildSession: vi.fn(),
      stopSession: vi.fn(),
      removeSession: vi.fn(),
      getScript: vi.fn(),
      getLogs: vi.fn(),
      saveScript: vi.fn(),
    } as unknown as vi.Mocked<SprintPreviewService>;
    previewActions = new PreviewActions(mockSprintPreviewService);
  });

  it("should get_url", async () => {
    const result = await previewActions.handlePreviewAction(
      { domain: "preview", action: "get_url", payload: { sessionId: "sess-123", path: "/test" } },
      "test.host"
    );
    expect(result.result).toBeDefined();
    expect((result.result as any).data.url).toBe("https://preview-sess-123.test.host/test");
  });

  it("should start_session", async () => {
    mockSprintPreviewService.startSession.mockResolvedValueOnce({ id: "sess-123" } as any);
    const result = await previewActions.handlePreviewAction(
      { domain: "preview", action: "start_session", payload: { projectId: "proj-1", sprintId: "sprint-1" } },
      null
    );
    expect(mockSprintPreviewService.startSession).toHaveBeenCalledWith("proj-1", "sprint-1");
    expect(result.result).toBeDefined();
    expect((result.result as any).data.id).toBe("sess-123");
  });

  it("should block remove_session without approval", async () => {
    const result = await previewActions.handlePreviewAction(
      { domain: "preview", action: "remove_session", payload: { sessionId: "sess-123" } },
      null
    );
    expect(result.approvalRequired).toBe(true);
    expect(mockSprintPreviewService.removeSession).not.toHaveBeenCalled();
  });

  it("should allow remove_session with approval", async () => {
    const result = await previewActions.handlePreviewAction(
      { domain: "preview", action: "remove_session", payload: { sessionId: "sess-123" }, approval: { confirmed: true } },
      null
    );
    expect(result.approvalRequired).toBeUndefined();
    expect(mockSprintPreviewService.removeSession).toHaveBeenCalledWith("sess-123");
  });

  it("should update_script", async () => {
    mockSprintPreviewService.saveScript.mockResolvedValueOnce({ content: "new script content" } as any);
    const result = await previewActions.handlePreviewAction(
      { domain: "preview", action: "update_script", payload: { projectId: "proj-1", sprintId: "sprint-1", content: "new script content" } },
      null
    );
    expect(mockSprintPreviewService.saveScript).toHaveBeenCalledWith("proj-1", "sprint-1", "new script content");
    expect(result.result).toBeDefined();
    expect((result.result as any).data.content).toBe("new script content");
  });
});
