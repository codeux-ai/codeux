import { describe, it, expect } from "vitest";
import { buildImprovePrompt, buildPlanPrompt, buildMemoryContext } from "../../../src/services/planning-prompt-builder.js";
import type { AgentPresetRecord } from "../../../src/contracts/agent-preset-types.js";
import type { MemoryRecord } from "../../../src/contracts/memory-types.js";

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
      expect(prompt).toContain("Plan this");
      expect(prompt).toContain("## Constraints");
      expect(prompt).toContain("## Output Rules");
      expect(prompt).toContain("## Task Object Schema");
      expect(prompt).toContain("## Example Output A");
      expect(prompt).toContain("## Example Output B");
      expect(prompt).toContain("## Required Output");
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
