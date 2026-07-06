import { describe, expect, it, vi } from "vitest";
import {
  generateCorrelationId,
  resolveCorrelationId,
  getCorrelationId,
  runWithCorrelationId,
  runWithResolvedCorrelationId,
  correlationIdMiddleware,
  CORRELATION_ID_HEADER
} from "../../../../src/shared/logging/correlation-id.js";

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
});
