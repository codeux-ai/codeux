import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CORRELATION_ID_HEADER,
  correlationIdMiddleware,
  getCorrelationId,
  runWithCorrelationId,
} from "../../../../src/shared/logging/correlation-id.js";
import { createLogger } from "../../../../src/shared/logging/logger.js";

describe("createLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs human-readable output in development", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = createLogger({ environment: "development", level: "debug", consoleLogLevel: "full" });

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
    const logger = createLogger({ environment: "development", level: "debug", consoleLogLevel: "standard" });

    logger.info("Dashboard request completed", { logPurpose: "request", method: "GET", statusCode: 200 });
    logger.info("Provider invocation started", { logPurpose: "invocation", provider: "codex" });

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(String(stderrSpy.mock.calls[0][0])).toContain("INVK");
  });

  it("prints request logs when console log level is full", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = createLogger({ environment: "development", level: "debug", consoleLogLevel: "full" });

    logger.info("Dashboard request completed", { logPurpose: "request", method: "GET", statusCode: 200 });

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(String(stderrSpy.mock.calls[0][0])).toContain("HTTP");
  });

  it("emits ANSI-colored classified console output when color is enabled", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = createLogger({ environment: "development", level: "debug", consoleLogLevel: "full", color: true });

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
    const logger = createLogger({ environment: "development", level: "warn" });

    logger.info("skip this");
    logger.warn("keep this");

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const output = String(stderrSpy.mock.calls[0][0]);
    expect(output).not.toContain("skip this");
    expect(output).toContain("keep this");
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
