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
});
