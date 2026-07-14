import { describe, it, expect } from "vitest";
import { buildImprovePrompt, buildPlanPrompt, buildMemoryContext } from "../../../src/services/planning-prompt-builder.js";
import type { AgentPresetRecord } from "../../../src/contracts/agent-preset-types.js";
import type { DesignGuidanceSettings } from "../../../src/contracts/app-types.js";
import type { MemoryRecord } from "../../../src/contracts/memory-types.js";

const guidanceWithSelections: DesignGuidanceSettings = {
  selectedTechStackId: "custom-stack",
  selectedStyleguideId: "custom-style",
  hideDefaultStyleguides: false,
  customTechStacks: [
    {
      id: "custom-stack",
      name: "Repository TypeScript Stack",
      summary: "Use the repository's TypeScript service conventions.",
      instructionMarkdown: "Keep exported APIs typed and cover service behavior with Vitest.",
    },
  ],
  customStyleguides: [
    {
      id: "custom-style",
      name: "Repository Product UI",
      summary: "Use compact, accessible product workflows.",
      instructionMarkdown: "Prefer existing tokens, clear focus states, and responsive controls.",
    },
  ],
};

const guidanceWithNoneSelections: DesignGuidanceSettings = {
  selectedTechStackId: "none",
  selectedStyleguideId: "none",
  hideDefaultStyleguides: false,
  customTechStacks: guidanceWithSelections.customTechStacks,
  customStyleguides: guidanceWithSelections.customStyleguides,
};

