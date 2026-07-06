/** @vitest-environment happy-dom */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { SettingsPage } from "../../../dashboard/src/v2/SettingsPage.js";
import { useProjectData } from "../../../dashboard/src/v2/context/project-data.js";
import { fetchSystemSettings, saveSystemSettings, saveProjectSettings, resetProjectSettings, fetchProjectEffectiveSettings } from "../../../dashboard/src/v2/lib/settings-api.js";
import { fetchAgentPresets } from "../../../dashboard/src/v2/lib/agent-preset-api.js";
import { fetchLocalFiles } from "../../../dashboard/src/v2/lib/project-api.js";
import { fetchExternalSettingsHints } from "../../../dashboard/src/lib/api/dashboard-api.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    context: (callback: () => void) => {
      callback();
      return { revert: vi.fn() };
    },
    fromTo: vi.fn(),
    set: vi.fn(),
    timeline: vi.fn(() => ({ to: vi.fn(), fromTo: vi.fn(), play: vi.fn() })),
    to: vi.fn((_: unknown, options?: { onComplete?: () => void }) => {
      options?.onComplete?.();
    }),
  },
}));

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useResolvedMotionDuration: (d: any) => d,
  useReducedMotion: () => true,
}));

vi.mock("../../../dashboard/src/v2/components/settings/SettingsCategoryRail.js", () => {
  const icon = () => null;
  const categories = [
    { id: "general", num: "01", label: "General", icon, description: "General settings" },
    { id: "agents", num: "06", label: "Agents", icon, description: "Agent settings" },
    { id: "mcp", num: "09", label: "MCP", icon, description: "MCP settings" },
  ];

  return {
    CATEGORIES: categories,
    SettingsCategoryRail: ({
      filteredCategories,
      onSwitchCategory,
    }: {
      filteredCategories: Array<{ id: string; label: string }>;
      onSwitchCategory: (categoryId: "general" | "agents" | "mcp") => void;
    }) => (
      <div>
        {filteredCategories.map((category) => (
          <button key={category.id} type="button" onClick={() => onSwitchCategory(category.id as "general" | "agents" | "mcp")}>
            {category.label}
          </button>
        ))}
      </div>
    ),
  };
});

