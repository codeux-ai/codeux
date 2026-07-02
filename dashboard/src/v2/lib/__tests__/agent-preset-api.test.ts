import { describe, expect, it, vi } from "vitest";
import { pushAgentPresetsToRepository } from "../agent-preset-api.js";
import { fetchJson } from "../../../lib/api/fetch-json.js";

vi.mock("../../../lib/api/fetch-json.js", () => ({
  fetchJson: vi.fn(),
}));

describe("pushAgentPresetsToRepository", () => {
  it("posts the selected mode and branch name to the push endpoint", async () => {
    const fetchJsonMock = vi.mocked(fetchJson);
    fetchJsonMock.mockResolvedValueOnce({
      committed: true,
      pushedBranch: "feature/agents",
      pullRequestUrl: "https://example.com/acme/repo/pull/7",
    });

    await expect(
      pushAgentPresetsToRepository("project/one", {
        mode: "pull_request",
        branchName: "feature/agents",
      }),
    ).resolves.toEqual({
      committed: true,
      pushedBranch: "feature/agents",
      pullRequestUrl: "https://example.com/acme/repo/pull/7",
    });

    expect(fetchJsonMock).toHaveBeenCalledWith(
      "/api/projects/project%2Fone/agent-presets/push",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "pull_request",
          branchName: "feature/agents",
        }),
      },
    );
  });
});
