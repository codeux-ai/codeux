import { describe, expect, it, vi, beforeEach } from "vitest";
import { fetchJson } from "../../../lib/api/fetch-json.js";
import { cancelExecutionInvocation } from "../invocation-api.js";

vi.mock("../../../lib/api/fetch-json.js", () => ({
  fetchJson: vi.fn(),
}));

describe("invocation-api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts to the invocation cancel endpoint", async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce({
      cancelled: true,
      invocationId: "inv-1",
      stoppedContainerIds: ["container-1"],
    });

    const result = await cancelExecutionInvocation("inv-1");

    expect(result).toEqual({
      cancelled: true,
      invocationId: "inv-1",
      stoppedContainerIds: ["container-1"],
    });
    expect(fetchJson).toHaveBeenCalledWith(
      "/api/execution/invocations/inv-1/cancel",
      { method: "POST" },
    );
  });
});
