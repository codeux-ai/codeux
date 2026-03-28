import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CORRELATION_ID_HEADER,
  correlationIdMiddleware,
  getCorrelationId,
  runWithCorrelationId,
} from "../../../../src/shared/logging/correlation-id.js";
import { createLogger } from "../../../../src/shared/logging/logger.js";
import * as fs from "fs";

vi.mock("fs", async () => {
    const actualFs = await vi.importActual<typeof import("fs")>("fs");
    return {
        ...actualFs,
        createWriteStream: vi.fn(),
    };
});

describe("createLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs human-readable output in development", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = createLogger({ environment: "development", level: "debug" });

    logger.info("request finished", { method: "GET", statusCode: 200 });

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const output = String(stderrSpy.mock.calls[0][0]);
    expect(output).toContain("INFO");
    expect(output).toContain("request finished");
    expect(output).toContain("method");
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

  it("supports creating child loggers", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = createLogger({ environment: "production", level: "debug", bindings: { parent: "yes" } });
    const childLogger = logger.child({ child: "yes" });

    childLogger.debug("child message");

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(stderrSpy.mock.calls[0][0]));
    expect(payload.metadata).toEqual({ parent: "yes", child: "yes" });
  });

  it("normalizes metadata values", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = createLogger({ environment: "production", level: "debug" });

    const error = new Error("test error");
    error.stack = "test stack";

    logger.error("error happened", {
        err: error,
        arr: [1, new Error("inner")],
        nested: { val: 123 },
        big: BigInt(9007199254740991)
    });

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(stderrSpy.mock.calls[0][0]));
    expect(payload.metadata.err.message).toBe("test error");
    expect(payload.metadata.err.name).toBe("Error");
    expect(payload.metadata.arr[1].message).toBe("inner");
    expect(payload.metadata.nested.val).toBe(123);
    expect(payload.metadata.big).toBe("9007199254740991");
  });

  it("supports file logging", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const mockWriteStream = { write: vi.fn(), on: vi.fn() };
    vi.mocked(fs.createWriteStream).mockReturnValue(mockWriteStream as any);

    const logger = createLogger({ environment: "production", level: "info", logFilePath: "test.log" });
    logger.info("file test");

    expect(fs.createWriteStream).toHaveBeenCalledWith("test.log", { flags: "a" });
    expect(mockWriteStream.write).toHaveBeenCalledWith(expect.stringContaining("file test"));
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
