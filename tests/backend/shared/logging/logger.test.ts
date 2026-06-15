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
import { createLogger } from "../../../../src/shared/logging/logger.js";

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

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(stderrSpy).toHaveBeenCalledTimes(2);
    const fileOutput = await fs.readFile(logFilePath, "utf8");
    expect(fileOutput).not.toContain("visible on console only");
    expect(fileOutput).toContain("visible everywhere");
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
