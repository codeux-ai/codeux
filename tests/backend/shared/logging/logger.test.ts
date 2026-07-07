import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
  CORRELATION_ID_HEADER,
  correlationIdMiddleware,
  getCorrelationId,
  runWithCorrelationId,
} from "../../../../src/shared/logging/correlation-id.js";
import { createLogger, type LogPurpose } from "../../../../src/shared/logging/logger.js";

const purposeLabels: Record<LogPurpose, string> = {
  dashboard: "DASH",
  general: "GEN",
  integration: "INT",
  invocation: "INVK",
  lifecycle: "LIFE",
  mcp: "MCP",
  orchestration: "ORCH",
  request: "HTTP",
  runtime: "RUN",
  settings: "CONF",
  storage: "DATA",
  realtime: "LIVE",
  security: "SEC",
};

async function readFileEventually(filePath: string, timeoutMs = 500): Promise<string> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await fs.readFile(filePath, "utf8");
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (lastError) {
    throw lastError;
  }
  return await fs.readFile(filePath, "utf8");
}

describe("createLogger", () => {
  // The global test setup forces console logging to "error" via CODEUX_FORCE_LOG_LEVEL
  // to keep the reporter clean. These tests verify the real level-resolution logic,
  // so they opt out of the global override and restore it afterward.
  const savedForcedLogLevel = process.env.CODEUX_FORCE_LOG_LEVEL;
  beforeEach(() => {
    delete process.env.CODEUX_FORCE_LOG_LEVEL;
  });

  afterEach(() => {
    if (savedForcedLogLevel === undefined) {
      delete process.env.CODEUX_FORCE_LOG_LEVEL;
    } else {
      process.env.CODEUX_FORCE_LOG_LEVEL = savedForcedLogLevel;
    }
    vi.restoreAllMocks();
  });

  it("logs human-readable output in development", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = createLogger({ environment: "development", consoleLogLevel: "debug", consoleLogMode: "full" });

    logger.info("request finished", { method: "GET", statusCode: 200 });

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const output = String(stderrSpy.mock.calls[0][0]);
    expect(output).toContain("INFO");
    expect(output).toContain("HTTP");
    expect(output).toContain("request finished");
    expect(output).toContain("method");
  });

  it("suppresses routine request logs from standard console output", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = createLogger({ environment: "development", consoleLogLevel: "debug", consoleLogMode: "standard" });

    logger.info("Dashboard request completed", { logPurpose: "request", method: "GET", statusCode: 200 });
    logger.info("Provider invocation started", { logPurpose: "invocation", provider: "codex" });

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(String(stderrSpy.mock.calls[0][0])).toContain("INVK");
  });

  it("prints request logs when console log level is full", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = createLogger({ environment: "development", consoleLogLevel: "debug", consoleLogMode: "full" });

    logger.info("Dashboard request completed", { logPurpose: "request", method: "GET", statusCode: 200 });

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(String(stderrSpy.mock.calls[0][0])).toContain("HTTP");
  });

  it("emits ANSI-colored classified console output when color is enabled", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = createLogger({ environment: "development", consoleLogLevel: "debug", consoleLogMode: "full", color: true });

    logger.info("Provider invocation started", { logPurpose: "invocation", provider: "codex" });

    const output = String(stderrSpy.mock.calls[0][0]);
    expect(output).toContain("\u001b[");
    expect(output).toContain("INVK");
  });

  it("keeps every log purpose mapped to a stable console label", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = createLogger({ environment: "development", consoleLogLevel: "debug", consoleLogMode: "full" });

    for (const purpose of Object.keys(purposeLabels) as LogPurpose[]) {
      logger.info(`purpose-${purpose}`, { logPurpose: purpose });
    }

    expect(stderrSpy).toHaveBeenCalledTimes(Object.keys(purposeLabels).length);
    for (const [index, purpose] of (Object.keys(purposeLabels) as LogPurpose[]).entries()) {
      const output = String(stderrSpy.mock.calls[index]?.[0] || "");
      expect(output).toContain(purposeLabels[purpose]);
      expect(output).toContain(`purpose-${purpose}`);
    }
  });

  it("lets explicit logPurpose take precedence over message and component inference", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = createLogger({
      environment: "production",
      level: "debug",
      consoleLogMode: "full",
      bindings: { component: "provider websocket dashboard" },
    });

    logger.info("provider websocket request completed", { logPurpose: "storage" });

    const payload = JSON.parse(String(stderrSpy.mock.calls[0][0]));
    expect(payload.purpose).toBe("storage");
  });

  it("infers purpose fallbacks from stable message and metadata conventions", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = createLogger({ environment: "production", level: "debug", consoleLogMode: "full" });

    logger.info("HTTP request completed", { method: "GET", path: "/api/projects", statusCode: 200 });
    logger.info("Provider invocation started");
    logger.info("MCP request handled");
    logger.info("Dashboard realtime websocket broadcast failed");
    logger.info("Settings saved");
    logger.info("Sprint orchestration started");
    logger.info("Runtime startup complete");
    logger.info("Dashboard server started");
    logger.info("Unclassified background note");

    const purposes = stderrSpy.mock.calls.map((call) => JSON.parse(String(call[0])).purpose);
    expect(purposes).toEqual([
      "request",
      "invocation",
      "mcp",
      "realtime",
      "settings",
      "orchestration",
      "lifecycle",
      "dashboard",
      "general",
    ]);
  });

  it("logs JSON output with correlation id in production", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = createLogger({
      environment: "production",
      level: "debug",
      bindings: { component: "test" },
    });

    runWithCorrelationId("corr-123", () => {
      logger.error("failed", { reason: "timeout" });
    });

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(stderrSpy.mock.calls[0][0]));
    expect(payload.level).toBe("error");
    expect(payload.purpose).toBe("general");
    expect(payload.message).toBe("failed");
    expect(payload.correlationId).toBe("corr-123");
    expect(payload.metadata).toEqual({ component: "test", reason: "timeout" });
  });

  it("respects log level filtering", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = createLogger({ environment: "development", consoleLogLevel: "warn" });

    logger.info("skip this");
    logger.warn("keep this");

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const output = String(stderrSpy.mock.calls[0][0]);
    expect(output).not.toContain("skip this");
    expect(output).toContain("keep this");
  });

  it("filters console and debug file output independently", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-logger-"));
    const logFilePath = path.join(dir, "debug.log");
    const logger = createLogger({
      environment: "development",
      consoleLogLevel: "info",
      debugLogFileLevel: "error",
      consoleLogMode: "full",
      logFilePath,
    });

    logger.info("visible on console only");
    logger.error("visible everywhere");

    expect(stderrSpy).toHaveBeenCalledTimes(2);
    const fileOutput = await readFileEventually(logFilePath);
    expect(fileOutput).not.toContain("visible on console only");
    expect(fileOutput).toContain("visible everywhere");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("honors DEBUG_LOG_FILE_LEVEL independently of console filtering", async () => {
    const previousDebugLogFileLevel = process.env.DEBUG_LOG_FILE_LEVEL;
    process.env.DEBUG_LOG_FILE_LEVEL = "debug";
    try {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-logger-env-"));
      const logFilePath = path.join(dir, "debug.log");
      const logger = createLogger({
        environment: "development",
        consoleLogLevel: "error",
        consoleLogMode: "full",
        logFilePath,
      });

      logger.debug("file only debug record");
      logger.info("file only info record");
      logger.error("console and file record");

      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const fileOutput = await readFileEventually(logFilePath);
      expect(fileOutput).toContain("file only debug record");
      expect(fileOutput).toContain("file only info record");
      expect(fileOutput).toContain("console and file record");
      await fs.rm(dir, { recursive: true, force: true });
    } finally {
      if (previousDebugLogFileLevel === undefined) {
        delete process.env.DEBUG_LOG_FILE_LEVEL;
      } else {
        process.env.DEBUG_LOG_FILE_LEVEL = previousDebugLogFileLevel;
      }
    }
  });

  it("writes invocation and realtime debug records to the debug file independently from console filtering", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-logger-purpose-file-"));
    const logFilePath = path.join(dir, "debug.log");
    const logger = createLogger({
      environment: "production",
      consoleLogLevel: "error",
      debugLogFileLevel: "debug",
      consoleLogMode: "standard",
      logFilePath,
    });

    runWithCorrelationId("corr-debug-file", () => {
      logger.debug("Provider invocation usage updated", {
        logPurpose: "invocation",
        eventType: "provider_invocation_usage_updated",
        providerInvocationId: "provider-inv-1",
      });
      logger.debug("realtime_snapshot_published", {
        logPurpose: "realtime",
        type: "project.execution.updated",
        projectId: "proj-1",
      });
    });

    expect(stderrSpy).not.toHaveBeenCalled();
    const fileOutput = await readFileEventually(logFilePath);
    const records = fileOutput.trim().split("\n").map((line) => JSON.parse(line));
    expect(records).toEqual([
      expect.objectContaining({
        level: "debug",
        purpose: "invocation",
        correlationId: "corr-debug-file",
        message: "Provider invocation usage updated",
      }),
      expect.objectContaining({
        level: "debug",
        purpose: "realtime",
        correlationId: "corr-debug-file",
        message: "realtime_snapshot_published",
      }),
    ]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("does not open the debug file when file log level is off", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-logger-off-"));
    const logFilePath = path.join(dir, "debug.log");
    const logger = createLogger({
      environment: "development",
      consoleLogLevel: "off",
      debugLogFileLevel: "off",
      logFilePath,
    });

    logger.error("suppressed");

    expect(stderrSpy).not.toHaveBeenCalled();
    await expect(fs.stat(logFilePath)).rejects.toMatchObject({ code: "ENOENT" });
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("redacts sensitive metadata keys", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = createLogger({
      environment: "production",
      level: "debug",
    });

    const error = new Error("auth failed for Authorization: Bearer token123");
    error.stack = "Error: auth failed for Authorization: Bearer token123\n  at fn()";

    const originalMetadata = {
      apiKey: "secret123",
      nested: { token: "secret456", public: "ok" },
      message: "connecting to https://user:pass@example.com",
      errors: [error]
    };

    logger.info("testing secrets", originalMetadata);

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(stderrSpy.mock.calls[0][0]));
    expect(payload.metadata.apiKey).toBe("[REDACTED]");
    expect(payload.metadata.nested.token).toBe("[REDACTED]");
    expect(payload.metadata.nested.public).toBe("ok");
    expect(payload.metadata).toMatchObject({
      apiKey: "[REDACTED]",
      nested: {
        token: "[REDACTED]",
      },
    });

    // Arrays, nested strings, and Error objects should be redacted.
    expect(payload.metadata.message).toBe("connecting to https://[REDACTED]@example.com");
    expect(payload.metadata.errors[0].name).toBe("Error");
    expect(payload.metadata.errors[0].message).toBe("auth failed for Authorization: Bearer [REDACTED]");
    expect(payload.metadata.errors[0].stack).toBe("Error: auth failed for Authorization: Bearer [REDACTED]\n  at fn()");

    // Original metadata must not be mutated
    expect(originalMetadata.apiKey).toBe("secret123");
    expect(originalMetadata.nested.token).toBe("secret456");
    expect(originalMetadata.message).toBe("connecting to https://user:pass@example.com");
    expect(error.message).toBe("auth failed for Authorization: Bearer token123");
  });

  it("redacts deeply nested sensitive metadata without weakening non-sensitive fields", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = createLogger({
      environment: "production",
      level: "debug",
    });

    logger.info("nested metadata", {
      payload: {
        headers: {
          authorization: "Bearer secret-token",
          accept: "application/json",
        },
        attempts: [
          {
            password: "super-secret",
            notes: "OPENAI_API_KEY=sk-test-value and https://user:pass@example.test/path",
          },
        ],
      },
    });

    const payload = JSON.parse(String(stderrSpy.mock.calls[0][0]));
    expect(payload.metadata.payload.headers.authorization).toBe("[REDACTED]");
    expect(payload.metadata.payload.headers.accept).toBe("application/json");
    expect(payload.metadata.payload.attempts[0].password).toBe("[REDACTED]");
    expect(payload.metadata.payload.attempts[0].notes).toBe("OPENAI_API_KEY=[REDACTED] and https://[REDACTED]@example.test/path");
  });
});

describe("correlationIdMiddleware", () => {
  it("reuses incoming correlation id header", () => {
    const middleware = correlationIdMiddleware();
    const req = {
      header: vi.fn((name: string) => (name === CORRELATION_ID_HEADER ? "incoming-id" : undefined)),
    } as any;
    const res = { setHeader: vi.fn() } as any;
    let observedCorrelationId: string | undefined;

    middleware(req, res, () => {
      observedCorrelationId = getCorrelationId();
    });

    expect(observedCorrelationId).toBe("incoming-id");
    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, "incoming-id");
  });

  it("generates a correlation id when header is missing", () => {
    const middleware = correlationIdMiddleware();
    const req = {
      header: vi.fn(() => undefined),
    } as any;
    const res = { setHeader: vi.fn() } as any;
    let observedCorrelationId: string | undefined;

    middleware(req, res, () => {
      observedCorrelationId = getCorrelationId();
    });

    expect(typeof observedCorrelationId).toBe("string");
    expect((observedCorrelationId || "").length).toBeGreaterThan(0);
    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, observedCorrelationId);
  });
});