describe("PlanningPromptBuilder", () => {
  const mockAgent: AgentPresetRecord = {
    id: "test-agent",
    name: "Test Planning Agent",
    instructionMarkdown: "Custom agent instructions.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as AgentPresetRecord;

  describe("buildImprovePrompt", () => {
    it("should build a basic improve prompt", () => {
      const prompt = buildImprovePrompt({
        projectName: "Test Project",
        planningAgent: mockAgent,
        sprintName: "Sprint 1",
        goal: "Initial goal",
      });

      expect(prompt).toContain("You are Code UX's Planning agent.");
      expect(prompt).toContain("## Planning Agent Instructions");
      expect(prompt).toContain("Custom agent instructions.");
      expect(prompt).toContain("Project: Test Project");
      expect(prompt).toContain("Sprint: Sprint 1");
      expect(prompt).toContain("Initial goal");
      expect(prompt).toContain('{"goal":"Improved sprint prompt"}');
    });

    it("should include memory context if provided", () => {
      const prompt = buildImprovePrompt({
        projectName: "Test Project",
        planningAgent: mockAgent,
        sprintName: "Sprint 1",
        goal: "Initial goal",
        memoryContext: "## PROJECT CONTEXT FROM MEMORY\n- Some memory",
      });

      expect(prompt).toContain("## PROJECT CONTEXT FROM MEMORY");
      expect(prompt).toContain("- Some memory");
    });

    it("should include learnings capture section if provided", () => {
      const prompt = buildImprovePrompt({
        projectName: "Test Project",
        planningAgent: mockAgent,
        sprintName: "Sprint 1",
        goal: "Initial goal",
        learningsInstruction: "Capture these things.",
      });

      expect(prompt).toContain("## LEARNINGS CAPTURE (Required)");
      expect(prompt).toContain("Capture these things.");
    });

    it("includes selected project guidance when improving a prompt", () => {
      const prompt = buildImprovePrompt({
        projectName: "Test Project",
        planningAgent: mockAgent,
        sprintName: "Sprint 1",
        goal: "Initial goal",
        designGuidance: guidanceWithSelections,
      });

      expect(prompt).toContain("## Project Guidance");
      expect(prompt).toContain("### Selected Tech Stack");
      expect(prompt).toContain("Name: Repository TypeScript Stack");
      expect(prompt).toContain("Summary: Use the repository's TypeScript service conventions.");
      expect(prompt).toContain("Keep exported APIs typed and cover service behavior with Vitest.");
      expect(prompt).toContain("### Selected Styleguide");
      expect(prompt).toContain("Name: Repository Product UI");
      expect(prompt).toContain("Prefer existing tokens, clear focus states, and responsive controls.");
    });
  });

  describe("buildPlanPrompt", () => {
    it("should build a basic plan prompt", () => {
      const prompt = buildPlanPrompt({
        projectName: "Test Project",
        planningAgent: mockAgent,
        sprintNumber: 1,
        sprintName: "Sprint One",
        goal: "Plan this",
      });

      expect(prompt).toContain("You are Code UX's Planning agent.");
      expect(prompt).toContain("Custom agent instructions.");
      expect(prompt).toContain("Sprint: SPR-1");
      expect(prompt).toContain("Sprint Name: Sprint One");
      expect(prompt).toContain("Sprint Title Status: custom user title; do not rename it");
      expect(prompt).toContain("Do not include top-level `title`");
      expect(prompt).toContain("Plan this");
      expect(prompt).toContain("## Constraints");
      expect(prompt).toContain("## Output Rules");
      expect(prompt).toContain("## Task Object Schema");
      expect(prompt).toContain("## Example Output A");
      expect(prompt).toContain("## Example Output B");
      expect(prompt).toContain("## Required Output");
      expect(prompt).toContain("never compress the plan into an arbitrary numerical target");
      expect(prompt).toContain("dependency-injection/registration path");
      expect(prompt).toContain("restart/reconnect");
      expect(prompt).toContain("executable integration/E2E coverage");
      expect(prompt).toContain("observable acceptance signal");
      expect(prompt).toContain("Their task counts are not recommendations");
      expect(prompt).not.toContain("Prefer 3 to 8 tasks");
    });

    it("should use sprint name if number is null", () => {
      const prompt = buildPlanPrompt({
        projectName: "Test Project",
        planningAgent: mockAgent,
        sprintNumber: null,
        sprintName: "Ad-hoc Sprint",
        goal: "Plan this",
      });

      expect(prompt).toContain("Sprint: Ad-hoc Sprint");
    });

    it("allows an optional sprint title only when the current title is generated", () => {
      const prompt = buildPlanPrompt({
        projectName: "Test Project",
        planningAgent: mockAgent,
        sprintNumber: 1,
        sprintName: "Untitled sprint 1",
        canSetSprintTitle: true,
        goal: "Plan this",
      });

      expect(prompt).toContain("Sprint Title Status: unset/generated; you may provide a concise title");
      expect(prompt).toContain("You may include top-level `title`");
      expect(prompt).toContain('"title":"Optional concise sprint title"');
    });

    it("should include memory context and learnings capture", () => {
      const prompt = buildPlanPrompt({
        projectName: "Test Project",
        planningAgent: mockAgent,
        sprintNumber: 1,
        sprintName: "Sprint One",
        goal: "Plan this",
        memoryContext: "## PROJECT CONTEXT FROM MEMORY\n- Memory note",
        learningsInstruction: "Note these learnings.",
      });

      expect(prompt).toContain("## PROJECT CONTEXT FROM MEMORY");
      expect(prompt).toContain("- Memory note");
      expect(prompt).toContain("## LEARNINGS CAPTURE (Required)");
      expect(prompt).toContain("Note these learnings.");
    });

    it("includes coding agent roster when orchestrator routing is active", () => {
      const prompt = buildPlanPrompt({
        projectName: "Test Project",
        planningAgent: mockAgent,
        codingAgentRoster: [
          { ...mockAgent, id: "frontend-agent", name: "Frontend Coder", description: "Preact UI and accessibility." },
          { ...mockAgent, id: "backend-agent", name: "Backend Coder", description: "API and persistence." },
        ],
        sprintNumber: 1,
        sprintName: "Sprint One",
        goal: "Plan this",
      });

      expect(prompt).toContain("## Coding Agent Routing");
      expect(prompt).toContain("frontend-agent: Frontend Coder - Preact UI and accessibility.");
      expect(prompt).toContain('"agentPresetId": "agent-preset-id"');
    });

    it("includes selected project guidance in planning prompts", () => {
      const prompt = buildPlanPrompt({
        projectName: "Test Project",
        planningAgent: mockAgent,
        sprintNumber: 1,
        sprintName: "Sprint One",
        goal: "Plan this",
        designGuidance: guidanceWithSelections,
      });

      expect(prompt).toContain("## Project Guidance");
      expect(prompt).toContain("### Selected Tech Stack");
      expect(prompt).toContain("Name: Repository TypeScript Stack");
      expect(prompt).toContain("Summary: Use the repository's TypeScript service conventions.");
      expect(prompt).toContain("Keep exported APIs typed and cover service behavior with Vitest.");
      expect(prompt).toContain("### Selected Styleguide");
      expect(prompt).toContain("Name: Repository Product UI");
      expect(prompt).toContain("Prefer existing tokens, clear focus states, and responsive controls.");
    });

    it("omits project guidance when selections are none", () => {
      const prompt = buildPlanPrompt({
        projectName: "Test Project",
        planningAgent: mockAgent,
        sprintNumber: 1,
        sprintName: "Sprint One",
        goal: "Plan this",
        designGuidance: guidanceWithNoneSelections,
      });

      expect(prompt).not.toContain("## Project Guidance");
      expect(prompt).not.toContain("Repository TypeScript Stack");
      expect(prompt).not.toContain("Repository Product UI");
      expect(prompt).not.toContain("No additional project guidance is selected.");
    });
  });

  describe("buildMemoryContext", () => {
    it("should return undefined if no memories provided", () => {
      expect(buildMemoryContext([], [])).toBeUndefined();
    });

    it("should format long-term memories", () => {
      const longTerm: MemoryRecord[] = [
        { category: "architecture", content: "Use layered architecture." } as MemoryRecord,
      ];
      const context = buildMemoryContext(longTerm, []);

      expect(context).toContain("## PROJECT CONTEXT FROM MEMORY");
      expect(context).toContain("### Long-Term Knowledge");
      expect(context).toContain("- [architecture] Use layered architecture.");
    });

    it("should format short-term memories", () => {
      const shortTerm: MemoryRecord[] = [
        { category: "decision", content: "Used Preact for speed." } as MemoryRecord,
      ];
      const context = buildMemoryContext([], shortTerm);

      expect(context).toContain("## PROJECT CONTEXT FROM MEMORY");
      expect(context).toContain("### Recent Sprint Learnings");
      expect(context).toContain("- [decision] Used Preact for speed.");
    });

    it("should truncate long memory content", () => {
      const longTerm: MemoryRecord[] = [
        { category: "info", content: "A".repeat(500) } as MemoryRecord,
      ];
      const context = buildMemoryContext(longTerm, []);

      expect(context?.length).toBeLessThan(500);
      expect(context).toContain("A".repeat(300));
      expect(context).not.toContain("A".repeat(301));
    });
  });
});
