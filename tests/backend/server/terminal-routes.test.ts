import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import { EventEmitter } from "events";
import { registerTerminalRoutes } from "../../../src/server/terminal-routes.js";
import type { DashboardDependencies } from "../../../src/server/dashboard-server.js";

// Mock child_process.spawn
const mockSpawnEvents = new EventEmitter();
const mockStdin = {
  write: vi.fn(),
};
const mockStdout = new EventEmitter();
const mockStderr = new EventEmitter();

const mockChildProcess = {
  stdin: mockStdin,
  stdout: mockStdout,
  stderr: mockStderr,
  kill: vi.fn(),
  on: (event: string, callback: (...args: any[]) => void) => {
    mockSpawnEvents.on(event, callback);
    return mockChildProcess;
  },
};

vi.mock("child_process", () => {
  return {
    spawn: vi.fn().mockImplementation(() => {
      return mockChildProcess;
    }),
  };
});

describe("Terminal Routes", () => {
  let app: express.Express;
  let mockDeps: Partial<DashboardDependencies>;
  let systemSettings: any;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    systemSettings = {
      defaults: {
        cliWorkflow: {
          containerImage: "node:24-bookworm",
        },
      },
      integrations: {
        providers: {
          gemini: { provider: "gemini", authType: "dashboardAuth" },
          claude: { provider: "claude-code", authType: "dashboardAuth" },
          codex: { provider: "codex", authType: "dashboardAuth" },
          qwen: { provider: "qwen-code", authType: "dashboardAuth" },
          antigravity: { provider: "antigravity", authType: "dashboardAuth" },
          opencode: { provider: "opencode", authType: "dashboardAuth" },
          legacy: { provider: "generic-cli", authType: "dashboardAuth" },
        },
      },
    };

    mockDeps = {
      getSystemSettings: () => systemSettings,
    };

    registerTerminalRoutes(app, mockDeps as DashboardDependencies);
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockSpawnEvents.removeAllListeners();
    mockStdout.removeAllListeners();
    mockStderr.removeAllListeners();
  });

  it("should successfully start a terminal session and spawn docker", async () => {
    const response = await request(app)
      .post("/api/terminal/start")
      .send({ providerConfigId: "gemini" });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("sessionId");
    expect(response.body.providerId).toBe("gemini");
  });

  it("should support special login setup configurations for all CLI providers", async () => {
    const providers = ["gemini", "claude", "codex", "qwen", "antigravity", "opencode", "legacy"];
    for (const providerConfigId of providers) {
      const response = await request(app)
        .post("/api/terminal/start")
        .send({ providerConfigId });
      expect(response.status).toBe(200);
      expect(response.body.sessionId).toBeDefined();
    }
  });

  it("should return 400 if providerConfigId is missing", async () => {
    const response = await request(app)
      .post("/api/terminal/start")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Missing providerConfigId");
  });

  it("should return 404 if provider configuration does not exist", async () => {
    const response = await request(app)
      .post("/api/terminal/start")
      .send({ providerConfigId: "nonexistent" });

    expect(response.status).toBe(404);
    expect(response.body.error).toContain("not found");
  });

  it("should successfully stop an active session", async () => {
    // Start session first
    const startResponse = await request(app)
      .post("/api/terminal/start")
      .send({ providerConfigId: "gemini" });

    const sessionId = startResponse.body.sessionId;
    expect(sessionId).toBeDefined();

    // Stop session
    const stopResponse = await request(app)
      .post("/api/terminal/stop")
      .send({ sessionId });

    expect(stopResponse.status).toBe(200);
    expect(stopResponse.body.success).toBe(true);
    expect(mockChildProcess.kill).toHaveBeenCalledWith("SIGKILL");
  });
});
