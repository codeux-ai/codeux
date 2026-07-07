import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentPreset, pushAgentPresetsToRepository, updateAgentPreset } from "../agent-preset-api.js";
import { fetchJson } from "../../../lib/api/fetch-json.js";

vi.mock("../../../lib/api/fetch-json.js", () => ({
  fetchJson: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("createAgentPreset", () => {
  it("serializes the Docker root-mode override when creating a preset", async () => {
    const fetchJsonMock = vi.mocked(fetchJson);
    fetchJsonMock.mockResolvedValueOnce({
      id: "preset-1",
      projectId: "project/one",
      name: "Build Agent",
      description: "Runs dependency setup",
      instructionMarkdown: "Install dependencies before coding.",
      labels: [],
      sourcePath: null,
      sourceScope: null,
      sourceUpdatedAt: null,
      sourceImportedAt: null,
      sourceExists: false,
      syncStatus: "manual",
      containerRunAsRoot: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await createAgentPreset("project/one", {
      name: "Build Agent",
      description: "Runs dependency setup",
      instructionMarkdown: "Install dependencies before coding.",
      containerRunAsRoot: false,
    });

    expect(fetchJsonMock).toHaveBeenCalledWith(
      "/api/projects/project%2Fone/agent-presets",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.any(String) as string,
      }),
    );
    const body = JSON.parse((fetchJsonMock.mock.calls[0]?.[1] as { body: string }).body) as Record<string, unknown>;
    expect(body).toMatchObject({
      name: "Build Agent",
      description: "Runs dependency setup",
      instructionMarkdown: "Install dependencies before coding.",
      containerRunAsRoot: false,
    });
  });
});

describe("updateAgentPreset", () => {
  it("sends a root-mode change from the editor payload to the backend", async () => {
    const fetchJsonMock = vi.mocked(fetchJson);
    fetchJsonMock.mockResolvedValueOnce({
      id: "preset-1",
      projectId: "project-1",
      name: "Build Agent",
      description: "Runs dependency setup",
      instructionMarkdown: "Install dependencies before coding.",
      labels: [],
      sourcePath: null,
      sourceScope: null,
      sourceUpdatedAt: null,
      sourceImportedAt: null,
      sourceExists: false,
      syncStatus: "manual",
      containerRunAsRoot: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await updateAgentPreset("preset-1", {
      name: "Build Agent",
      containerRunAsRoot: true,
    });

    expect(fetchJsonMock).toHaveBeenCalledWith(
      "/api/agent-presets/preset-1",
      expect.objectContaining({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: expect.any(String) as string,
      }),
    );
    const body = JSON.parse((fetchJsonMock.mock.calls[0]?.[1] as { body: string }).body) as Record<string, unknown>;
    expect(body).toMatchObject({
      name: "Build Agent",
      containerRunAsRoot: true,
    });
  });
});

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
