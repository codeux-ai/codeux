import { describe, expect, it } from "vitest";
import { runWithCorrelationId } from "../../../../src/shared/logging/correlation-id.js";
import { createLogger } from "../../../../src/shared/logging/logger.js";

describe("createLogger", () => {
  it("emits human-readable logs in development with correlation IDs", () => {
    const lines: string[] = [];
    const logger = createLogger({
      environment: "development",
      sink: (line) => lines.push(line),
    });

    runWithCorrelationId("cid-dev-123", () => {
      logger.info("Dashboard request started", {
        method: "GET",
        path: "/api/status",
      });
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("INFO ");
    expect(lines[0]).toContain("[cid:cid-dev-123]");
    expect(lines[0]).toContain("Dashboard request started");
    expect(lines[0]).toContain('"path":"/api/status"');
  });

  it("emits JSON logs in production with metadata and correlation IDs", () => {
    const lines: string[] = [];
    const logger = createLogger({
      environment: "production",
      sink: (line) => lines.push(line),
    });

    runWithCorrelationId("cid-prod-789", () => {
      logger.error("Tool execution failed", {
        toolName: "sprint_agent",
        reason: "timeout",
      });
    });

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as {
      level: string;
      message: string;
      correlationId?: string;
      metadata?: Record<string, unknown>;
    };
    expect(parsed.level).toBe("error");
    expect(parsed.message).toBe("Tool execution failed");
    expect(parsed.correlationId).toBe("cid-prod-789");
    expect(parsed.metadata?.toolName).toBe("sprint_agent");
  });

  it("filters out logs below the configured minimum level", () => {
    const lines: string[] = [];
    const logger = createLogger({
      environment: "production",
      minLevel: "warn",
      sink: (line) => lines.push(line),
    });

    logger.info("This should be filtered");
    logger.warn("This should be logged");

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as { level: string; message: string };
    expect(parsed.level).toBe("warn");
    expect(parsed.message).toBe("This should be logged");
  });

  it("merges child bindings and serializes error metadata", () => {
    const lines: string[] = [];
    const logger = createLogger({
      environment: "production",
      minLevel: "debug",
      sink: (line) => lines.push(line),
    }).child({ component: "router" });

    runWithCorrelationId("cid-child-555", () => {
      logger.debug("Dispatch failure", {
        error: new Error("boom"),
      });
    });

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as {
      metadata?: {
        component?: string;
        error?: { message?: string; name?: string };
      };
      correlationId?: string;
    };
    expect(parsed.correlationId).toBe("cid-child-555");
    expect(parsed.metadata?.component).toBe("router");
    expect(parsed.metadata?.error?.name).toBe("Error");
    expect(parsed.metadata?.error?.message).toBe("boom");
  });
});
