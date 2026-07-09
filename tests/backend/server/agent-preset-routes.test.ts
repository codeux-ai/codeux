import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { registerAgentPresetRoutes } from "../../../src/server/agent-preset-routes.js";

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

    const deleteResponse = await request(app).delete("/api/projects/project-1/skill-storages/storage-1");
    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body).toEqual({ ok: true });
    expect(skillService.deleteStorage).toHaveBeenCalledWith("project-1", "storage-1");
  });
});
