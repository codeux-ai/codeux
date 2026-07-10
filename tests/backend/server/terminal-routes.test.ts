import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import { EventEmitter } from "events";
import { spawn } from "child_process";
import * as fs from "fs/promises";
import {
  registerTerminalRoutes,
  bootDashboardTerminalWebSocketServer,
  parseAndValidateLoginUrl,
} from "../../../src/server/terminal-routes.js";
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
const mockLoginImageState = vi.hoisted(() => ({
  inspectExitCode: 0,
  holdBuild: false,
  finishBuild: null as ((code: number) => void) | null,
  buildCount: 0,
  buildExitCode: 0,
}));

function getDockerRunArgsForProvider(providerId: string): string[] {
  const runCall = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
    ([cmd, args]) => cmd === "docker"
      && Array.isArray(args)
      && args.includes("run")
      && args.includes(`code-ux.provider-id=${providerId}`),
  );
  expect(runCall).toBeDefined();
  return runCall![1] as string[];
}

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
        if (argv.includes("build") && mockLoginImageState.holdBuild) {
          mockLoginImageState.buildCount += 1;
          mockLoginImageState.finishBuild = (code: number) => process.nextTick(() => proc.emit("close", code));
        } else {
          if (argv.includes("build")) {
            mockLoginImageState.buildCount += 1;
          }
          const code = argv.includes("inspect") ? mockLoginImageState.inspectExitCode : mockLoginImageState.buildExitCode;
          process.nextTick(() => proc.emit("close", code));
        }
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
    mockLoginImageState.inspectExitCode = 0;
    mockLoginImageState.holdBuild = false;
    mockLoginImageState.finishBuild = null;
    mockLoginImageState.buildCount = 0;
    mockLoginImageState.buildExitCode = 0;
    app = express();
    app.use(express.json());

    systemSettings = {
      defaults: {
        cliWorkflow: {
          containerImageMode: "managed",
          containerImage: "node:24-trixie-slim",
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
      managedRuntimeService: {
        resolveImage: vi.fn().mockResolvedValue("ghcr.io/codeux-ai/codeux-runtime@sha256:managed"),
      } as any,
      providerToolManager: {
        getStatus: vi.fn((provider: string) => provider === "generic-cli" ? null : { provider, state: "ready" }),
        prepare: vi.fn(async (provider: string) => ({
          provider,
          volumeName: `code-ux-provider-tool-${provider}-test`,
          version: "1.0.0",
          binary: provider,
          mountPath: "/opt/code-ux/provider-tool",
        })),
      } as any,
    };

    registerTerminalRoutes(app, mockDeps as DashboardDependencies);
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockSpawnEvents.removeAllListeners();
    mockStdout.removeAllListeners();
    mockStderr.removeAllListeners();
    mockLoginImageState.holdBuild = false;
    mockLoginImageState.finishBuild = null;
    vi.restoreAllMocks();
  });

  it("should reject websocket upgrades from hostile origins", async () => {
    const mockServer = new EventEmitter() as any;
    const mockSocket = new EventEmitter() as any;
    mockSocket.write = vi.fn();
    mockSocket.destroy = vi.fn();

    bootDashboardTerminalWebSocketServer({
      server: mockServer,
      pathName: "/ws/terminal",
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), child: vi.fn() } as any,
    });

    const startResponse = await request(app)
      .post("/api/terminal/start")
      .send({ providerConfigId: "gemini" });
    const sessionId = startResponse.body.sessionId;

    const mockReq = {
      url: `/ws/terminal?sessionId=${sessionId}`,
      headers: {
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-fetch-site": "cross-site",
        "origin": "https://evil.com"
      },
    };

    mockServer.emit("upgrade", mockReq, mockSocket, Buffer.alloc(0));

    expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining("403 Forbidden"));
    expect(mockSocket.destroy).toHaveBeenCalled();
  });

  it("rejects a path-traversal providerConfigId before any filesystem access", async () => {
    // A directly-supplied (valid) providerId bypasses the providerConfigId
    // lookup, so without validation the traversal value would reach the
    // destructive credential fs.rm/mkdir/cp. The handler must 400 first.
    const rmSpy = vi.spyOn(fs, "rm");
    const mkdirSpy = vi.spyOn(fs, "mkdir");

    const response = await request(app)
      .post("/api/terminal/start")
      .send({ providerId: "codex", providerConfigId: "../../../../tmp/evil" });

    expect(response.status).toBe(400);
    expect(String(response.body.error)).toMatch(/providerConfigId/i);
    expect(rmSpy).not.toHaveBeenCalled();
    expect(mkdirSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["Unix separator", "codex/../../secrets"],
    ["Windows separator", "codex\\..\\secrets"],
    ["absolute path", "/tmp/secrets"],
    ["encoded separator", "codex%2fsecrets"],
  ])("rejects a providerConfigId containing %s", async (_label, providerConfigId) => {
    const rmSpy = vi.spyOn(fs, "rm");
    const mkdirSpy = vi.spyOn(fs, "mkdir");

    const response = await request(app)
      .post("/api/terminal/start")
      .send({ providerId: "claude-code", providerConfigId });

    expect(response.status).toBe(400);
    expect(String(response.body.error)).toMatch(/providerConfigId/i);
    expect(rmSpy).not.toHaveBeenCalled();
    expect(mkdirSpy).not.toHaveBeenCalled();
  });

  it("should close the socket when receiving oversized frames", async () => {
    vi.useFakeTimers();

    const startResponse = await request(app)
      .post("/api/terminal/start")
      .send({ providerConfigId: "gemini" });
    const sessionId = startResponse.body.sessionId;

    const mockServer = new EventEmitter() as any;
    const mockSocket = new EventEmitter() as any;
    mockSocket.write = vi.fn();
    mockSocket.destroy = vi.fn();

    bootDashboardTerminalWebSocketServer({
      server: mockServer,
      pathName: "/ws/terminal",
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), child: vi.fn() } as any,
    });

    const mockReq = {
      url: `/ws/terminal?sessionId=${sessionId}`,
      headers: {
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      },
    };

    mockServer.emit("upgrade", mockReq, mockSocket, Buffer.alloc(0));

    // Send a frame that is larger than 10MB
    const oversizedFrame = Buffer.alloc(14);
    oversizedFrame[0] = 0x81; // FIN + text
    oversizedFrame[1] = 0xff; // Masked + 127 length indicator
    oversizedFrame.writeBigUInt64BE(BigInt(11 * 1024 * 1024), 2);
    oversizedFrame[10] = 0x12;
    oversizedFrame[11] = 0x34;
    oversizedFrame[12] = 0x56;
    oversizedFrame[13] = 0x78;

    mockSocket.emit("data", oversizedFrame);

    expect(mockSocket.destroy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("should return 400 when starting terminal session with unknown raw providerId", async () => {
    const response = await request(app)
      .post("/api/terminal/start")
      .send({ providerId: "not-a-real-provider" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Unknown providerId: not-a-real-provider");
  });

  it("should successfully start a terminal session and spawn docker", async () => {
    const response = await request(app)
      .post("/api/terminal/start")
      .send({ providerConfigId: "gemini" });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("sessionId");
    expect(response.body.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
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
      expect(response.body.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    }
  });

  it("uses the shared managed runtime and prepared provider volume without installing in the login container", async () => {
    const response = await request(app)
      .post("/api/terminal/start")
      .send({ providerConfigId: "claude" });

    expect(response.status).toBe(200);

    const runCall = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      ([cmd, args]) => cmd === "docker" && Array.isArray(args) && args.includes("run")
    );
    expect(runCall).toBeDefined();
    const runArgs = runCall![1] as string[];
    expect(runArgs).toContain("ghcr.io/codeux-ai/codeux-runtime@sha256:managed");
    expect(runArgs).toContain("type=volume,source=code-ux-provider-tool-claude-code-test,target=/opt/code-ux/provider-tool,readonly");
    const containerCmd = runArgs[runArgs.length - 1];
    expect(containerCmd).not.toContain("Installing provider CLI fallback");
    expect(containerCmd).toContain("/opt/code-ux/provider-tool/bin");
  });

  it("starts Qwen login from a bounded empty working directory with a dashboard-sized terminal", async () => {
    const response = await request(app)
      .post("/api/terminal/start")
      .send({ providerConfigId: "qwen" });

    expect(response.status).toBe(200);

    const runArgs = getDockerRunArgsForProvider("qwen-code");
    const workdirIndex = runArgs.indexOf("--workdir");
    expect(workdirIndex).toBeGreaterThan(-1);
    expect(runArgs[workdirIndex + 1]).toBe("/tmp");
    expect(runArgs).toEqual(expect.arrayContaining([
      "TERM=xterm-256color",
      "COLORTERM=truecolor",
    ]));

    const containerCmd = runArgs.at(-1) ?? "";
    expect(containerCmd).toContain("mkdir -p /tmp/code-ux-login");
    expect(containerCmd).toContain("cd /tmp/code-ux-login");
    expect(containerCmd).toContain("stty cols 100 rows 30");
    expect(containerCmd).not.toContain("stty cols 80 rows 100");
    expect(containerCmd.indexOf("cd /tmp/code-ux-login")).toBeLessThan(containerCmd.lastIndexOf("qwen"));
  });

  it.each([
    ["codex", "codex"],
    ["claude-code", "claude"],
  ])("publishes %s login callback ports on host loopback only", async (providerId, providerConfigId) => {
    const response = await request(app)
      .post("/api/terminal/start")
      .send({ providerConfigId });

    expect(response.status).toBe(200);

    const runArgs = getDockerRunArgsForProvider(providerId);
    expect(runArgs).not.toContain("--network");
    expect(runArgs).not.toContain("host");

    const publishArgs = runArgs
      .map((arg, index) => (runArgs[index - 1] === "-p" ? arg : null))
      .filter((arg): arg is string => typeof arg === "string");
    expect(publishArgs).toHaveLength(1);
    expect(publishArgs[0]).toMatch(/^127\.0\.0\.1:(\d+):\1$/);
  });

  it("does not use host networking or public port publishing for login containers by default", async () => {
    const response = await request(app)
      .post("/api/terminal/start")
      .send({ providerConfigId: "gemini" });

    expect(response.status).toBe(200);

    const runArgs = getDockerRunArgsForProvider("gemini");
    expect(runArgs).not.toContain("--network");
    expect(runArgs).not.toContain("host");
    expect(runArgs).not.toContain("-p");
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

  describe("login URL validation", () => {
    it("should accept valid provider login URL with redirect", () => {
      const result = parseAndValidateLoginUrl("https://login.example.com/oauth?redirect_uri=http://127.0.0.1:8080/callback");
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.randomPort).toBe(8080);
        expect(result.url).toBe("https://login.example.com/oauth?redirect_uri=http://127.0.0.1:8080/callback");
      }
    });

    it("should accept valid url without redirect_uri", () => {
      const result = parseAndValidateLoginUrl("https://login.example.com/oauth");
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.randomPort).toBeUndefined();
      }
    });

    it("should reject javascript: URL", () => {
      const result = parseAndValidateLoginUrl("javascript:alert(1)");
      expect(result.isValid).toBe(false);
    });

    it("should reject malformed URL", () => {
      const result = parseAndValidateLoginUrl("not-a-valid-url");
      expect(result.isValid).toBe(false);
    });

    it("should skip proxy on redirect target on non-localhost", () => {
      const result = parseAndValidateLoginUrl("https://login.example.com/oauth?redirect_uri=http://evil.com:8080/callback");
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.randomPort).toBeUndefined();
      }
    });

    it("should skip proxy on redirect target with privileged port (e.g. port 80)", () => {
      const result = parseAndValidateLoginUrl("https://login.example.com/oauth?redirect_uri=http://127.0.0.1:80/callback");
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.randomPort).toBeUndefined();
      }
    });

    it("should skip proxy on redirect target without http/https protocol", () => {
      const result = parseAndValidateLoginUrl("https://login.example.com/oauth?redirect_uri=ftp://127.0.0.1:8080/callback");
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.randomPort).toBeUndefined();
      }
    });

    it("should accept valid URL with non-URL redirect target", () => {
      const result = parseAndValidateLoginUrl("https://login.example.com/oauth?redirect_uri=urn:ietf:wg:oauth:2.0:oob");
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.randomPort).toBeUndefined();
      }
    });
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
