/** @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom" />
import { h } from "preact";
import { describe, expect, afterEach, vi, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { AgentsPage } from "../../AgentsPage.js";
import { ProjectDataContext } from "../../context/project-data.js";
import type { AgentPreset, Source } from "../../types.js";
import type { InstructionFileSummary } from "../../lib/instruction-file-api.js";
import * as agentPresetApi from "../../lib/agent-preset-api.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn().mockImplementation((_, __, config) => {
      config?.onComplete?.();
    }),
    context: vi.fn().mockImplementation((fn) => {
      fn?.();
      return { revert: vi.fn() };
    }),
    killTweensOf: vi.fn(),
    to: vi.fn(),
  },
}));

vi.mock("../../components/agents/LazyAgentAvatarScene.js", () => ({
  LazyAgentAvatarScene: () => <div data-testid="lazy-avatar-scene" />,
}));

vi.mock("../../components/agents/AgentAvatarStage.js", () => ({
  AgentAvatarStage: () => <div data-testid="agent-avatar-stage" />,
}));

vi.mock("../../components/ui/WaveFluid.js", () => ({
  WaveFluid: () => null,
}));

vi.mock("../../components/ui/BorderTrace.js", () => ({
  BorderTrace: () => null,
}));

vi.mock("../../lib/instruction-file-api.js", () => ({
  fetchInstructionFiles: vi.fn(async () => [
    {
      id: "codex",
      label: "Codex Instructions",
      fileName: "AGENTS.md",
      relativePath: ".code-ux/instructions/AGENTS.md",
      description: "Codex instructions",
      providerId: "codex",
      exists: true,
      size: 2048,
      updatedAt: "2026-01-01T00:00:00.000Z",
    } satisfies InstructionFileSummary,
  ]),
}));

vi.mock("../../lib/agent-preset-api.js", () => ({
  createAgentPreset: vi.fn(),
  deleteAgentPreset: vi.fn(),
  fetchAgentPresets: vi.fn(),
  importAgentPresetFromMarkdown: vi.fn(),
  syncAllAgentPresetsFromMarkdown: vi.fn(),
  updateAgentPreset: vi.fn(),
}));

vi.mock("../../hooks/use-project-effective-settings.js", () => ({
  useProjectEffectiveSettings: () => ({
    data: {
      settings: {
        agents: {
          saveToProjectDirectory: true,
          routing: {
            planning: { agentPresetId: "preset_planner" },
            taskCoding: { mode: "AGENT", agentPresetId: "preset_planner", orchestratorAgentPresetIds: [] },
            ciFix: { agentPresetId: null },
            mergeConflict: { agentPresetId: null },
            dashboardReply: { agentPresetId: null },
            clarificationReply: { agentPresetId: null },
          },
          qualityAssurance: {
            enabled: false,
            taskCompletion: { enabled: false, agentPresetId: null },
            sprintCompletion: { enabled: false, agentPresetId: null },
            completedTaskWithoutPr: { enabled: false, agentPresetId: null },
          },
        },
        aiProvider: { providers: {} },
        customMcpServers: [],
        memory: { workerLearningsInstruction: "" },
      },
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

function makePreset(overrides: Partial<AgentPreset> = {}): AgentPreset {
  return {
    id: "preset_planner",
    projectId: "project_1",
    name: "Planning Agent",
    description: "Plans dependency-aware work",
    instructionMarkdown: "Plan the sprint.",
    labels: [],
    sourcePath: ".code-ux/agents/planning-agent.md",
    sourceScope: "project",
    sourceUpdatedAt: "2026-01-01T00:00:00.000Z",
    sourceImportedAt: "2026-01-01T00:00:00.000Z",
    sourceExists: true,
    syncStatus: "out_of_sync",
    avatarConfig: {},
    providerConfigId: null,
    model: null,
    memoryTemplateOverrideEnabled: false,
    memoryTemplateMarkdown: "",
    memoryConfig: undefined,
    mcpAccess: {
      codeUxEnabled: false,
      codeUxToolToggles: [],
      linkedServerIds: [],
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function makeProject(): Source {
  return {
    id: "project_1",
    name: "Simple Test 2",
    provider: "local",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as Source;
}

function renderPage(): void {
  const project = makeProject();
  render(
    <ProjectDataContext.Provider
      value={{
        projects: [project],
        selectedProjectId: project.id,
        selectedProject: project,
        loading: false,
        error: null,
        refreshProjects: vi.fn(),
        selectProject: vi.fn(),
        createProject: vi.fn(),
        updateProject: vi.fn(),
        deleteProject: vi.fn(),
      }}
    >
      <AgentsPage />
    </ProjectDataContext.Provider>
  );
}

describe("AgentsPage push and sync affordances", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps repository sync and import actions accessible from the studio route", async () => {
    vi.mocked(agentPresetApi.fetchAgentPresets).mockResolvedValue([makePreset()]);
    vi.mocked(agentPresetApi.syncAllAgentPresetsFromMarkdown).mockResolvedValue([makePreset({ syncStatus: "synced" })]);

    renderPage();

    const syncAllButton = await screen.findByRole("button", {
      name: "Sync all agent presets from repository markdown",
    });
    expect(syncAllButton).toBeEnabled();

    const presetButton = await screen.findByRole("button", {
      name: /Select agent preset Planning Agent\./,
    });
    expect(presetButton.getAttribute("aria-label")).toContain("Sync status: Out of Sync.");

    expect(screen.getByText("1 need sync")).toBeInTheDocument();

    fireEvent.click(syncAllButton);

    await waitFor(() => {
      expect(agentPresetApi.syncAllAgentPresetsFromMarkdown).toHaveBeenCalledWith("project_1");
    });

    expect(await screen.findByRole("button", { name: "Import" })).toBeEnabled();
  });
});
