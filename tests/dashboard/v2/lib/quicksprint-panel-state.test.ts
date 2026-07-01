import { describe, it, expect } from "vitest";
import {
  getBuiltinTemplates,
  getCustomTemplates,
  getBuiltinPurposeOptions,
  getActiveBuiltinPurpose,
  getVisibleBuiltinTemplates,
  getCombinedPrompt,
} from "../../../../dashboard/src/v2/lib/quicksprint-panel-state.js";
import type { QuicksprintTemplateRecord } from "../../../../src/contracts/quicksprint-types.js";
import type { AgentPreset } from "../../../../dashboard/src/v2/types.js";

function createTemplate(overrides: Partial<QuicksprintTemplateRecord>): QuicksprintTemplateRecord {
  return {
    id: "test",
    projectId: null,
    name: "Test",
    description: "Test description",
    icon: "Zap",
    category: "test",
    agentInstructionMarkdown: "Test prompt",
    defaultTaskCount: 5,
    isBuiltIn: false,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("Quicksprint Panel State", () => {
  describe("getBuiltinTemplates", () => {
    it("returns only built-in templates", () => {
      const templates = [
        createTemplate({ isBuiltIn: true }),
        createTemplate({ isBuiltIn: false }),
      ];
      expect(getBuiltinTemplates(templates)).toHaveLength(1);
    });
  });

  describe("getCustomTemplates", () => {
    it("returns only custom templates", () => {
      const templates = [
        createTemplate({ isBuiltIn: true }),
        createTemplate({ isBuiltIn: false }),
      ];
      expect(getCustomTemplates(templates)).toHaveLength(1);
    });
  });

  describe("getBuiltinPurposeOptions", () => {
    it("extracts unique purposes from built-in templates", () => {
      const templates = [
        createTemplate({ isBuiltIn: true, purpose: "purpose-a", purposeLabel: "Purpose A" }),
        createTemplate({ isBuiltIn: true, purpose: "purpose-a", purposeLabel: "Purpose A Duplicate" }),
        createTemplate({ isBuiltIn: true, purpose: undefined, purposeLabel: undefined }), // should map to 'general'
      ];
      const options = getBuiltinPurposeOptions(templates);
      expect(options).toHaveLength(2);
      expect(options[0]).toEqual({ value: "purpose-a", label: "Purpose A", description: undefined });
      expect(options[1]).toEqual({ value: "general", label: "General", description: undefined });
    });

    it("returns empty for empty templates", () => {
      expect(getBuiltinPurposeOptions([])).toEqual([]);
    });
  });

  describe("getActiveBuiltinPurpose", () => {
    const options = [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ];

    it("finds the matched purpose", () => {
      expect(getActiveBuiltinPurpose(options, "b")).toEqual(options[1]);
    });

    it("falls back to the first option if not found", () => {
      expect(getActiveBuiltinPurpose(options, "c")).toEqual(options[0]);
    });

    it("returns null if options are empty", () => {
      expect(getActiveBuiltinPurpose([], "a")).toBeNull();
    });
  });

  describe("getVisibleBuiltinTemplates", () => {
    const templates = [
      createTemplate({ isBuiltIn: true, purpose: "a" }),
      createTemplate({ isBuiltIn: true, purpose: "b" }),
      createTemplate({ isBuiltIn: true, purpose: undefined }), // general
    ];

    it("returns all templates if no active purpose", () => {
      expect(getVisibleBuiltinTemplates(templates, null)).toHaveLength(3);
    });

    it("filters templates by active purpose", () => {
      expect(getVisibleBuiltinTemplates(templates, { value: "a", label: "A" })).toHaveLength(1);
      expect(getVisibleBuiltinTemplates(templates, { value: "b", label: "B" })).toHaveLength(1);
      expect(getVisibleBuiltinTemplates(templates, { value: "general", label: "General" })).toHaveLength(1);
    });
  });

  describe("getCombinedPrompt", () => {
    it("returns empty string if no template selected", () => {
      expect(getCombinedPrompt(null, [], "", 5)).toBe("");
    });

    it("combines template, agent, and additional prompts", () => {
      const template = createTemplate({
        agentInstructionMarkdown: "Template instructions.",
        agentPresetId: "agent-1",
      });
      const agents: AgentPreset[] = [
        {
          id: "agent-1",
          projectId: "p1",
          name: "Agent One",
          description: "Desc",
          instructionMarkdown: "Agent instructions.",
          labels: [],
          sourcePath: null,
          sourceScope: null,
          sourceExists: false,
          sourceUpdatedAt: null,
          sourceImportedAt: null,
          syncStatus: "manual",
          createdAt: "",
          updatedAt: "",
        },
      ];

      const result = getCombinedPrompt(template, agents, "Extra bits.", 3);
      expect(result).toContain("## Agent Context");
      expect(result).toContain("You are operating as the \"Agent One\" agent.");
      expect(result).toContain("Agent instructions.");
      expect(result).toContain("Template instructions.");
      expect(result).toContain("## Additional Instructions");
      expect(result).toContain("Extra bits.");
      expect(result).toContain("Produce exactly 3 subtasks.");
    });

    it("handles missing agent gracefully", () => {
      const template = createTemplate({
        agentInstructionMarkdown: "Template instructions.",
        agentPresetId: "agent-missing",
      });

      const result = getCombinedPrompt(template, [], "", 5);
      expect(result).not.toContain("## Agent Context");
      expect(result).toContain("Template instructions.");
      expect(result).toContain("Produce exactly 5 subtasks.");
    });
  });
});
