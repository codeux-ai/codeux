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
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const logger = createLogger({ environment: "development", level: "debug" });

    logger.info("request finished", { method: "GET", statusCode: 200 });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const output = String(infoSpy.mock.calls[0][0]);
    expect(output).toContain("INFO");
    expect(output).toContain("request finished");
    expect(output).toContain("method");
  });

  it("logs JSON output with correlation id in production", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger({
      environment: "production",
      level: "debug",
      bindings: { component: "test" },
    });

    runWithCorrelationId("corr-123", () => {
      logger.error("failed", { reason: "timeout" });
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(errorSpy.mock.calls[0][0]));
    expect(payload.level).toBe("error");
    expect(payload.message).toBe("failed");
    expect(payload.correlationId).toBe("corr-123");
    expect(payload.metadata).toEqual({ component: "test", reason: "timeout" });
  });

  it("respects log level filtering", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = createLogger({ environment: "development", level: "warn" });

    logger.info("skip this");
    logger.warn("keep this");

    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
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
