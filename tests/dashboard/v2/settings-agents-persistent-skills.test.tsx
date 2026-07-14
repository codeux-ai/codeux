/** @vitest-environment happy-dom */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { useState } from "preact/hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { DEFAULT_DASHBOARD_SETTINGS, cloneDefaultSettings } from "../../../dashboard/src/lib/settings.js";
import { SettingsAgentsPanel } from "../../../dashboard/src/v2/components/settings/panels/SettingsAgentsPanel.js";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/index.js";
import type { AgentPreset } from "../../../dashboard/src/v2/types.js";
import type { ProjectSettings } from "../../../dashboard/src/types.js";
import {
  createSkillStorage,
  deleteSkillStorage,
  fetchSkillStorageContents,
  fetchSkillStorages,
  updateAgentPreset,
} from "../../../dashboard/src/v2/lib/agent-preset-api.js";

expect.extend(matchers);

afterEach(() => cleanup());

vi.mock("../../../dashboard/src/v2/lib/agent-preset-api.js", () => ({
  fetchSkillStorages: vi.fn(),
  fetchSkillStorageContents: vi.fn(),
  createSkillStorage: vi.fn(),
  updateSkillStorage: vi.fn(),
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
  it("localizes reflection controls while keeping criterion labels and prompts verbatim", async () => {
    vi.mocked(fetchSkillStorages).mockResolvedValue([]);
    let latest = makeProjectSettings();
    const authoredPrompt = latest.agents.selfReflection.planning.criteria[0]!.prompt;
    const Harness = () => {
      const [projectSettings, setProjectSettings] = useState(latest);
      latest = projectSettings;
      return (
        <SettingsAgentsPanel
          state={{
            activeScope: "project",
            setActiveScope: vi.fn(),
            selectedProject: { id: "project-settings", name: "Generic Settings Project" },
            editableSettings: projectSettings,
            projectSettings,
            projectSources: { "agents.selfReflection.planning.enabled": "project" },
            projectAgentPresets: [],
            projectAgentPresetOptions: [],
            updateProject: (recipe: (current: ProjectSettings) => ProjectSettings) => setProjectSettings(recipe),
            updateEditableSettings: vi.fn(),
          } as never}
        />
      );
    };

    render(<DashboardI18nProvider initialLocale="de" storage={null}><Harness /></DashboardI18nProvider>);
    expect(screen.getByText("Selbstreflexion")).toBeInTheDocument();
    expect(screen.getByText("Projektüberschreibung")).toBeInTheDocument();
    expect(screen.getByDisplayValue(authoredPrompt)).toBeInTheDocument();

    fireEvent.input(screen.getByDisplayValue("Planning contract"), {
      target: { value: "Planungskriterium authored exactly" },
    });
    await waitFor(() => expect(latest.agents.selfReflection.planning.criteria[0]?.label).toBe(
      "Planungskriterium authored exactly",
    ));
    expect(latest.agents.selfReflection.planning.criteria[0]?.prompt).toBe(authoredPrompt);
  });

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
    const view = render(<DashboardI18nProvider storage={null}>{renderPanel()}</DashboardI18nProvider>);

    await waitFor(() => {
      expect(screen.getAllByText("Shared Skills").length).toBeGreaterThan(0);
    });
    expect(screen.getByRole("button", { name: "Manage storages" })).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.getByText("Default off")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable persistent skills for Settings Agent" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Enable persistent skills for Settings Agent" })).toHaveAccessibleDescription(
      "Attach at least one storage before enabling persistent skills.",
    );

    fireEvent.click(screen.getByLabelText("Shared Skills"));
    await waitFor(() => {
      expect(updateAgentPreset).toHaveBeenCalledWith("agent-settings", {
        persistentSkillStorageIds: ["skills-shared"],
        persistentSkillStorage: { enabled: false },
      });
    });
    expect(screen.getByRole("switch", { name: "Enable persistent skills for Settings Agent" })).toBeEnabled();

    fireEvent.click(screen.getByRole("switch", { name: "Enable persistent skills for Settings Agent" }));
    await waitFor(() => {
      expect(updateAgentPreset).toHaveBeenLastCalledWith("agent-settings", {
        persistentSkillStorageIds: ["skills-shared"],
        persistentSkillStorage: { enabled: true },
      });
    });
    expect(screen.getByText("Enabled")).toBeInTheDocument();

    fireEvent.input(screen.getByDisplayValue("Planning contract"), {
      target: { value: "Planning contract improved" },
    });
    view.rerender(<DashboardI18nProvider storage={null}>{renderPanel()}</DashboardI18nProvider>);
    fireEvent.input(screen.getByDisplayValue("The plan covers the persistent skills contract."), {
      target: { value: "The plan covers storage sharing, runtime injection, and MCP retrieval." },
    });
    view.rerender(<DashboardI18nProvider storage={null}>{renderPanel()}</DashboardI18nProvider>);
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

  it("reconciles agent attachments when the manager deletes the last storage", async () => {
    vi.clearAllMocks();
    const storage = {
      id: "skills-shared",
      projectId: "project-settings",
      name: "Shared Skills",
      description: "Reusable instructions",
      storageKind: "project" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const replacementStorage = {
      ...storage,
      id: "skills-replacement",
      name: "Replacement Skills",
    };
    vi.mocked(fetchSkillStorages).mockResolvedValue([storage]);
    vi.mocked(fetchSkillStorageContents).mockImplementation(async (_projectId, storageId) => ({
      storage: storageId === replacementStorage.id ? replacementStorage : storage,
      skills: [],
      truncated: false,
    }));
    vi.mocked(deleteSkillStorage).mockResolvedValue(undefined);
    vi.mocked(createSkillStorage).mockResolvedValue(replacementStorage);
    vi.mocked(updateAgentPreset).mockResolvedValue({} as AgentPreset);

    const presets: AgentPreset[] = [{
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
      persistentSkillStorageIds: [storage.id],
      persistentSkillStorage: { enabled: true },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }];

    render(
      <DashboardI18nProvider storage={null}><SettingsAgentsPanel
        state={{
          activeScope: "project",
          setActiveScope: vi.fn(),
          selectedProject: { id: "project-settings", name: "Generic Settings Project" },
          editableSettings: makeProjectSettings(),
          projectSettings: makeProjectSettings(),
          projectSources: {},
          projectAgentPresets: presets,
          projectAgentPresetOptions: [{ value: "agent-settings", label: "Settings Agent" }],
          updateProject: vi.fn(),
          updateEditableSettings: vi.fn(),
        } as never}
      /></DashboardI18nProvider>,
    );

    expect(await screen.findByText("Enabled")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Shared Skills" })).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Manage storages" }));
    await screen.findByText("No skill content yet");
    fireEvent.click(screen.getByRole("button", { name: "Delete Shared Skills" }));
    fireEvent.input(screen.getByLabelText("Type Shared Skills to confirm"), {
      target: { value: "Shared Skills" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete storage" }));

    await waitFor(() => expect(deleteSkillStorage).toHaveBeenCalledWith("project-settings", storage.id));
    expect(screen.getByText("Default off")).toBeInTheDocument();
    const retrievalToggle = screen.getByRole("switch", { name: "Enable persistent skills for Settings Agent" });
    expect(retrievalToggle).toBeDisabled();
    expect(retrievalToggle).toHaveAccessibleDescription("Attach at least one storage before enabling persistent skills.");
    expect(screen.getByText("No storages available. Use Manage storages to create one.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Shared Skills" })).not.toBeInTheDocument();

    fireEvent.input(screen.getByLabelText("Storage name"), { target: { value: replacementStorage.name } });
    fireEvent.click(screen.getByRole("button", { name: "Create storage" }));
    await screen.findByText(`${replacementStorage.name} was created for Generic Settings Project.`);
    fireEvent.click(screen.getByRole("button", { name: "Close persistent skill storage manager" }));
    fireEvent.click(screen.getByRole("checkbox", { name: replacementStorage.name }));

    await waitFor(() => expect(updateAgentPreset).toHaveBeenLastCalledWith("agent-settings", {
      persistentSkillStorageIds: [replacementStorage.id],
      persistentSkillStorage: { enabled: false },
    }));
  });
});
