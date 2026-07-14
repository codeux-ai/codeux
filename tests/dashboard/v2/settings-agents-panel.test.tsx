/** @vitest-environment happy-dom */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { useState } from "preact/hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cloneDefaultSettings } from "../../../dashboard/src/lib/settings.js";
import { SettingsAgentsPanel } from "../../../dashboard/src/v2/components/settings/panels/SettingsAgentsPanel.js";
import { SettingsSprintPanel } from "../../../dashboard/src/v2/components/settings/panels/SettingsSprintPanel.js";
import type { ProjectSettings } from "../../../dashboard/src/types.js";

expect.extend(matchers);

afterEach(() => {
  cleanup();
});

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
    expect(screen.getByText("Project Markdown Mirror")).toBeInTheDocument();
    expect(screen.getByText("Persistent Skill Storage")).toBeInTheDocument();
    expect(screen.getByText("Self-Reflection")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage storages" })).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.queryByText("Instruction Templates")).not.toBeInTheDocument();
    expect(screen.queryByText("Agent sync behavior")).not.toBeInTheDocument();
    expect(screen.queryByText("Quality assurance behavior")).not.toBeInTheDocument();
    expect(screen.queryByText("Instruction template storage")).not.toBeInTheDocument();
  });

  it("uses the shared roster selector for orchestrator agents and switches project-scoped edits", async () => {
    const setActiveScope = vi.fn();
    let currentProjectSettings: ProjectSettings = {
      ...cloneDefaultSettings(),
      agents: {
        ...cloneDefaultSettings().agents,
        routing: {
          ...cloneDefaultSettings().agents.routing,
          taskCoding: {
            ...cloneDefaultSettings().agents.routing.taskCoding,
            mode: "ORCHESTRATOR",
            orchestratorAgentPresetIds: [],
          },
        },
      },
    };
    const updateProject = vi.fn((recipe: (current: ProjectSettings) => ProjectSettings) => {
      currentProjectSettings = recipe(currentProjectSettings);
    });

    const renderPanel = () => (
      <SettingsAgentsPanel
        state={{
          activeScope: "system",
          setActiveScope,
          selectedProject: { id: "proj-1", name: "Test Project" },
          editableSettings: currentProjectSettings,
          projectSettings: currentProjectSettings,
          projectSources: {},
          projectAgentPresets: [],
          projectAgentPresetOptions: [
            { value: "agent-risk", label: "Risk Reviewer With A Long Label That Wraps" },
            { value: "agent-ui", label: "UI Delivery Agent" },
          ],
          updateProject,
          updateEditableSettings: vi.fn(),
        } as never}
      />
    );
    const view = render(renderPanel());

    const roster = screen.getByRole("group", { name: "Orchestrator coding agent roster" });
    expect(screen.getByText("No orchestrator agents selected")).toBeInTheDocument();
    expect(within(roster).getByRole("checkbox", { name: "Risk Reviewer With A Long Label That Wraps" })).toHaveAttribute("aria-checked", "false");

    fireEvent.click(within(roster).getByRole("checkbox", { name: "Risk Reviewer With A Long Label That Wraps" }));

    expect(setActiveScope).toHaveBeenCalledWith("project");
    expect(updateProject).toHaveBeenCalled();
    view.rerender(renderPanel());

    await waitFor(() => {
      expect(screen.getByText("1 orchestrator agent selected")).toBeInTheDocument();
      expect(within(screen.getByRole("group", { name: "Orchestrator coding agent roster" })).getByRole("checkbox", { name: "Risk Reviewer With A Long Label That Wraps" })).toHaveAttribute("aria-checked", "true");
    });
    expect(currentProjectSettings.agents.routing.taskCoding.orchestratorAgentPresetIds).toEqual(["agent-risk"]);
  });

  it("explains disabled project-agent selectors and empty orchestrator rosters", () => {
    const settings = cloneDefaultSettings();
    settings.agents.routing.taskCoding.mode = "ORCHESTRATOR";

    render(
      <SettingsAgentsPanel
        state={{
          activeScope: "system",
          setActiveScope: vi.fn(),
          selectedProject: null,
          editableSettings: settings,
          projectSettings: null,
          projectSources: {},
          projectAgentPresets: [],
          projectAgentPresetOptions: [],
          updateProject: vi.fn(),
          updateEditableSettings: vi.fn(),
        } as never}
      />,
    );

    expect(screen.getByText("No project agents are available. Create project agents first, then return here to expose coding specialists to the orchestrator.")).toBeInTheDocument();
    const planningSelect = screen.getByRole("button", { name: "Planning agent preset" });
    expect(planningSelect).toBeDisabled();
    expect(planningSelect).toHaveAccessibleDescription("Select a project to choose custom project agents. Built-in routing remains available.");
    expect(screen.getByText("Project only")).toBeInTheDocument();
    expect(screen.getByText("Project storage unavailable")).toBeInTheDocument();
    expect(screen.getByText("Select a project to attach persistent skill storage to project agents.")).toBeInTheDocument();
  });

  it("renders QA trigger selectors with accessible names and preserves project-scope updates", async () => {
    const setActiveScope = vi.fn();
    const baseSettings = cloneDefaultSettings();
    baseSettings.git.githubMode = "REMOTE";
    baseSettings.agents.qualityAssurance = {
      ...baseSettings.agents.qualityAssurance,
      enabled: true,
      taskCompletion: { enabled: true, agentPresetIds: [], agentPresetId: null },
      sprintCompletion: { enabled: true, agentPresetIds: [], agentPresetId: null },
      completedTaskWithoutPr: { enabled: true, agentPresetIds: [], agentPresetId: null },
    };
    const updateEditableSettings = vi.fn();
    const updateProject = vi.fn();

    const Harness = () => {
      const [projectSettings, setProjectSettings] = useState(baseSettings);
      updateProject.mockImplementation((recipe: (current: ProjectSettings) => ProjectSettings) => {
        setProjectSettings((current) => recipe(current));
      });
      return (
        <SettingsSprintPanel
          state={{
            activeScope: "system",
            setActiveScope,
            selectedProject: { id: "proj-1", name: "Test Project" },
            editableSettings: projectSettings,
            projectSettings,
            projectSources: {},
            projectAgentPresetOptions: [
              { value: "qa-agent-1", label: "Risk Reviewer" },
              { value: "qa-agent-2", label: "QA Agent Beta" },
            ],
            updateProject,
            updateEditableSettings,
          } as never}
        />
      );
    };

    render(<Harness />);

    const taskRoster = screen.getByRole("group", { name: "Task completion QA agent presets" });
    expect(taskRoster).toHaveAccessibleDescription("Built-in QA fallback active. Leave empty to use the built-in QA fallback for this trigger.");
    expect(screen.getByRole("switch", { name: "Review every completed task" })).toBeInTheDocument();

    fireEvent.click(within(taskRoster).getByRole("checkbox", { name: "Risk Reviewer" }));

    expect(setActiveScope).toHaveBeenCalledWith("project");
    await waitFor(() => {
      expect(within(screen.getByRole("group", { name: "Task completion QA agent presets" })).getByRole("checkbox", { name: "Risk Reviewer" })).toHaveAttribute("aria-checked", "true");
      expect(screen.getByText("1 custom QA agent selected.")).toBeInTheDocument();
    });

    const sprintRoster = screen.getByRole("group", { name: "Sprint completion QA agent presets" });
    expect(within(sprintRoster).getByRole("checkbox", { name: "QA Agent Beta" })).toHaveAccessibleDescription("Use this project agent for this QA trigger.");
    expect(screen.getByRole("group", { name: "Completed task without PR QA agent presets" })).toBeInTheDocument();
  });
});
