import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("tool argument validators", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("compiles numeric string union schemas without Ajv strict-mode warnings", async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { validateToolArguments } = await import("../../../src/api/mcp/validators/tool-validators.js");

    expect(() => validateToolArguments("manage_quicksprints", {
      action: "execute",
      projectId: "project-1",
      templateId: "template-1",
      taskCount: "5",
    })).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it("rejects missing required tool arguments without dispatch-time parsing", async () => {
    const { validateToolArguments } = await import("../../../src/api/mcp/validators/tool-validators.js");

    expect(() => validateToolArguments("manage_quicksprints", {
      projectId: "project-1",
      templateId: "template-1",
    })).toThrow(McpError);
    expect(() => validateToolArguments("manage_quicksprints", {
      projectId: "project-1",
      templateId: "template-1",
    })).toThrow("Invalid arguments for tool manage_quicksprints");
  });

  it("rejects invalid enum values and does not echo secret payload values", async () => {
    const { validateToolArguments } = await import("../../../src/api/mcp/validators/tool-validators.js");
    const secret = "sk-live-secret-value";

    try {
      validateToolArguments("manage_quicksprints", {
        action: "execute_now",
        projectId: "project-1",
        templateId: "template-1",
        additionalPrompt: secret,
      });
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(McpError);
      expect((error as Error).message).toContain("Invalid arguments for tool manage_quicksprints");
      expect((error as Error).message).toContain("must be equal to one of the allowed values");
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it("rejects unexpected management payload and approval envelope shapes", async () => {
    const { validateToolArguments } = await import("../../../src/api/mcp/validators/tool-validators.js");

    expect(() => validateToolArguments("manage_code_ux", {
      domain: "settings",
      action: "replace_system_settings",
      payload: ["not", "an", "object"],
    })).toThrow("'/payload' must be object");

    expect(() => validateToolArguments("manage_settings", {
      action: "patch_system_setting",
      path: "integrations.julesApiKey",
      value: "redacted",
      approval: { confirmed: "true" },
    })).toThrow("'/approval/confirmed' must be boolean");
  });
});
