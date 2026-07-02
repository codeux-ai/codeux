/** @vitest-environment happy-dom */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { SettingsAgentsPanel } from "../../../dashboard/src/v2/components/settings/panels/SettingsAgentsPanel.js";

expect.extend(matchers);

describe("SettingsAgentsPanel", () => {
  it("does not render Quality Assurance in the Agents panel", () => {
    const updateEditableSettings = vi.fn();

    render(
      <SettingsAgentsPanel
        state={{
          activeScope: "system",
          selectedProject: { id: "proj-1", name: "Test Project" },
          editableSettings: {
            agents: {
              saveToProjectDirectory: true,
              instructionTemplates: { planningMissing: "" },
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
          updateEditableSettings,
        } as any}
      />,
    );

    expect(screen.queryByText("Quality Assurance")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Task completion QA agent preset" })).not.toBeInTheDocument();
    expect(screen.getByText("Agent Routing")).toBeInTheDocument();
    expect(screen.queryByText("Instruction Templates")).not.toBeInTheDocument();
    expect(screen.queryByText("Agent sync behavior")).not.toBeInTheDocument();
    expect(screen.queryByText("Quality assurance behavior")).not.toBeInTheDocument();
    expect(screen.queryByText("Instruction template storage")).not.toBeInTheDocument();
  });
});
