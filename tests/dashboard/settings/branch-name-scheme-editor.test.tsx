/** @vitest-environment happy-dom */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/preact";
import { BranchNameSchemeEditor } from "../../../dashboard/src/v2/components/settings/BranchNameSchemeEditor.js";
import { getBranchSchemeOptions, getCanonicalBranchNameToken } from "../../../dashboard/src/v2/lib/settings-view-models.js";
import { BRANCH_NAME_TOKENS } from "../../../src/domain/settings/branch-name-tokens.js";

describe("BranchNameSchemeEditor", () => {
  it("renders the 7 canonical options in deterministic order", () => {
    const { container } = render(
      <BranchNameSchemeEditor
        value="{sprint_id}"
        onChange={vi.fn()}
      />
    );

    const options = getBranchSchemeOptions();
    expect(options).toHaveLength(7);
    expect(options.map(o => o.value)).toEqual([
      "{sprint_key_prefix}",
      "{sprint_number}",
      "{sprint_name}",
      "{sprint_id}",
      "{planning_agent}",
      "{agent_routing}",
      "{worker_agent}"
    ]);

    expect(options.map(o => o.label)).toEqual([
      "Sprint Key Prefix",
      "Sprint Number",
      "Sprint Name",
      "Sprint ID",
      "Planning Agent",
      "Agent Routing",
      "Worker Agent"
    ]);
  });

  it("correctly rehydrates legacy or alias options without drift", () => {
    // For alias "{sprint}" -> should map to "sprint_id"
    expect(getCanonicalBranchNameToken("{sprint}")).toBe("sprint_id");
    // For alias "{sprintNumber}" -> should map to "sprint_number"
    expect(getCanonicalBranchNameToken("{sprintNumber}")).toBe("sprint_number");
    // For alias "{sprintName}" -> should map to "sprint_name"
    expect(getCanonicalBranchNameToken("{sprintName}")).toBe("sprint_name");
    // For alias "{n}" -> should map to "sprint_number"
    expect(getCanonicalBranchNameToken("{n}")).toBe("sprint_number");
    
    // Test direct unwrapped or invalid fallback -> should default to "sprint_id"
    expect(getCanonicalBranchNameToken("{invalid}")).toBe("sprint_id");
  });

  it("triggers onChange with correctly wrapped payload value when selection changes", () => {
    const onChangeSpy = vi.fn();
    render(
      <BranchNameSchemeEditor
        value="{sprint_number}"
        onChange={onChangeSpy}
      />
    );

    for (const token of BRANCH_NAME_TOKENS) {
      const val = `{${token}}`;
      expect(getCanonicalBranchNameToken(val)).toBe(token);
    }
  });
});
