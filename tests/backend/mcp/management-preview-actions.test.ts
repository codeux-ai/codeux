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

  it("should list_sessions", async () => {
    mockSprintPreviewService.listSessions.mockResolvedValueOnce([{ id: "s1" }] as any);
    const result = await previewActions.handlePreviewAction(
      { domain: "preview", action: "list_sessions", payload: { projectId: "proj-1" } },
      null
    );
    expect(mockSprintPreviewService.listSessions).toHaveBeenCalledWith("proj-1");
    expect((result.result as any).data).toEqual([{ id: "s1" }]);
  });

  it("should rebuild_session", async () => {
    const result = await previewActions.handlePreviewAction(
      { domain: "preview", action: "rebuild_session", payload: { sessionId: "sess-1" } },
      null
    );
    expect(mockSprintPreviewService.rebuildSession).toHaveBeenCalledWith("sess-1");
    expect((result.result as any).status).toBe("success");
  });

  it("should stop_session", async () => {
    const result = await previewActions.handlePreviewAction(
      { domain: "preview", action: "stop_session", payload: { sessionId: "sess-1" } },
      null
    );
    expect(mockSprintPreviewService.stopSession).toHaveBeenCalledWith("sess-1");
    expect((result.result as any).status).toBe("success");
  });

  it("should get_script", async () => {
    mockSprintPreviewService.getScript.mockResolvedValueOnce({ content: "echo hi" } as any);
    const result = await previewActions.handlePreviewAction(
      { domain: "preview", action: "get_script", payload: { projectId: "p", sprintId: "s" } },
      null
    );
    expect(mockSprintPreviewService.getScript).toHaveBeenCalledWith("p", "s");
    expect((result.result as any).data.content).toBe("echo hi");
  });

  it("should get_logs", async () => {
    mockSprintPreviewService.getLogs.mockResolvedValueOnce("log output" as any);
    const result = await previewActions.handlePreviewAction(
      { domain: "preview", action: "get_logs", payload: { sessionId: "sess-1" } },
      null
    );
    expect(mockSprintPreviewService.getLogs).toHaveBeenCalledWith("sess-1");
    expect((result.result as any).data).toBe("log output");
  });

  it("defaults the get_url path to '/' when not provided", async () => {
    const result = await previewActions.handlePreviewAction(
      { domain: "preview", action: "get_url", payload: { sessionId: "sess-123" } },
      "test.host"
    );
    expect((result.result as any).data.url).toBe("https://preview-sess-123.test.host/");
  });

  it.each([
    ["list_sessions", {}, /Missing required 'projectId' for list_sessions/],
    ["start_session", { projectId: "p" }, /Missing required 'projectId' or 'sprintId' for start_session/],
    ["rebuild_session", {}, /Missing required 'sessionId' for rebuild_session/],
    ["stop_session", {}, /Missing required 'sessionId' for stop_session/],
    ["remove_session", {}, /Missing required 'sessionId' for remove_session/],
    ["get_script", { projectId: "p" }, /Missing required 'projectId' or 'sprintId' for get_script/],
    ["update_script", { projectId: "p", sprintId: "s" }, /Missing required 'projectId', 'sprintId', or 'content'/],
    ["get_logs", {}, /Missing required 'sessionId' for get_logs/],
    ["get_url", {}, /Missing required 'sessionId' for get_url/],
  ])("wraps validation failures for %s", async (action, payload, matcher) => {
    await expect(
      previewActions.handlePreviewAction({ domain: "preview", action, payload } as any, null),
    ).rejects.toThrow(matcher);
  });

  it("throws for an unknown preview action", async () => {
    await expect(
      previewActions.handlePreviewAction({ domain: "preview", action: "nope", payload: {} } as any, null),
    ).rejects.toThrow(/Preview action 'nope' failed: Unknown preview action: nope/);
  });
});
