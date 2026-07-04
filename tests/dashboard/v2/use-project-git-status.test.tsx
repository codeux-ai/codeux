/** @vitest-environment happy-dom */
import { renderHook } from "@testing-library/preact";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectGitStatus } from "../../../dashboard/src/v2/hooks/use-project-git-status.js";
import { useRealtimeResource } from "../../../dashboard/src/hooks/use-realtime-resource.js";

vi.mock("../../../dashboard/src/hooks/use-realtime-resource.js", () => ({
  useRealtimeResource: vi.fn(() => ({
    data: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  })),
}));

describe("useProjectGitStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("subscribes to the dedicated git realtime sub-scope", () => {
    renderHook(() => useProjectGitStatus("project-1", true));

    expect(useRealtimeResource).toHaveBeenCalledWith(expect.objectContaining({
      realtime: expect.objectContaining({
        scopes: ["project:project-1:git"],
        eventType: "project.git.updated",
        updateDirectlyFromEvent: true,
      }),
    }));
  });
});
