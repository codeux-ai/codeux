import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import { EventEmitter } from "events";
import { registerTerminalRoutes, bootDashboardTerminalWebSocketServer } from "../../../src/server/terminal-routes.js";
import type { DashboardDependencies } from "../../../src/server/dashboard-server.js";

const mockSpawnEvents = new EventEmitter();
const mockStdin = { write: vi.fn() };
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

describe("Login container cleanup", () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    const deps: Partial<DashboardDependencies> = {
      getSystemSettings: () => ({
        defaults: { cliWorkflow: { containerImage: "node:24-bookworm" } },
        integrations: { providers: { gemini: { provider: "gemini", authType: "dashboardAuth" } } },
      }),
    };

    registerTerminalRoutes(app, deps as DashboardDependencies);
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockSpawnEvents.removeAllListeners();
    mockStdout.removeAllListeners();
    mockStderr.removeAllListeners();
    vi.useRealTimers();
  });

  it("tears down login container on explicit finalize and tolerates duplicate finalize", async () => {
    const startResponse = await request(app)
      .post("/api/terminal/start")
      .send({ providerConfigId: "gemini" });

    const sessionId = startResponse.body.sessionId as string;
    expect(sessionId).toBeDefined();

    const finalizeFirst = await request(app)
      .post("/api/terminal/finalize")
      .send({ sessionId });
    expect(finalizeFirst.status).toBe(200);
    expect(finalizeFirst.body.success).toBe(true);

    const finalizeSecond = await request(app)
      .post("/api/terminal/finalize")
      .send({ sessionId });
    expect(finalizeSecond.status).toBe(200);
    expect(finalizeSecond.body.success).toBe(true);

    expect(mockChildProcess.kill).toHaveBeenCalledTimes(1);
    expect(mockChildProcess.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("keeps active sessions alive with fresh heartbeat and cleans up after passive drop", async () => {
    vi.useFakeTimers();

    const startResponse = await request(app)
      .post("/api/terminal/start")
      .send({ providerConfigId: "gemini" });

    const sessionId = startResponse.body.sessionId as string;
    expect(sessionId).toBeDefined();

    const mockServer = new EventEmitter() as any;
    const mockLogger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), child: vi.fn() } as any;

    bootDashboardTerminalWebSocketServer({
      server: mockServer,
      pathName: "/api/terminal/ws",
      logger: mockLogger,
    });

    const mockSocket = new EventEmitter() as any;
    mockSocket.write = vi.fn();
    mockSocket.destroy = vi.fn();
    mockSocket.end = vi.fn();

    const mockReq = {
      url: `/api/terminal/ws?sessionId=${sessionId}`,
      headers: { "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" },
    };

    mockServer.emit("upgrade", mockReq, mockSocket, Buffer.alloc(0));
    mockSocket.emit("close");

    vi.advanceTimersByTime(1000);
    expect(mockChildProcess.kill).not.toHaveBeenCalled();

    const heartbeatResponse = await request(app)
      .post("/api/terminal/heartbeat")
      .send({ sessionId });
    expect(heartbeatResponse.status).toBe(200);

    vi.advanceTimersByTime(10000);
    expect(mockChildProcess.kill).not.toHaveBeenCalled();

    vi.advanceTimersByTime(12000);
    expect(mockChildProcess.kill).toHaveBeenCalledWith("SIGKILL");
  });
});
