import { describe, expect, it, vi } from "vitest";
import {
  extractCorrelationIdFromHeaders,
  generateCorrelationId,
  resolveCorrelationId,
  getCorrelationId,
  runWithCorrelationId,
  runWithResolvedCorrelationId,
  correlationIdMiddleware,
  CORRELATION_ID_HEADER
} from "../../../../src/shared/logging/correlation-id.js";
import { createLogger } from "../../../../src/shared/logging/logger.js";

describe("correlation-id", () => {
    it("resolveCorrelationId", () => {
        expect(resolveCorrelationId(" id ")).toBe("id");
        expect(resolveCorrelationId("")).toMatch(/^[0-9a-f-]+$/);
        expect(resolveCorrelationId(null)).toMatch(/^[0-9a-f-]+$/);
    });

    it("context handling", () => {
        expect(getCorrelationId()).toBeUndefined();
        runWithCorrelationId("test-id", () => {
            expect(getCorrelationId()).toBe("test-id");
        });
        expect(getCorrelationId()).toBeUndefined();

        runWithResolvedCorrelationId(() => {
            expect(getCorrelationId()).toMatch(/^[0-9a-f-]+$/);
        });

        runWithResolvedCorrelationId(() => {
            expect(getCorrelationId()).toBe("resolved-id");
        }, "resolved-id");
    });

    it("correlationIdMiddleware handles string array headers", () => {
        const middleware = correlationIdMiddleware();
        const req = {
            header: (name: string) => {
                if (name === CORRELATION_ID_HEADER) return ["", "id-from-array"];
                return undefined;
            }
        };
        const res = { setHeader: vi.fn() };
        let nextCalled = false;

        middleware(req as any, res as any, () => {
            expect(getCorrelationId()).toBe("id-from-array");
            nextCalled = true;
        });

        expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, "id-from-array");
        expect(nextCalled).toBe(true);
    });

    it("prefers x-correlation-id over x-request-id and trims header values", () => {
        expect(extractCorrelationIdFromHeaders({
            [CORRELATION_ID_HEADER]: " corr-id ",
            "x-request-id": "request-id",
        })).toBe("corr-id");
    });

    it("falls back to x-request-id when x-correlation-id is blank", () => {
        const middleware = correlationIdMiddleware();
        const req = {
            header: (name: string) => {
                if (name === CORRELATION_ID_HEADER) return "   ";
                if (name === "x-request-id") return " request-id ";
                return undefined;
            }
        };
        const res = { setHeader: vi.fn() };

        middleware(req as any, res as any, () => {
            expect(getCorrelationId()).toBe("request-id");
        });

        expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, "request-id");
    });

    it("falls back to first non-blank request id array entry", () => {
        expect(extractCorrelationIdFromHeaders({
            [CORRELATION_ID_HEADER]: ["", "   "],
            "x-request-id": ["", "array-request-id"],
        })).toBe("array-request-id");
    });

    it("generates and returns a response header when all incoming headers are blank", () => {
        const middleware = correlationIdMiddleware();
        const req = {
            header: () => [" ", ""],
        };
        const res = { setHeader: vi.fn() };

        middleware(req as any, res as any, () => {
            expect(getCorrelationId()).toMatch(/^[0-9a-f-]+$/);
        });

        expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, expect.stringMatching(/^[0-9a-f-]+$/));
    });

    it("correlationIdMiddleware handles array header without valid string", () => {
        const middleware = correlationIdMiddleware();
        const req = {
            header: (name: string) => {
                if (name === CORRELATION_ID_HEADER) return ["  ", ""];
                return undefined;
            }
        };
        const res = { setHeader: vi.fn() };

        middleware(req as any, res as any, () => {
            expect(getCorrelationId()).toMatch(/^[0-9a-f-]+$/);
        });
    });

    it("propagates async context into nested logger calls", async () => {
        const savedForcedLogLevel = process.env.CODEUX_FORCE_LOG_LEVEL;
        delete process.env.CODEUX_FORCE_LOG_LEVEL;
        const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        try {
            const logger = createLogger({ environment: "production", level: "debug" });

            await runWithCorrelationId("async-corr", async () => {
                await Promise.resolve();
                logger.info("outer async log");
                await new Promise<void>((resolve) => {
                    setTimeout(() => {
                        logger.warn("nested async log");
                        resolve();
                    }, 0);
                });
            });

            const records = stderrSpy.mock.calls.map((call) => JSON.parse(String(call[0])));
            expect(records).toHaveLength(2);
            expect(records.map((record) => record.correlationId)).toEqual(["async-corr", "async-corr"]);
        } finally {
            stderrSpy.mockRestore();
            if (savedForcedLogLevel === undefined) {
                delete process.env.CODEUX_FORCE_LOG_LEVEL;
            } else {
                process.env.CODEUX_FORCE_LOG_LEVEL = savedForcedLogLevel;
            }
        }
    });
});
