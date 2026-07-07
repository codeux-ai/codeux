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

  it("accepts the restricted scheduler actions and relative delay fields", async () => {
    const { validateToolArguments } = await import("../../../src/api/mcp/validators/tool-validators.js");

    expect(() => validateToolArguments("scheduler", {
      action: "schedule_wakeup",
      projectId: "project-1",
      delaySeconds: "30",
      bodyMarkdown: "Resume the review.",
      threadId: null,
    })).not.toThrow();

    expect(() => validateToolArguments("scheduler", {
      action: "schedule_task",
      projectId: "project-1",
      delayMinutes: 5,
      taskId: "task-1",
      provider: "codex",
    })).not.toThrow();
  });

  it("rejects scheduler actions and fields reserved for manage_scheduler", async () => {
    const { validateToolArguments } = await import("../../../src/api/mcp/validators/tool-validators.js");

    expect(() => validateToolArguments("scheduler", {
      action: "run_due",
      now: "2026-06-09T12:00:00.000Z",
    })).toThrow("Invalid arguments for tool scheduler");

    expect(() => validateToolArguments("scheduler", {
      action: "schedule_wakeup",
      projectId: "project-1",
      scheduledFor: "2026-06-09T12:00:00.000Z",
      bodyMarkdown: "Resume the review.",
      recurrence: { frequency: "daily" },
    })).toThrow("Invalid arguments for tool scheduler");
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

  it("accepts manage_chat_providers schema actions and nullable secret envelopes", async () => {
    const { validateToolArguments } = await import("../../../src/api/mcp/validators/tool-validators.js");

    expect(() => validateToolArguments("manage_chat_providers", {
      action: "create_connection",
      providerKind: "slack",
      displayName: "Slack bridge",
      bridgeMode: "webhook",
      setup: { eventsUrl: "https://example.test/slack/events" },
      secrets: { signingSecret: "secret-value" },
    })).not.toThrow();

    expect(() => validateToolArguments("manage_chat_providers", {
      action: "update_connection",
      providerConnectionId: "connection-1",
      secrets: null,
      approval: { confirmed: true },
    })).not.toThrow();
  });

  it("rejects invalid manage_chat_providers arguments without echoing secrets", async () => {
    const { validateToolArguments } = await import("../../../src/api/mcp/validators/tool-validators.js");
    const secret = "chat-provider-secret-value";

    try {
      validateToolArguments("manage_chat_providers", {
        action: "create_connection",
        providerKind: "not-a-provider",
        displayName: "Slack bridge",
        secrets: { signingSecret: secret },
      });
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(McpError);
      expect((error as Error).message).toContain("Invalid arguments for tool manage_chat_providers");
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
