import express from "express";
import request from "supertest";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { registerGitProviderRoutes } from "../../../src/server/git-provider-routes.js";
import { spawnSync } from "child_process";

vi.mock("child_process", () => ({
  spawnSync: vi.fn(),
}));

const createApp = (deps: any) => {
  const app = express();
  registerGitProviderRoutes(app, deps);
  return app;
};

describe("git provider routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns status from settings and spawnSync", async () => {
    const deps = {
      getSystemSettings: vi.fn().mockReturnValue({
        defaults: {
          git: {
            githubToken: "fake-token",
          },
        },
      }),
    };

    // GitLab should be checked via spawnSync
    (spawnSync as any).mockReturnValue({ status: 0 });

    const response = await request(createApp(deps)).get("/api/git-providers/available");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ github: true, gitlab: true });
    expect(deps.getSystemSettings).toHaveBeenCalled();
    expect(spawnSync).toHaveBeenCalledWith("glab", ["auth", "status"], { stdio: "pipe" });
    // gh should NOT be called because settings has token
    expect(spawnSync).not.toHaveBeenCalledWith("gh", ["auth", "status"], { stdio: "pipe" });
  });

  it("returns status from spawnSync when settings token is missing", async () => {
    const deps = {
      getSystemSettings: vi.fn().mockReturnValue({
        defaults: {
          git: {
            githubToken: "",
          },
        },
      }),
    };

    (spawnSync as any).mockImplementation((cmd: string) => {
      if (cmd === "gh") return { status: 0 };
      if (cmd === "glab") return { status: 1 };
      return { status: 1 };
    });

    const response = await request(createApp(deps)).get("/api/git-providers/available");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ github: true, gitlab: false });
    expect(spawnSync).toHaveBeenCalledWith("gh", ["auth", "status"], { stdio: "pipe" });
    expect(spawnSync).toHaveBeenCalledWith("glab", ["auth", "status"], { stdio: "pipe" });
  });

  it("returns false when both are unauthenticated", async () => {
    const deps = {
      getSystemSettings: vi.fn().mockReturnValue({
        defaults: {
          git: {
            githubToken: "",
          },
        },
      }),
    };

    (spawnSync as any).mockReturnValue({ status: 1 });

    const response = await request(createApp(deps)).get("/api/git-providers/available");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ github: false, gitlab: false });
  });

  it("handles errors gracefully", async () => {
    const deps = {
      getSystemSettings: vi.fn().mockImplementation(() => {
        throw new Error("Settings error");
      }),
    };

    const response = await request(createApp(deps)).get("/api/git-providers/available");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ github: false, gitlab: false });
  });
});
