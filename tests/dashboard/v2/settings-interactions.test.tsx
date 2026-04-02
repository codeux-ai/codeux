/** @vitest-environment jsdom */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { SettingsPage } from "../../../dashboard/src/v2/SettingsPage.js";
import { useProjectData } from "../../../dashboard/src/v2/context/project-data.js";
import { fetchSystemSettings, saveSystemSettings, saveProjectSettings, resetProjectSettings, fetchProjectEffectiveSettings, resetSystemDatabase } from "../../../dashboard/src/v2/lib/settings-api.js";

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

vi.mock("../../../dashboard/src/v2/lib/api/dashboard-api.js", () => ({
  fetchExternalSettingsHints: vi.fn(),
}));

const mockRouting = {
  task_coding: { provider: "jules", allowedProviders: ["jules", "gemini"], providers: {} },
  planning: { provider: "gemini", allowedProviders: ["jules", "gemini"], providers: {} },
  dashboard_reply: { provider: "jules", allowedProviders: ["jules", "gemini"], providers: {} },
  clarification_reply: { provider: "jules", allowedProviders: ["jules", "gemini"], providers: {} },
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
    ciIntelligence: {}, sprintLoopSteps: {}, cliWorkflow: {}, sprintPreview: {}, workers: {}, agents: { instructionTemplates: {} }, skills: [], memory: {}
  },
  mcpTools: [],
};

const mockEffectiveSettingsData = {
  settings: {
    automationLevel: "high",
    aiProvider: { providers: { gemini: { enabled: true, model: "pro", weight: 1, thinkingMode: "MEDIUM" }, jules: { enabled: true, model: "auto", weight: 1, thinkingMode: "SMALL" }, codex: { enabled: false, model: "gpt-4", weight: 1, thinkingMode: "SMALL" }, "claude-code": { enabled: false, model: "claude-3-5", weight: 1, thinkingMode: "SMALL" } }, provider: "gemini", strategy: "single", invocationRouting: mockRouting },
    git: { githubMode: "oauth", defaultBranch: "main", autoCreatePr: true, featureBranchPrefix: "feat", sprintBranchScheme: "short" },
    ciIntelligence: {}, sprintLoopSteps: {}, cliWorkflow: {}, sprintPreview: {}, workers: {}, agents: { instructionTemplates: {} }, skills: [], memory: {}
  },
  sources: { "automationLevel": "project" }
};

describe("SettingsPage Danger Interactions", () => {
  let deleteProjectMock: any;

  beforeEach(() => {
    vi.resetAllMocks();
    deleteProjectMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(fetchProjectEffectiveSettings).mockResolvedValue(mockEffectiveSettingsData as any);
    vi.mocked(fetchSystemSettings).mockResolvedValue(mockSystemSettings as any);
    vi.mocked(resetSystemDatabase).mockResolvedValue(undefined as any);
    vi.mocked(resetProjectSettings).mockResolvedValue(undefined as any);

    vi.mocked(useProjectData).mockReturnValue({
      selectedProject: { id: "proj-1", name: "Test Project", repositoryPath: "/tmp" },
      selectedProjectId: "proj-1",
      deleteProject: deleteProjectMock,
      projects: [],
      refreshProjects: vi.fn(),
      loading: false,
      error: null,
    } as any);

    // Mock matchMedia for dialogs if needed
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should open Wipe Database dialog and execute on confirm", async () => {
    const { container } = render(<SettingsPage />);
    await waitFor(() => expect(fetchSystemSettings).toHaveBeenCalledTimes(1));

    // Switch to danger category
    const dangerBtns = Array.from(container.querySelectorAll('button')).filter(b => b.textContent?.includes('Danger Zone'));
    if (dangerBtns.length > 0) {
      fireEvent.click(dangerBtns[0]!);
    } else {
      const dangerDivs = screen.getAllByText("Danger Zone");
      fireEvent.click(dangerDivs[0]!);
    }

    await waitFor(() => {
        expect(screen.getByText("Wipe Database")).toBeInTheDocument();
    });

    const wipeDbBtns = screen.getAllByText("Wipe Database");
    fireEvent.click(wipeDbBtns[0]!);

    // Dialog should open
    await waitFor(() => {
        expect(screen.getByText("Reset Database")).toBeInTheDocument();
    });

    // Confirm
    fireEvent.click(screen.getByText("Reset Database"));

    await waitFor(() => {
        expect(resetSystemDatabase).toHaveBeenCalledTimes(1);
    });

    // Feedback message visible
    await waitFor(() => {
        expect(screen.getByText("Database reset to a clean state.")).toBeInTheDocument();
    });
  });

  it("should open Wipe Project dialog and execute on confirm", async () => {
    const { container } = render(<SettingsPage />);
    await waitFor(() => expect(fetchSystemSettings).toHaveBeenCalledTimes(1));

    // Switch to danger category
    const dangerBtns = Array.from(container.querySelectorAll('button')).filter(b => b.textContent?.includes('Danger Zone'));
    if (dangerBtns.length > 0) {
      fireEvent.click(dangerBtns[0]!);
    } else {
      const dangerDivs = screen.getAllByText("Danger Zone");
      fireEvent.click(dangerDivs[0]!);
    }

    await waitFor(() => {
        expect(screen.getByText("Wipe Project")).toBeInTheDocument();
    });

    const wipeProjBtns = screen.getAllByText("Wipe Project");
    fireEvent.click(wipeProjBtns[0]!);

    // Dialog should open
    await waitFor(() => {
        expect(screen.getByText("Delete Project")).toBeInTheDocument();
    });

    // Confirm
    fireEvent.click(screen.getByText("Delete Project"));

    await waitFor(() => {
        expect(deleteProjectMock).toHaveBeenCalledWith("proj-1");
    });

    // Wait until loading finishes after project reload
    await waitFor(() => {
        expect(screen.queryByText(/Deleting/)).not.toBeInTheDocument();
    });

    // Feedback message visible
    await waitFor(() => {
        expect(screen.getByText("Project Test Project deleted.")).toBeInTheDocument();
    });
  });

  it("should verify feedback is updated properly", async () => {
    vi.mocked(saveSystemSettings).mockResolvedValue(mockSystemSettings as any);

    const { container } = render(<SettingsPage />);
    await waitFor(() => expect(fetchSystemSettings).toHaveBeenCalledTimes(1));

    const scopeBtns = Array.from(container.querySelectorAll('button')).filter(b => b.textContent?.includes('System'));
    fireEvent.click(scopeBtns[0]!);

    // Ensure data is loaded
    await waitFor(() => expect(container.textContent).toMatch(/Editing live system defaults/));

    await waitFor(() => {
      const match = Array.from(container.querySelectorAll('div')).find(div => div.textContent?.includes('Editing live system defaults'));
      expect(match).toBeInTheDocument();
    });
  });
});
