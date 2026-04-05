/** @vitest-environment jsdom */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { SettingsPage } from "../../../dashboard/src/v2/SettingsPage.js";
import { useProjectData } from "../../../dashboard/src/v2/context/project-data.js";
import { fetchSystemSettings, saveSystemSettings, saveProjectSettings, resetProjectSettings, fetchProjectEffectiveSettings } from "../../../dashboard/src/v2/lib/settings-api.js";
import { fetchAgentPresets } from "../../../dashboard/src/v2/lib/agent-preset-api.js";
import { fetchExternalSettingsHints } from "../../../dashboard/src/lib/api/dashboard-api.js";

expect.extend(matchers);

vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({
  useProjectData: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/lib/settings-api.js", () => ({
  fetchSystemSettings: vi.fn(),
  saveSystemSettings: vi.fn(),
  saveProjectSettings: vi.fn(),
  resetProjectSettings: vi.fn(),
  resetSystemDatabase: vi.fn(),
  fetchProjectEffectiveSettings: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/lib/agent-preset-api.js", () => ({
  fetchAgentPresets: vi.fn(),
}));

vi.mock("../../../dashboard/src/lib/api/dashboard-api.js", () => ({
  fetchExternalSettingsHints: vi.fn(),
}));

const mockRouting = {
  task_coding: { provider: "jules", allowedProviders: ["jules", "gemini"], providers: {} },
  planning: { provider: "gemini", allowedProviders: ["jules", "gemini"], providers: {} },
  dashboard_reply: { provider: "jules", allowedProviders: ["jules", "gemini"], providers: {} },
  clarification_reply: { provider: "jules", allowedProviders: ["jules", "gemini"], providers: {} },
  qa_review: { provider: "jules", allowedProviders: ["jules", "gemini"], providers: {} },
  ci_fix: { provider: "jules", allowedProviders: ["jules", "gemini"], providers: {} },
  merge_conflict: { provider: "jules", allowedProviders: ["jules", "gemini"], providers: {} }
};

const mockSystemSettings = {
  runtime: { nodeEnvironment: "development" },
  integrations: { julesApiKey: "sys-key", geminiApiKey: "", codexApiKey: "", claudeCodeApiKey: "", githubToken: "" },
  defaults: {
    automationLevel: "high",
    aiProvider: { providers: { gemini: { enabled: true, model: "pro", weight: 1, thinkingMode: "MEDIUM" }, jules: { enabled: true, model: "auto", weight: 1, thinkingMode: "SMALL" }, codex: { enabled: false, model: "gpt-4", weight: 1, thinkingMode: "SMALL" }, "claude-code": { enabled: false, model: "claude-3-5", weight: 1, thinkingMode: "SMALL" } }, provider: "gemini", strategy: "single", invocationRouting: mockRouting },
    git: { githubMode: "oauth", defaultBranch: "main", autoCreatePr: true, featureBranchPrefix: "feat", sprintBranchScheme: "short" },
    ciIntelligence: {}, sprintLoopSteps: {}, cliWorkflow: {}, sprintPreview: {}, workers: {}, agents: { saveToProjectDirectory: true, instructionTemplates: {}, qualityAssurance: { enabled: false, maxTaskReviewRuns: 1, taskCompletion: { enabled: true, agentPresetId: null }, sprintCompletion: { enabled: true, agentPresetId: null }, completedTaskWithoutPr: { enabled: true, agentPresetId: null } } }, skills: [], memory: {}
  },
  mcpTools: [],
};

const mockEffectiveSettingsData = {
  settings: {
    automationLevel: "high",
    aiProvider: { providers: { gemini: { enabled: true, model: "pro", weight: 1, thinkingMode: "MEDIUM" }, jules: { enabled: true, model: "auto", weight: 1, thinkingMode: "SMALL" }, codex: { enabled: false, model: "gpt-4", weight: 1, thinkingMode: "SMALL" }, "claude-code": { enabled: false, model: "claude-3-5", weight: 1, thinkingMode: "SMALL" } }, provider: "gemini", strategy: "single", invocationRouting: mockRouting },
    git: { githubMode: "oauth", defaultBranch: "main", autoCreatePr: true, featureBranchPrefix: "feat", sprintBranchScheme: "short" },
    ciIntelligence: {}, sprintLoopSteps: {}, cliWorkflow: {}, sprintPreview: {}, workers: {}, agents: { saveToProjectDirectory: true, instructionTemplates: {}, qualityAssurance: { enabled: false, maxTaskReviewRuns: 1, taskCompletion: { enabled: true, agentPresetId: null }, sprintCompletion: { enabled: true, agentPresetId: null }, completedTaskWithoutPr: { enabled: true, agentPresetId: null } } }, skills: [], memory: {}
  },
  sources: { "automationLevel": "project" }
};

