/** @vitest-environment happy-dom */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { DEFAULT_DASHBOARD_SETTINGS, cloneDefaultSettings } from "../../../dashboard/src/lib/settings.js";
import { SettingsAgentsPanel } from "../../../dashboard/src/v2/components/settings/panels/SettingsAgentsPanel.js";
import type { AgentPreset } from "../../../dashboard/src/v2/types.js";
import type { ProjectSettings } from "../../../dashboard/src/types.js";
import { fetchSkillStorages, updateAgentPreset } from "../../../dashboard/src/v2/lib/agent-preset-api.js";

expect.extend(matchers);

vi.mock("../../../dashboard/src/v2/lib/agent-preset-api.js", () => ({
  fetchSkillStorages: vi.fn(),
  createSkillStorage: vi.fn(),
  deleteSkillStorage: vi.fn(),
  updateAgentPreset: vi.fn(),
}));

const makeProjectSettings = (): ProjectSettings => ({
  ...cloneDefaultSettings(),
  agents: {
    ...cloneDefaultSettings().agents,
    selfReflection: {
      planning: {
        enabled: false,
        maxImprovementAttempts: 1,
        criteria: [
          {
            id: "planning_contract",
            label: "Planning contract",
            prompt: "The plan covers the persistent skills contract.",
            threshold: 0.8,
          },
        ],
      },
      qualityAssurance: {
        ...DEFAULT_DASHBOARD_SETTINGS.agents.selfReflection.qualityAssurance,
        criteria: DEFAULT_DASHBOARD_SETTINGS.agents.selfReflection.qualityAssurance.criteria.map((criterion) => ({ ...criterion })),
      },
    },
  },
});

describe("SettingsAgentsPanel persistent skills and self-reflection", () => {
  it("preserves storage attachment edits and reflection criteria in generated save payloads", async () => {
    vi.mocked(fetchSkillStorages).mockResolvedValue([
      {
        id: "skills-shared",
        projectId: "project-settings",
        name: "Shared Skills",
        description: "Reusable instructions",
        storageKind: "project",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    vi.mocked(updateAgentPreset).mockImplementation(async (_agentPresetId, input) => ({
      id: "agent-settings",
      projectId: "project-settings",
      name: "Settings Agent",
      description: "",
      instructionMarkdown: "",
      labels: [],
      providerConfigId: null,
      model: null,
      memoryTemplateOverrideEnabled: false,
      memoryTemplateMarkdown: "",
      mcpAccess: { codeUxEnabled: true, codeUxToolToggles: [], linkedServerIds: [] },
      memoryConfig: null,
      persistentSkillStorageIds: input.persistentSkillStorageIds ?? [],
      persistentSkillStorage: input.persistentSkillStorage,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as AgentPreset));
    let currentProjectSettings = makeProjectSettings();
    const updateProject = vi.fn((recipe: (current: ProjectSettings) => ProjectSettings) => {
      currentProjectSettings = recipe(currentProjectSettings);
    });
    const presets: AgentPreset[] = [
      {
        id: "agent-settings",
        projectId: "project-settings",
        name: "Settings Agent",
        description: "",
        instructionMarkdown: "",
        labels: [],
        providerConfigId: null,
        model: null,
        memoryTemplateOverrideEnabled: false,
        memoryTemplateMarkdown: "",
        mcpAccess: { codeUxEnabled: true, codeUxToolToggles: [], linkedServerIds: [] },
        memoryConfig: null,
        persistentSkillStorageIds: [],
        persistentSkillStorage: { enabled: false },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    const renderPanel = () => (
      <SettingsAgentsPanel
        state={{
          activeScope: "project",
          setActiveScope: vi.fn(),
          selectedProject: { id: "project-settings", name: "Generic Settings Project" },
          editableSettings: currentProjectSettings,
          projectSettings: currentProjectSettings,
          projectSources: {},
          projectAgentPresets: presets,
          projectAgentPresetOptions: [{ value: "agent-settings", label: "Settings Agent" }],
          updateProject,
          updateEditableSettings: vi.fn(),
        } as never}
      />
    );
    const view = render(renderPanel());

    await waitFor(() => {
      expect(screen.getAllByText("Shared Skills").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByLabelText("Shared Skills"));
    await waitFor(() => {
      expect(updateAgentPreset).toHaveBeenCalledWith("agent-settings", {
        persistentSkillStorageIds: ["skills-shared"],
        persistentSkillStorage: { enabled: false },
      });
    });

    fireEvent.click(screen.getByRole("switch", { name: "Enable persistent skills for Settings Agent" }));
    await waitFor(() => {
      expect(updateAgentPreset).toHaveBeenLastCalledWith("agent-settings", {
        persistentSkillStorageIds: ["skills-shared"],
        persistentSkillStorage: { enabled: true },
      });
    });

    fireEvent.input(screen.getByDisplayValue("Planning contract"), {
      target: { value: "Planning contract improved" },
    });
    view.rerender(renderPanel());
    fireEvent.input(screen.getByDisplayValue("The plan covers the persistent skills contract."), {
      target: { value: "The plan covers storage sharing, runtime injection, and MCP retrieval." },
    });
    view.rerender(renderPanel());
    fireEvent.input(screen.getByLabelText("Planning contract improved threshold"), {
      target: { value: "0.9" },
    });

    expect(currentProjectSettings.agents.selfReflection.planning.criteria[0]).toEqual({
      id: "planning_contract",
      label: "Planning contract improved",
      prompt: "The plan covers storage sharing, runtime injection, and MCP retrieval.",
      threshold: 0.9,
    });
    expect(currentProjectSettings.agents.selfReflection.qualityAssurance.enabled).toBe(false);
  });
});
