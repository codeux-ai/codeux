import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  registerAgentPresetRoutes,
  SKILL_STORAGE_CONTENT_PREVIEW_MAX_LENGTH,
  SKILL_STORAGE_CONTENTS_MAX_SKILLS,
} from "../../../src/server/agent-preset-routes.js";
import { EntityNotFoundError } from "../../../src/repositories/repository-utils.js";

describe("agent preset routes", () => {
  it("returns 404 when push support is not wired", async () => {
    const app = express();
    app.use(express.json());
    registerAgentPresetRoutes(app, {
      listAgentPresets: vi.fn(),
      createAgentPreset: vi.fn(),
      updateAgentPreset: vi.fn(),
      deleteAgentPreset: vi.fn(),
    } as any);

    const response = await request(app)
      .post("/api/projects/project-1/agent-presets/push")
      .send({ mode: "commit_only" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Agent preset push is not enabled for agents." });
  });

  it("forwards push requests to the repository service", async () => {
    const pushAgentPresetsToRepository = vi.fn().mockResolvedValue({
      committed: true,
      pushedBranch: "feature/agents",
    });
    const app = express();
    app.use(express.json());
    registerAgentPresetRoutes(app, {
      listAgentPresets: vi.fn(),
      createAgentPreset: vi.fn(),
      updateAgentPreset: vi.fn(),
      deleteAgentPreset: vi.fn(),
      pushAgentPresetsToRepository,
    } as any);

    const response = await request(app)
      .post("/api/projects/project-1/agent-presets/push")
      .send({ mode: "commit_and_push", branchName: "feature/agents" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      committed: true,
      pushedBranch: "feature/agents",
    });
    expect(pushAgentPresetsToRepository).toHaveBeenCalledWith("project-1", {
      mode: "commit_and_push",
      branchName: "feature/agents",
    });
  });

  it("serves persistent skill storage management endpoints", async () => {
    const storage = {
      id: "storage-1",
      projectId: "project-1",
      name: "Team Skills",
      description: "Shared working notes",
      storageKind: "project",
      createdAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-09T00:00:00.000Z",
    };
    const skillService = {
      listStorages: vi.fn().mockReturnValue([storage]),
      createStorage: vi.fn().mockReturnValue(storage),
      updateStorage: vi.fn().mockReturnValue({ ...storage, name: "Updated Skills" }),
      getStorage: vi.fn().mockReturnValue(storage),
      listByStorage: vi.fn().mockReturnValue(Array.from(
        { length: SKILL_STORAGE_CONTENTS_MAX_SKILLS + 1 },
        (_, index) => ({
          id: `skill-${index}`,
          projectId: "project-1",
          storageId: "storage-1",
          name: `Skill ${index}`,
          description: `Description ${index}`,
          contentMarkdown: index === 0
            ? `  ${"bounded markdown ".repeat(30)}\n\nfinal line  `
            : `Skill body ${index}`,
          sourceType: "manual",
          sourceRef: null,
          contentHash: `hash-${index}`,
          tags: ["review"],
          appliesTo: ["src/**"],
          version: "1.0.0",
          createdAt: "2026-07-09T00:00:00.000Z",
          updatedAt: "2026-07-10T00:00:00.000Z",
        }),
      )),
      deleteStorage: vi.fn(),
    };
    const app = express();
    app.use(express.json());
    registerAgentPresetRoutes(app, {
      listAgentPresets: vi.fn(),
      createAgentPreset: vi.fn(),
      updateAgentPreset: vi.fn(),
      deleteAgentPreset: vi.fn(),
      skillService,
    } as any);

    const listResponse = await request(app).get("/api/projects/project-1/skill-storages");
    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toEqual([storage]);
    expect(skillService.listStorages).toHaveBeenCalledWith("project-1");

    const createResponse = await request(app)
      .post("/api/projects/project-1/skill-storages")
      .send({ name: "Team Skills", description: "Shared working notes", storageKind: "project" });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body).toEqual(storage);
    expect(skillService.createStorage).toHaveBeenCalledWith("project-1", {
      name: "Team Skills",
      description: "Shared working notes",
      storageKind: "project",
    });

    const updateResponse = await request(app)
      .patch("/api/projects/project-1/skill-storages/storage-1")
      .send({ name: "Updated Skills", description: "Updated notes" });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body).toEqual({ ...storage, name: "Updated Skills" });
    expect(skillService.updateStorage).toHaveBeenCalledWith("project-1", "storage-1", {
      name: "Updated Skills",
      description: "Updated notes",
    });

    const contentsResponse = await request(app)
      .get("/api/projects/project-1/skill-storages/storage-1/contents");
    expect(contentsResponse.status).toBe(200);
    expect(contentsResponse.body.storage).toEqual(storage);
    expect(contentsResponse.body.skills).toHaveLength(SKILL_STORAGE_CONTENTS_MAX_SKILLS);
    expect(contentsResponse.body.truncated).toBe(true);
    expect(contentsResponse.body.skills[0]).toEqual({
      id: "skill-0",
      name: "Skill 0",
      description: "Description 0",
      tags: ["review"],
      appliesTo: ["src/**"],
      version: "1.0.0",
      updatedAt: "2026-07-10T00:00:00.000Z",
      contentPreview: expect.any(String),
    });
    expect(contentsResponse.body.skills[0].contentPreview).toHaveLength(SKILL_STORAGE_CONTENT_PREVIEW_MAX_LENGTH);
    expect(contentsResponse.body.skills[0].contentPreview).toMatch(/\.\.\.$/);
    expect(contentsResponse.body.skills[0]).not.toHaveProperty("contentMarkdown");
    expect(contentsResponse.body.skills[0]).not.toHaveProperty("sourceRef");
    expect(skillService.getStorage).toHaveBeenCalledWith("project-1", "storage-1");
    expect(skillService.listByStorage).toHaveBeenCalledWith(
      "project-1",
      "storage-1",
      SKILL_STORAGE_CONTENTS_MAX_SKILLS + 1,
    );

    const deleteResponse = await request(app).delete("/api/projects/project-1/skill-storages/storage-1");
    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body).toEqual({ ok: true });
    expect(skillService.deleteStorage).toHaveBeenCalledWith("project-1", "storage-1");
  });

  it("rejects contents access when the storage is unknown or belongs to another project", async () => {
    const skillService = {
      getStorage: vi.fn().mockReturnValue(null),
      listByStorage: vi.fn(),
      updateStorage: vi.fn().mockImplementation(() => {
        throw new EntityNotFoundError("Skill storage not found: storage-1");
      }),
    };
    const app = express();
    app.use(express.json());
    registerAgentPresetRoutes(app, {
      listAgentPresets: vi.fn(),
      createAgentPreset: vi.fn(),
      updateAgentPreset: vi.fn(),
      deleteAgentPreset: vi.fn(),
      skillService,
    } as any);

    const response = await request(app)
      .get("/api/projects/project-other/skill-storages/storage-1/contents");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Skill storage not found: storage-1" });
    expect(skillService.getStorage).toHaveBeenCalledWith("project-other", "storage-1");
    expect(skillService.listByStorage).not.toHaveBeenCalled();

    const updateResponse = await request(app)
      .patch("/api/projects/project-other/skill-storages/storage-1")
      .send({ name: "Not allowed" });
    expect(updateResponse.status).toBe(404);
    expect(updateResponse.body).toEqual({ error: "Skill storage not found: storage-1" });
    expect(skillService.updateStorage).toHaveBeenCalledWith("project-other", "storage-1", {
      name: "Not allowed",
    });
  });
});
