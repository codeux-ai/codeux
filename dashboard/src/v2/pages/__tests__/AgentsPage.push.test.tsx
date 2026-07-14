/** @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import * as matchers from "@testing-library/jest-dom/matchers";
import { createContext } from "preact";
import { AgentsPage } from "../../AgentsPage.js";
import { useProjectData } from "../../context/project-data.js";
import { useProjectEffectiveSettings } from "../../hooks/use-project-effective-settings.js";
import { fetchAgentPresets, pushAgentPresetsToRepository } from "../../lib/agent-preset-api.js";

expect.extend(matchers);

vi.mock("gsap", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const mockGsap = {
    context: vi.fn((fn) => {
      if (fn) fn();
      return { revert: vi.fn() };
    }),
    to: vi.fn(),
    fromTo: vi.fn(),
    killTweensOf: vi.fn(),
  };
  return { ...actual, default: mockGsap, gsap: mockGsap };
});

vi.mock("../../context/project-data.js", () => {
  const ProjectDataContext = createContext(null);
  return {
    useProjectData: vi.fn(),
    ProjectDataContext,
  };
});

vi.mock("../../hooks/use-project-effective-settings.js", () => ({
  useProjectEffectiveSettings: vi.fn(),
}));

vi.mock("../../lib/instruction-file-api.js", () => ({
  fetchInstructionFiles: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../lib/agent-preset-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/agent-preset-api.js")>();
  return {
    ...actual,
    createAgentPreset: vi.fn(),
    deleteAgentPreset: vi.fn(),
    fetchAgentPresets: vi.fn(),
    importAgentPresetFromMarkdown: vi.fn(),
    pushAgentPresetsToRepository: vi.fn(),
    syncAllAgentPresetsFromMarkdown: vi.fn(),
    updateAgentPreset: vi.fn(),
  };
});

vi.mock("../../components/agents/AgentPresetShowcaseCard.js", () => ({
  AgentPresetShowcaseCard: ({ preset, onClick }: { preset: { name: string }; onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      {preset.name}
    </button>
  ),
}));

vi.mock("../../components/agents/AgentPresetDetailPanel.js", () => ({
  AgentPresetDetailPanel: () => <div data-testid="detail-panel" />,
}));

vi.mock("../../components/agents/AgentPresetEditorPanel.js", () => ({
  AgentPresetEditorPanel: () => <div data-testid="editor-panel" />,
}));

vi.mock("../../components/agents/InstructionFileCard.js", () => ({
  InstructionFileCard: ({ file }: { file: { name: string } }) => <div>{file.name}</div>,
}));

vi.mock("../../components/agents/InstructionFileEditorPanel.js", () => ({
  InstructionFileEditorPanel: () => <div data-testid="instruction-editor" />,
}));

const mockedUseProjectData = vi.mocked(useProjectData);
const mockedUseProjectEffectiveSettings = vi.mocked(useProjectEffectiveSettings);
const mockedFetchAgentPresets = vi.mocked(fetchAgentPresets);
const mockedPushAgentPresetsToRepository = vi.mocked(pushAgentPresetsToRepository);

describe("AgentsPage push flow", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("lets the user choose a push destination and shows the resulting inline feedback", async () => {
    const user = userEvent.setup();

    mockedUseProjectData.mockReturnValue({
      projects: [{ id: "project-1", name: "Scratch Repo" }] as any,
      selectedProjectId: "project-1",
      selectedProject: { id: "project-1", name: "Scratch Repo" } as any,
      loading: false,
      error: null,
      refreshProjects: vi.fn(),
      selectProject: vi.fn(),
      createProject: vi.fn(),
      updateProject: vi.fn(),
      deleteProject: vi.fn(),
    });
    mockedUseProjectEffectiveSettings.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
    mockedFetchAgentPresets.mockResolvedValue([
      {
        id: "agent-1",
        name: "Worker",
        instructionMarkdown: "",
        labels: [],
        syncStatus: "manual",
      } as any,
    ]);

    render(<AgentsPage />);

    await screen.findByRole("button", { name: "Push Agents" });

    await user.click(screen.getByRole("button", { name: "Push Agents" }));
    expect(screen.getByRole("dialog", { name: "Push Agents" })).toBeInTheDocument();

    mockedPushAgentPresetsToRepository.mockResolvedValueOnce({ committed: false });
    await user.click(screen.getByLabelText("Commit locally"));
    await user.click(screen.getByRole("button", { name: "Push" }));

    await waitFor(() => {
      expect(mockedPushAgentPresetsToRepository).toHaveBeenLastCalledWith("project-1", {
        mode: "commit_only",
        branchName: undefined,
      });
    });
    expect(await screen.findByText("No agent preset changes were available to commit.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Push Agents" }));
    await user.click(screen.getByLabelText("Push to branch"));
    await user.clear(screen.getByLabelText("Branch name"));
    await user.type(screen.getByLabelText("Branch name"), "feature/agents");
    mockedPushAgentPresetsToRepository.mockResolvedValueOnce({
      committed: true,
      pushedBranch: "feature/agents",
    });
    await user.click(screen.getByRole("button", { name: "Push" }));

    await waitFor(() => {
      expect(mockedPushAgentPresetsToRepository).toHaveBeenLastCalledWith("project-1", {
        mode: "commit_and_push",
        branchName: "feature/agents",
      });
    });
    expect(await screen.findByText("Pushed agent presets to feature/agents.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Push Agents" }));
    await user.click(screen.getByLabelText("Open pull request"));
    await user.clear(screen.getByLabelText("Branch name"));
    await user.type(screen.getByLabelText("Branch name"), "feature/agents-pr");
    mockedPushAgentPresetsToRepository.mockResolvedValueOnce({
      committed: true,
      pushedBranch: "feature/agents-pr",
      pullRequestUrl: "https://example.com/acme/repo/pull/7",
    });
    await user.click(screen.getByRole("button", { name: "Push" }));

    await waitFor(() => {
      expect(mockedPushAgentPresetsToRepository).toHaveBeenLastCalledWith("project-1", {
        mode: "pull_request",
        branchName: "feature/agents-pr",
      });
    });
    expect(await screen.findByRole("link", { name: "https://example.com/acme/repo/pull/7" })).toHaveAttribute("href", "https://example.com/acme/repo/pull/7");

    await user.click(screen.getByRole("button", { name: "Push Agents" }));
    await user.click(screen.getByLabelText("Push to branch"));
    mockedPushAgentPresetsToRepository.mockResolvedValueOnce({ committed: true });
    await user.click(screen.getByRole("button", { name: "Push" }));

    expect(await screen.findByText("Agent presets were committed locally, but no remote origin is configured for this repository.")).toBeInTheDocument();
  });
});