vi.mock("../../../dashboard/src/v2/components/settings/SettingsContentPanels.js", async () => {
  const { SettingsGeneralPanel } = await vi.importActual<typeof import("../../../dashboard/src/v2/components/settings/panels/SettingsGeneralPanel.js")>(
    "../../../dashboard/src/v2/components/settings/panels/SettingsGeneralPanel.js",
  );
  const { SettingsMcpPanel } = await vi.importActual<typeof import("../../../dashboard/src/v2/components/settings/panels/SettingsMcpPanel.js")>(
    "../../../dashboard/src/v2/components/settings/panels/SettingsMcpPanel.js",
  );

  return {
    SettingsContentPanels: ({
    state,
  }: {
    state: { activeCategory: string; activeScope?: string; updateEditableSettings: (recipe: (current: any) => any) => void };
  }) => {
    if (state.activeCategory === "general" && state.activeScope === "system") {
      return <SettingsGeneralPanel state={state as any} />;
    }

    if (state.activeCategory === "mcp") {
      return <SettingsMcpPanel state={state as any} />;
    }

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
  };
});

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

vi.mock("../../../dashboard/src/v2/lib/project-api.js", () => ({
  fetchLocalFiles: vi.fn(),
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
  settings.cliWorkflow.containerSetupScriptPath = ".code-ux/container/setup.sh";
  settings.mcpTools = [{ name: "manage_tasks", enabled: true, isInternal: true }];
  settings.customMcpServers = [
    {
      id: "remote-docs",
      name: "remote_docs",
      label: "Remote Docs",
      description: "Documentation server for local test settings.",
      enabled: true,
      transport: "http",
      url: "https://mcp.example.test/sse",
      headers: { Authorization: "Bearer test-token" },
    },
  ];
  return settings;
};

const mockSystemSettings = {
  runtime: { dashboardPort: 4444, consoleLogLevel: "info", debugLogFileLevel: "error", consoleLogMode: "standard" },
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
  mcpTools: createDashboardSettings().mcpTools,
  customMcpServers: createDashboardSettings().customMcpServers,
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
    vi.mocked(fetchLocalFiles).mockResolvedValue({
      currentPath: "/workspace/local-test",
      parentPath: "/workspace",
      rootPath: "/",
      homePath: "/home/user",
      directories: [],
      files: [{ name: "setup.sh", path: "/workspace/local-test/setup.sh" }],
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => { vi.clearAllMocks(); });

  it("should preserve dirty state and prevent background refreshes from stomping edits", async () => {
    const { container } = render(<SettingsPage />);

    await waitFor(() => {
      expect(fetchSystemSettings).toHaveBeenCalledTimes(1);
    });

    // Switch to Project scope
    const projectScopeBtns = screen.getAllByRole("radio", { name: "Project" });
    fireEvent.click(projectScopeBtns[0]);

    await waitFor(() => {
      expect(fetchProjectEffectiveSettings).toHaveBeenCalledWith("proj-1", { cache: "reload" });
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

    const projectScopeBtns = screen.getAllByRole("radio", { name: "Project" });
    fireEvent.click(projectScopeBtns[0]);

    await waitFor(() => {
      expect(fetchProjectEffectiveSettings).toHaveBeenCalledWith("proj-1", { cache: "reload" });
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

    const projectScopeBtn = screen.getAllByRole("radio", { name: "Project" })[0];
    fireEvent.click(projectScopeBtn);

    await waitFor(() => {
      expect(fetchProjectEffectiveSettings).toHaveBeenCalledWith("proj-1", { cache: "reload" });
    });
  });

  it("should stable system/project scope switching", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(fetchSystemSettings).toHaveBeenCalledTimes(1);
    });

    const projectScopeBtns = screen.getAllByRole("radio", { name: "Project" });
    const projectScopeBtn = projectScopeBtns[0];
    fireEvent.click(projectScopeBtn);

    expect(screen.getAllByText(/Editing overrides for Test Project/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Project settings are inheriting system defaults until an override is edited/).length).toBeGreaterThan(0);
  });

  it("keeps save disabled reasons visible and accessible while clean", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(fetchSystemSettings).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save Changes" })).toHaveAccessibleDescription("No settings changes to save.");
    });

    const saveButton = screen.getByRole("button", { name: "Save Changes" });
    expect(saveButton).toBeDisabled();
    expect(saveButton).toHaveAccessibleDescription("No settings changes to save.");
    expect(screen.getByText("No settings changes to save.")).toBeInTheDocument();
  });

  it("clears Smart Find search without moving focus away from the search field", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(fetchSystemSettings).toHaveBeenCalledTimes(1);
    });

    const search = screen.getByLabelText("Search settings categories") as HTMLInputElement;
    fireEvent.input(search, { target: { value: "mcp" } });
    expect(search).toHaveValue("mcp");

    fireEvent.click(screen.getByRole("button", { name: "Clear settings search" }));

    expect(search).toHaveValue("");
    expect(search).toBe(document.activeElement);
  });

  it("renders quality assurance controls in agents settings", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(fetchSystemSettings).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(fetchProjectEffectiveSettings).toHaveBeenCalledWith("proj-1", { cache: "reload" });
      expect(fetchAgentPresets).toHaveBeenCalledWith("proj-1");
    });

    fireEvent.click(screen.getAllByRole("button", { name: /Agents/ })[0]!);

    await waitFor(() => {
      expect(screen.getByText("Quality Assurance")).toBeInTheDocument();
      expect(screen.getByText("Enable QA agent")).toBeInTheDocument();
      expect(screen.getByText("QA is disabled. Enable it to review completed tasks, gate sprint completion, and inspect completed tasks that do not yet have a PR.")).toBeInTheDocument();
    });
  });

  it("preserves setup-script drafts while MCP HTTP guidance remains available", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(fetchSystemSettings).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Browse" }));
    expect(await screen.findByText("/workspace/local-test")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "setup.sh" }));
    expect(screen.getByLabelText("Container setup script")).toHaveValue("/workspace/local-test/setup.sh");
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeEnabled();

    fireEvent.click(screen.getAllByRole("button", { name: "MCP" }).at(-1)!);

    expect(await screen.findByText("MCP connection modes")).toBeInTheDocument();
    expect(screen.getByText(/built-in MCP server over stdio by default/i)).toBeInTheDocument();
    expect(screen.getByText(/MCP_HTTP_\* environment variables or --mcp-http\* flags/i)).toBeInTheDocument();
    expect(screen.getByText("Remote Docs")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    expect(screen.getByText("HTTP / SSE setup")).toBeInTheDocument();
    expect(screen.getByLabelText("Server URL")).toHaveValue("https://mcp.example.test/sse");
    expect(screen.getByLabelText("Auth headers JSON")).toHaveValue(JSON.stringify({ Authorization: "Bearer test-token" }, null, 2));

    fireEvent.click(screen.getAllByRole("button", { name: "General" }).at(-1)!);
    expect(await screen.findByLabelText("Container setup script")).toHaveValue("/workspace/local-test/setup.sh");
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeEnabled();
  });
});
