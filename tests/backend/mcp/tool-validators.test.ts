import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { validateToolArguments } from "../../../src/api/mcp/validators/tool-validators.js";

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

  it.each([
    ["project", "manage_projects", { action: "archive" }],
    ["sprint", "manage_sprints", { action: "launch" }],
    ["task", "manage_tasks", { action: "rerun_everything" }],
    ["telemetry", "manage_telemetry", { action: "dump_raw_events" }],
    ["settings", "manage_settings", { action: "write_secret" }],
  ] as const)("rejects unknown %s action values as deterministic validation failures", (_label, toolName, body) => {
    expect(() => validateToolArguments(toolName, body)).toThrow(McpError);

    try {
      validateToolArguments(toolName, body);
    } catch (error) {
      expect(error).toBeInstanceOf(McpError);
      expect((error as McpError).code).toBe(ErrorCode.InvalidParams);
      expect((error as Error).message).toContain(`Invalid arguments for tool ${toolName}`);
      expect((error as Error).message).toContain("must be equal to one of the allowed values");
    }
  });

  it.each([
    ["project", "manage_projects", {}],
    ["sprint", "manage_sprints", { action: 42 }],
    ["task", "manage_tasks", { action: null }],
    ["telemetry", "manage_telemetry", []],
    ["settings", "manage_settings", "patch_system_setting"],
  ] as const)("rejects malformed %s bodies as deterministic validation failures", (_label, toolName, body) => {
    try {
      validateToolArguments(toolName, body);
      expect.unreachable("validation should reject malformed MCP tool arguments");
    } catch (error) {
      expect(error).toBeInstanceOf(McpError);
      expect((error as McpError).code).toBe(ErrorCode.InvalidParams);
      expect((error as Error).message).toContain(`Invalid arguments for tool ${toolName}`);
    }
  });
});