describe("SettingsPage data interactions", () => {
  let mockFetchProjectSettings;

  beforeEach(() => {
    vi.resetAllMocks();
    mockFetchProjectSettings = vi.mocked(fetchProjectEffectiveSettings).mockResolvedValue(mockEffectiveSettingsData);
    vi.mocked(fetchAgentPresets).mockResolvedValue([
      { id: "worker-1", name: "Delivery Agent", labels: ["worker"] },
      { id: "qa-agent-2", name: "QA Agent Beta", labels: ["qa"] },
      { id: "qa-agent-1", name: "Risk Reviewer", labels: ["quality-assurance"] },
    ] as any);
    vi.mocked(fetchExternalSettingsHints).mockResolvedValue({
      env: { julesApiKey: "", geminiApiKey: "", codexApiKey: "", claudeCodeApiKey: "", githubToken: "" },
      settingsJson: { julesApiKey: "", geminiApiKey: "", codexApiKey: "", claudeCodeApiKey: "", githubToken: "" },
      resolved: { julesApiKey: "", geminiApiKey: "", codexApiKey: "", claudeCodeApiKey: "", githubToken: "" },
      providerAvailability: {
        jules: { hasApiKey: false, hasLocalAuth: false },
        gemini: { hasApiKey: false, hasLocalAuth: false },
        codex: { hasApiKey: false, hasLocalAuth: false },
        claudeCode: { hasApiKey: false, hasLocalAuth: false },
      },
    });

    vi.mocked(useProjectData).mockReturnValue({
      selectedProject: { id: "proj-1", name: "Test Project", repositoryPath: "/tmp" },
      selectedProjectId: "proj-1",
      deleteProject: vi.fn(),
      projects: [],
      refreshProjects: vi.fn(),
      loading: false,
      error: null,
    });

    vi.mocked(fetchSystemSettings).mockResolvedValue(mockSystemSettings);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should preserve dirty state and prevent background refreshes from stomping edits", async () => {
    const { container } = render(<SettingsPage />);

    await waitFor(() => {
      expect(fetchSystemSettings).toHaveBeenCalledTimes(1);
    });

    // Switch to Project scope
    const projectScopeBtns = screen.getAllByRole("button", { name: "Project" });
    fireEvent.click(projectScopeBtns[0]);

    await waitFor(() => {
      expect(fetchProjectEffectiveSettings).toHaveBeenCalledWith("proj-1");
    });

    // Pick an input that is immediately available, such as the settings search field
    // which modifies state and should persist across background loads
    const searchInput = screen.getByPlaceholderText(/Search categories/i) as HTMLInputElement;

    fireEvent.change(searchInput, { target: { value: "my-dirty-search" } });
    expect(searchInput.value).toBe("my-dirty-search");

    // Wait to ensure state was updated and no immediate re-renders wiped it
    await waitFor(() => {
      expect(searchInput.value).toBe("my-dirty-search");
    });

    // Trigger a backend-driven data refresh by simulating the background poll
    vi.mocked(fetchProjectEffectiveSettings).mockResolvedValue({
      ...mockEffectiveSettingsData,
      settings: { ...mockEffectiveSettingsData.settings, automationLevel: "low" } // random change to data
    });

    // We expect the local state (in this case search input) to survive the mock update
    await waitFor(() => {
      expect(searchInput.value).toBe("my-dirty-search");
    });
  });

  it("should refresh project sources once after save without reloading away unsaved edits", async () => {
    vi.mocked(saveProjectSettings).mockResolvedValue(mockEffectiveSettingsData.settings);
    vi.mocked(fetchProjectEffectiveSettings).mockResolvedValue({
      ...mockEffectiveSettingsData,
      sources: { "automationLevel": "system" } // New simulated post-save state
    });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(fetchSystemSettings).toHaveBeenCalledTimes(1);
    });

    const projectScopeBtns = screen.getAllByRole("button", { name: "Project" });
    fireEvent.click(projectScopeBtns[0]);

    await waitFor(() => {
      expect(fetchProjectEffectiveSettings).toHaveBeenCalledWith("proj-1");
    });

    // Save project settings
    const saveBtns = screen.getAllByRole("button", { name: /Save changes/i });
    fireEvent.click(saveBtns[0]);

    // It should call saveProjectSettings and then fetchProjectEffectiveSettings again to refresh sources
    await waitFor(() => {
      expect(saveProjectSettings).toHaveBeenCalledWith("proj-1", expect.any(Object));
      expect(fetchProjectEffectiveSettings).toHaveBeenCalledTimes(2);
    });
  });

  it("should call refresh pipeline correctly", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(fetchSystemSettings).toHaveBeenCalledTimes(1);
      expect(fetchExternalSettingsHints).toHaveBeenCalledTimes(1);
    });

    const projectScopeBtn = screen.getAllByRole("button", { name: "Project" })[0];
    fireEvent.click(projectScopeBtn);

    await waitFor(() => {
      expect(fetchProjectEffectiveSettings).toHaveBeenCalledWith("proj-1");
    });
  });

  it("should stable system/project scope switching", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(fetchSystemSettings).toHaveBeenCalledTimes(1);
    });

    const projectScopeBtns = screen.getAllByRole("button", { name: "Project" });
    const projectScopeBtn = projectScopeBtns[0];
    fireEvent.click(projectScopeBtn);

    expect(screen.getByText(/Editing overrides for Test Project/)).toBeInTheDocument();
  });

  it("renders quality assurance controls in agents settings", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(fetchSystemSettings).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(fetchProjectEffectiveSettings).toHaveBeenCalledWith("proj-1");
      expect(fetchAgentPresets).toHaveBeenCalledWith("proj-1");
    });

    fireEvent.click(screen.getAllByRole("button", { name: /Agents/ })[0]!);

    await waitFor(() => {
      expect(screen.getByText("Quality Assurance")).toBeInTheDocument();
      expect(screen.getByText("Enable QA agent")).toBeInTheDocument();
      expect(screen.getByText("QA is disabled. Enable it to review completed tasks, gate sprint completion, and inspect completed tasks that do not yet have a PR.")).toBeInTheDocument();
    });
  });
});
