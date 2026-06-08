import express from "express";
import request from "supertest";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { registerGitProviderRoutes } from "../../../src/server/git-provider-routes.js";

const createApp = (deps: any) => {
  const app = express();
  registerGitProviderRoutes(app, deps);
  return app;
};

describe("git provider routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITLAB_TOKEN;
    delete process.env.GLAB_TOKEN;
  });

  it("returns status from configured settings tokens without probing local CLIs", async () => {
    const deps = {
      getSystemSettings: vi.fn().mockReturnValue({
        defaults: {
          git: {
            githubToken: "fake-token",
            gitlabToken: "gitlab-token",
          },
        },
      }),
    };

    const response = await request(createApp(deps)).get("/api/git-providers/available");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ github: true, gitlab: true });
    expect(deps.getSystemSettings).toHaveBeenCalled();
  });

  it("falls back to process tokens when settings tokens are missing", async () => {
    const deps = {
      getSystemSettings: vi.fn().mockReturnValue({
        defaults: {
          git: {
            githubToken: "",
            gitlabToken: "",
          },
        },
      }),
    };

    process.env.GH_TOKEN = "env-gh-token";

    const response = await request(createApp(deps)).get("/api/git-providers/available");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ github: true, gitlab: false });
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
