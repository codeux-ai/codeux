/** @vitest-environment jsdom */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { SettingsAgentsPanel } from "../../../dashboard/src/v2/components/settings/panels/SettingsAgentsPanel.js";

expect.extend(matchers);

if (typeof window !== "undefined" && !window.requestAnimationFrame) {
  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    return setTimeout(() => callback(performance.now()), 0);
  };
  window.cancelAnimationFrame = (id: number) => clearTimeout(id);
}

describe("SettingsAgentsPanel", () => {
  it("shows QA above templates and keeps QA preset selectors enabled with project presets", async () => {
    const setActiveScope = vi.fn();
    const updateProject = vi.fn();
    const updateEditableSettings = vi.fn();

    render(
      <SettingsAgentsPanel
        state={{
          activeScope: "system",
          setActiveScope,
          selectedProject: { id: "proj-1", name: "Test Project" },
          editableSettings: {
            agents: {
              saveToProjectDirectory: true,
              instructionTemplates: { planningMissing: "" },
              qualityAssurance: {
                enabled: false,
                maxTaskReviewRuns: 1,
                taskCompletion: { enabled: true, agentPresetId: null },
                sprintCompletion: { enabled: true, agentPresetId: null },
                completedTaskWithoutPr: { enabled: true, agentPresetId: null },
              },
            },
          },
          projectSettings: {
            agents: {
              saveToProjectDirectory: true,
              instructionTemplates: { planningMissing: "" },
              qualityAssurance: {
                enabled: true,
                maxTaskReviewRuns: 2,
                taskCompletion: { enabled: true, agentPresetId: null },
                sprintCompletion: { enabled: true, agentPresetId: null },
                completedTaskWithoutPr: { enabled: true, agentPresetId: null },
              },
            },
          },
          projectSources: {},
          selectedAgentTemplate: "planningMissing",
          setSelectedAgentTemplate: vi.fn(),
          agentInstructionTemplateOptions: [
            { value: "planningMissing", label: "Planning Missing", description: "Template" },
          ],
          projectAgentPresetOptions: [
            { value: "qa-agent-2", label: "QA Agent Beta" },
            { value: "qa-agent-1", label: "Risk Reviewer" },
            { value: "worker-1", label: "Delivery Agent" },
          ],
          updateProject,
          updateEditableSettings,
        } as any}
      />,
    );

    const qaHeading = screen.getByText("Quality Assurance");
    const templateHeading = screen.getByText("Instruction Templates");
    expect(
      Boolean(qaHeading.compareDocumentPosition(templateHeading) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);

    const presetTrigger = screen.getByRole("button", { name: "Task completion QA agent preset" });
    expect(presetTrigger).not.toBeDisabled();

    fireEvent.click(presetTrigger);

    await waitFor(() => {
      expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
        "Built-in QA agent",
        "QA Agent Beta",
        "Risk Reviewer",
        "Delivery Agent",
      ]);
    });

    fireEvent.click(screen.getByRole("option", { name: "QA Agent Beta" }));

    expect(setActiveScope).toHaveBeenCalledWith("project");
    expect(updateProject).toHaveBeenCalled();
  });
});
