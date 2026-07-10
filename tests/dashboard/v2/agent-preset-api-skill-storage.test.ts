import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchSkillStorageContents,
  updateSkillStorage,
} from "../../../dashboard/src/v2/lib/agent-preset-api.js";
import { fetchJson } from "../../../dashboard/src/lib/api/fetch-json.js";
import type { SkillStorageContentsResponse } from "../../../src/contracts/skill-types.js";

vi.mock("../../../dashboard/src/lib/api/fetch-json.js", () => ({
  fetchJson: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("skill storage dashboard API", () => {
  it("updates a project-owned storage with encoded identifiers", async () => {
    const fetchJsonMock = vi.mocked(fetchJson);
    fetchJsonMock.mockResolvedValueOnce({
      id: "storage/one",
      projectId: "project/one",
      name: "Updated Skills",
      description: "Updated notes",
      storageKind: "project",
      createdAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
    });

    await updateSkillStorage("project/one", "storage/one", {
      name: "Updated Skills",
      description: "Updated notes",
    });

    expect(fetchJsonMock).toHaveBeenCalledWith(
      "/api/projects/project%2Fone/skill-storages/storage%2Fone",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated Skills", description: "Updated notes" }),
      },
    );
  });

  it("fetches a typed bounded contents response with encoded identifiers", async () => {
    const response: SkillStorageContentsResponse = {
      storage: {
        id: "storage/one",
        projectId: "project/one",
        name: "Team Skills",
        description: "Shared working notes",
        storageKind: "project",
        createdAt: "2026-07-09T00:00:00.000Z",
        updatedAt: "2026-07-10T00:00:00.000Z",
      },
      skills: [{
        id: "skill-1",
        name: "Review Discipline",
        description: "Review safely",
        tags: ["review"],
        appliesTo: ["src/**"],
        version: "1.0.0",
        updatedAt: "2026-07-10T00:00:00.000Z",
        contentPreview: "Inspect the implementation before editing.",
      }],
      truncated: false,
    };
    vi.mocked(fetchJson).mockResolvedValueOnce(response);

    await expect(fetchSkillStorageContents("project/one", "storage/one")).resolves.toEqual(response);
    expect(fetchJson).toHaveBeenCalledWith(
      "/api/projects/project%2Fone/skill-storages/storage%2Fone/contents",
    );
    expect(response.skills[0]).not.toHaveProperty("contentMarkdown");
  });
});
