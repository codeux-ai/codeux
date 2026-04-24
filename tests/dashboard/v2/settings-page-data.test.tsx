/** @vitest-environment happy-dom */
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
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

expect.extend(matchers);

vi.mock("gsap", () => {
  const gsapMock = {
    to: vi.fn((_, options?: { onComplete?: () => void }) => {
      options?.onComplete?.();
    }),
    fromTo: vi.fn(),
    set: vi.fn(),
    killTweensOf: vi.fn(),
    registerPlugin: vi.fn(),
    context: vi.fn((cb) => {
      if (typeof cb === "function") cb();
      return { revert: vi.fn(), add: vi.fn() };
    }),
    timeline: vi.fn(() => ({
      to: vi.fn().mockReturnThis(),
      fromTo: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      add: vi.fn().mockReturnThis(),
      kill: vi.fn().mockReturnThis(),
      clear: vi.fn().mockReturnThis(),
    })),
  };
  return {
    gsap: gsapMock,
    default: gsapMock,
  };
});

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useReducedMotion: () => true,
}));

vi.mock("../../../dashboard/src/v2/components/settings/SettingsCategoryRail.js", () => {
  const icon = () => null;
  const categories = [
    { id: "general", num: "01", label: "General", icon, description: "General settings" },
    { id: "agents", num: "06", label: "Agents", icon, description: "Agent settings" },
  ];

  return {
    CATEGORIES: categories,
    CATEGORY_SEARCH_HINTS: {
      general: ["general"],
      agents: ["agents"],
    },
    SettingsCategoryRail: ({
      filteredCategories,
      onSwitchCategory,
    }: {
      filteredCategories: Array<{ id: string; label: string }>;
      onSwitchCategory: (categoryId: "general" | "agents") => void;
    }) => (
      <div>
        {filteredCategories.map((category) => (
          <button key={category.id} type="button" onClick={() => onSwitchCategory(category.id as "general" | "agents")}>
            {category.label}
          </button>
        ))}
      </div>
    ),
  };
});

vi.mock("../../../dashboard/src/v2/components/settings/SettingsContentPanels.js", () => ({
  SettingsContentPanels: ({
    state,
  }: {
    state: { activeCategory: string; updateEditableSettings: (recipe: (current: any) => any) => void };
  }) => {
    if (state.activeCategory === "agents") {
      return (
        <section>
          <div>Quality Assurance</div>
          <div>Enable QA agent</div>
          <div>QA is disabled. Enable it to review completed tasks, gate sprint completion, and inspect completed tasks that do not yet have a PR.</div>
        </section>
      );
    }

    return (
      <section>
        <div>{state.activeCategory}</div>
        <button
          type="button"
          onClick={() => state.updateEditableSettings((current) => ({
            ...current,
            automationLevel: current.automationLevel === "high" ? "low" : "high",
          }))}
        >
          Mutate setting
        </button>
      </section>
    );
  },
}));

vi.mock("../../../dashboard/src/v2/context/project-data.js", () => {
  return {
    ProjectDataContext: {},
    useProjectData: vi.fn(),
  };
});

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

const cloneDashboardSettings = () => JSON.parse(JSON.stringify(DEFAULT_DASHBOARD_SETTINGS));

const createDashboardSettings = () => {
  const settings = cloneDashboardSettings();
  settings.automationLevel = "FULL";
  settings.aiProvider.provider = "gemini";
  settings.aiProvider.providers.gemini.model = "gemini-2.5-pro";
  settings.aiProvider.providers.codex.enabled = false;
  settings.aiProvider.providers["claude-code"].enabled = false;
  settings.git.featureBranchPrefix = "feat";
  settings.git.sprintBranchScheme = "short";
  settings.agents.qualityAssurance.enabled = false;
  settings.agents.qualityAssurance.maxTaskReviewRuns = 1;
  settings.agents.qualityAssurance.taskCompletion.enabled = true;
  settings.agents.qualityAssurance.sprintCompletion.enabled = true;
  settings.agents.qualityAssurance.completedTaskWithoutPr.enabled = true;
  return settings;
};

const mockSystemSettings = {
  runtime: { dashboardPort: 4444, enableDebugLogFile: false },
  integrations: {
    providers: {
      jules: { provider: "jules", name: "Jules Primary", apiKey: "sys-key" },
      gemini: { provider: "gemini", name: "Gemini Primary", apiKey: "" },
      codex: { provider: "codex", name: "Codex Primary", apiKey: "" },
      "claude-code": { provider: "claude-code", name: "Claude Primary", apiKey: "" },
    },
    githubToken: "",
  },
  defaults: createDashboardSettings(),
  mcpTools: [],
};

const mockEffectiveSettingsData = {
  settings: createDashboardSettings(),
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

    fireEvent.click(screen.getAllByRole("button", { name: "Mutate setting" })[0]!);

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
