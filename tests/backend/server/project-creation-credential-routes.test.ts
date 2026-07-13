import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardDependencies } from "../../../src/server/dashboard-server.js";
import { registerProjectRoutes } from "../../../src/server/project-routes.js";

const createGitHubRepo = vi.fn(async () => ({
  remoteUrl: "https://github.com/example/created.git",
  localPath: "/tmp/created",
}));
const createGitLabRepo = vi.fn(async () => ({
  remoteUrl: "https://gitlab.com/example/created.git",
  localPath: "/tmp/created",
}));

vi.mock("../../../src/infrastructure/git/remote-repo-creator.js", () => ({
  createGitHubRepo: (...args: unknown[]) => createGitHubRepo(...args),
  createGitLabRepo: (...args: unknown[]) => createGitLabRepo(...args),
}));

function createApp(overrides: Partial<DashboardDependencies>) {
  const app = express();
  app.use(express.json());
  registerProjectRoutes(app, {
    listProjects: vi.fn(),
    createProject: vi.fn(async (input) => ({ id: "project-1", ...input } as never)),
    getSystemSettings: vi.fn(() => ({ integrations: {} } as never)),
    ...overrides,
  } as DashboardDependencies);
  return app;
}

const remoteInput = {
  initMode: "new-remote",
  remoteProvider: "github",
  sourceRef: "created",
  name: "Created",
  sourceType: "git",
};

describe("remote project creation credentials", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves the broker reference for each operation and returns no secret material", async () => {
    const secrets = ["broker-value-v1", "broker-value-v2"];
    const withManagementCredential = vi.fn(async (_reference, context, consumer) => {
      expect(context).toMatchObject({
        consumer: "git.github.project-create",
        workspaceId: "project-management",
      });
      return await consumer(Buffer.from(secrets.shift()!));
    });
    const app = createApp({
      getSystemSettings: vi.fn(() => ({
        integrations: {
          githubToken: "",
          githubTokenCredentialRef: { credentialId: "credential-1", capability: "read" },
        },
      } as never)),
      settingsCredentialResolver: { withManagementCredential } as never,
    });

    const first = await request(app).post("/api/projects").send(remoteInput);
    const second = await request(app).post("/api/projects").send(remoteInput);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(withManagementCredential).toHaveBeenCalledTimes(2);
    expect(createGitHubRepo).toHaveBeenNthCalledWith(1, expect.objectContaining({ hostToken: "broker-value-v1" }));
    expect(createGitHubRepo).toHaveBeenNthCalledWith(2, expect.objectContaining({ hostToken: "broker-value-v2" }));
    expect(JSON.stringify(first.body)).not.toContain("broker-value-v1");
    expect(JSON.stringify(second.body)).not.toContain("broker-value-v2");
  });

  it.each(["missing", "revoked", "out of scope", "unavailable"])(
    "fails closed for a %s broker credential without remote egress",
    async (reason) => {
      const app = createApp({
        getSystemSettings: vi.fn(() => ({
          integrations: {
            githubTokenCredentialRef: { credentialId: "credential-1", capability: "read" },
          },
        } as never)),
        settingsCredentialResolver: {
          withManagementCredential: vi.fn(async () => { throw new Error(`Credential is ${reason}.`); }),
        } as never,
      });

      const response = await request(app).post("/api/projects").send(remoteInput);

      expect(response.status).toBe(400);
      expect(createGitHubRepo).not.toHaveBeenCalled();
    },
  );

  it("ignores sanitized legacy token fields and preserves ambient Git auth when no reference exists", async () => {
    const app = createApp({
      getSystemSettings: vi.fn(() => ({
        integrations: { githubToken: "must-not-cross-boundary", githubTokenCredentialRef: null },
      } as never)),
    });

    const response = await request(app).post("/api/projects").send(remoteInput);

    expect(response.status).toBe(201);
    expect(createGitHubRepo).toHaveBeenCalledWith(expect.objectContaining({ hostToken: undefined }));
    expect(JSON.stringify(response.body)).not.toContain("must-not-cross-boundary");
  });
});
