/** @vitest-environment happy-dom */
import { renderHook } from "@testing-library/preact";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRealtimeResource } from "../../../dashboard/src/hooks/use-realtime-resource.js";
import {
  shouldRefreshProjectInitializationState,
  useProjectInitializationState,
} from "../../../dashboard/src/v2/hooks/use-project-initialization-state.js";

vi.mock("../../../dashboard/src/hooks/use-realtime-resource.js", () => ({
  useRealtimeResource: vi.fn(() => ({
    data: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  })),
}));

describe("useProjectInitializationState", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refreshes on project and git realtime changes", () => {
    renderHook(() => useProjectInitializationState("project-1"));

    expect(useRealtimeResource).toHaveBeenCalledWith(expect.objectContaining({
      realtime: expect.objectContaining({
        scopes: ["project:project-1", "project:project-1:git"],
        shouldRefetch: shouldRefreshProjectInitializationState,
      }),
    }));
    expect(shouldRefreshProjectInitializationState({ type: "snapshot_required", reason: "gap" })).toBe(true);
    expect(shouldRefreshProjectInitializationState({
      type: "event",
      event: { eventType: "project.git.updated" },
    } as never)).toBe(true);
    expect(shouldRefreshProjectInitializationState({
      type: "event",
      event: { eventType: "conversation.message.created" },
    } as never)).toBe(false);
  });

  it("masks stale eligible data when the current request fails", () => {
    vi.mocked(useRealtimeResource).mockReturnValueOnce({
      data: {
        projectId: "project-1",
        initializationMode: "new-local",
        repositoryState: "initial",
        canCreateInitialAppQuickactions: true,
      },
      loading: false,
      error: "inspection failed",
      refetch: vi.fn(),
    } as never);

    const { result } = renderHook(() => useProjectInitializationState("project-1"));
    expect(result.current.data).toMatchObject({
      projectId: "project-1",
      repositoryState: "unavailable",
      canCreateInitialAppQuickactions: false,
    });
  });
});
