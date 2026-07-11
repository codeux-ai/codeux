import { describe, expect, it } from "vitest";
import { resolveAgentMcpTags } from "../../../dashboard/src/v2/lib/agent-mcp-display.js";

describe("resolveAgentMcpTags", () => {
  it("shows effective runtime Code UX access for the dashboard reply agent", () => {
    const tags = resolveAgentMcpTags({
      codeUxEnabled: false,
      codeUxToolToggles: [],
      linkedServerIds: [],
    }, [], { effectiveCodeUxEnabled: true });

    expect(tags).toEqual([{ id: "code_ux", label: "Code UX · Runtime", kind: "code_ux" }]);
  });

  it("keeps the standard label for persisted Code UX access", () => {
    const tags = resolveAgentMcpTags({
      codeUxEnabled: true,
      codeUxToolToggles: [],
      linkedServerIds: [],
    }, [], { effectiveCodeUxEnabled: true });

    expect(tags[0]?.label).toBe("Code UX");
  });
});
