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
});
