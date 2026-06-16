import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import { EventEmitter } from "events";
import { spawn } from "child_process";
import { registerTerminalRoutes, bootDashboardTerminalWebSocketServer, buildLoginDockerfile } from "../../../src/server/terminal-routes.js";
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
    spawn: vi.fn().mockImplementation((_cmd: string, args?: string[]) => {
      const argv = Array.isArray(args) ? args : [];
      // ensureLoginBaseImage probes/builds the pinned login image. Resolve the
      // `docker image inspect` immediately as "exists" (code 0) so no build runs
      // and the start handler proceeds to spawn the container.
      if (argv.includes("inspect") || argv.includes("build")) {
        const proc: any = new EventEmitter();
        proc.stdin = { write: vi.fn(), end: vi.fn() };
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        process.nextTick(() => proc.emit("close", 0));
        return proc;
      }
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

  it("should run the login container on the pinned login image, not the configured image", async () => {
    systemSettings.defaults.cliWorkflow.containerImage = "some/custom-image:latest";

    const response = await request(app)
      .post("/api/terminal/start")
      .send({ providerConfigId: "claude" });

    expect(response.status).toBe(200);

    const runCall = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      ([cmd, args]) => cmd === "docker" && Array.isArray(args) && args.includes("run")
    );
    expect(runCall).toBeDefined();
    const runArgs = runCall![1] as string[];
    expect(runArgs).not.toContain("some/custom-image:latest");
    expect(runArgs).not.toContain("node:24-bookworm");
    expect(runArgs.some((arg) => arg.startsWith("code-ux-login-base-node-24-bookworm-slim:") || arg === "node:24-bookworm-slim")).toBe(true);

    // The login container command defines ensure_curl so the curl-based provider
    // installers resolve instead of failing with "ensure_curl: command not found".
    const containerCmd = runArgs[runArgs.length - 1];
    expect(containerCmd).toContain("ensure_curl()");
  });

  it("should bake only the apt prerequisites into the login image, not the providers", () => {
    const dockerfile = buildLoginDockerfile();
    expect(dockerfile).toContain("FROM node:24-bookworm-slim");
    expect(dockerfile).toContain('LABEL org.opencontainers.image.title="Code UX login base"');
    expect(dockerfile).toContain('LABEL ai.codeux.role="login-base"');
    // curl + keyring stack are baked in (can't be installed at runtime non-root)
    expect(dockerfile).toContain("curl");
    expect(dockerfile).toContain("gnome-keyring");
    // Provider CLIs are NOT baked in — they install at runtime for faster feedback
    expect(dockerfile).not.toContain("@google/gemini-cli");
    expect(dockerfile).not.toContain("claude.ai/install.sh");
    expect(dockerfile).not.toContain("opencode.ai/install");
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

  it("should successfully resolve and start a dynamically-generated unsaved provider ID prefix", async () => {
    const response = await request(app)
      .post("/api/terminal/start")
      .send({ providerConfigId: "gemini-mptfvpkk-u1fui" });

    expect(response.status).toBe(200);
    expect(response.body.sessionId).toBeDefined();
    expect(response.body.providerId).toBe("gemini");
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

  it("should terminate the terminal session and container when all WebSocket clients disconnect and heartbeat goes stale", async () => {
    vi.useFakeTimers();

    // Start session
    const startResponse = await request(app)
      .post("/api/terminal/start")
      .send({ providerConfigId: "gemini" });

    const sessionId = startResponse.body.sessionId;
    expect(sessionId).toBeDefined();

    // Mock HttpServer upgrade emitter
    const mockServer = new EventEmitter() as any;
    const mockLogger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), child: vi.fn() } as any;

    bootDashboardTerminalWebSocketServer({
      server: mockServer,
      pathName: "/ws/terminal",
      logger: mockLogger,
    });

    // Simulate connection
    const mockSocket = new EventEmitter() as any;
    mockSocket.write = vi.fn();
    mockSocket.destroy = vi.fn();

    const mockReq = {
      url: `/ws/terminal?sessionId=${sessionId}`,
      headers: {
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      },
    };

    // Trigger upgrade
    mockServer.emit("upgrade", mockReq, mockSocket, Buffer.alloc(0));

    // WebSocket handshake response should be written
    expect(mockSocket.write).toHaveBeenCalledWith(
      expect.stringContaining("HTTP/1.1 101 Switching Protocols")
    );

    // Simulate socket disconnect (e.g. close)
    mockSocket.emit("close");

    // Before grace period, childProcess should NOT be killed
    expect(mockChildProcess.kill).not.toHaveBeenCalled();

    // Advance time by 1000ms
    vi.advanceTimersByTime(1000);

    // Heartbeat is still fresh, so session should remain alive.
    expect(mockChildProcess.kill).not.toHaveBeenCalled();

    // Advance past heartbeat TTL and sweep interval.
    vi.advanceTimersByTime(31000);

    // Now the stale session should be SIGKILL'ed
    expect(mockChildProcess.kill).toHaveBeenCalledWith("SIGKILL");

    vi.useRealTimers();
  });

  it("should auto-detect successful login output and terminate early", async () => {
    vi.useFakeTimers();

    // Start session
    const startResponse = await request(app)
      .post("/api/terminal/start")
      .send({ providerConfigId: "gemini" });

    const sessionId = startResponse.body.sessionId;
    expect(sessionId).toBeDefined();

    // Simulate stdout output with "Signed in" success string
    mockStdout.emit("data", Buffer.from("User logged in successfully. Signed in. Welcome!"));

    // Before 800ms grace period, childProcess should NOT be killed
    expect(mockChildProcess.kill).not.toHaveBeenCalled();

    // Advance time by 800ms
    vi.advanceTimersByTime(800);

    // Now childProcess should be SIGKILL'ed
    expect(mockChildProcess.kill).toHaveBeenCalledWith("SIGKILL");

    vi.useRealTimers();
  });
});
