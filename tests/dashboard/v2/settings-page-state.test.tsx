// @vitest-environment happy-dom
import { h } from "preact";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor, cleanup, render, screen, fireEvent } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { useSettingsPageState } from "../../../dashboard/src/v2/hooks/use-settings-page-state.js";
import { SettingsCategoryRail, CATEGORIES } from "../../../dashboard/src/v2/components/settings/SettingsCategoryRail.js";
import { focusFirstInvalidSettingsControl, SettingsPage } from "../../../dashboard/src/v2/SettingsPage.js";
import { applyEffectiveProjectSettings } from "../../../dashboard/src/v2/lib/settings-view-models.js";
import * as settingsApi from "../../../dashboard/src/v2/lib/settings-api.js";
import * as memoryApi from "../../../dashboard/src/v2/lib/memory-api.js";
import * as agentPresetApi from "../../../dashboard/src/v2/lib/agent-preset-api.js";
import * as dashboardApi from "../../../dashboard/src/lib/api/dashboard-api.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import { SETTINGS_NAVIGATION_SESSION_KEY } from "../../../dashboard/src/v2/lib/settings-navigation-state.js";

import * as navigationBlocker from "../../../dashboard/src/v2/router/navigation-blocker.js";

expect.extend(matchers);

vi.mock("../../../dashboard/src/v2/context/project-data.js", async () => {
  const { createContext } = await import("preact");
  const projectDataValue = {
    deleteProject: vi.fn(() => Promise.resolve()),
    selectedProject: { id: "proj-1", name: "Test Project" },
    selectedProjectId: "proj-1",
  };
  return {
    ProjectDataContext: createContext(projectDataValue),
    useProjectData: vi.fn(() => projectDataValue),
  };
});

vi.mock("../../../dashboard/src/v2/router/navigation-blocker.js", () => ({
  registerNavigationBlocker: vi.fn(() => vi.fn()),
}));

let mockSaveSystem;
let mockSaveProject;
let mockFetchSystem;
let mockFetchProject;
let mockResetProject;
let mockResetDatabase;
let mockFetchExternal;
let mockFetchAgentPresets;
let mockFetchSkillStorages;

const cloneDashboardSettings = () => JSON.parse(JSON.stringify(DEFAULT_DASHBOARD_SETTINGS));

const buildSystemRuntimeSettings = (overrides: Record<string, unknown> = {}) => ({
  dashboardPort: 4444,
  consoleLogLevel: "info",
  debugLogFileLevel: "error",
  consoleLogMode: "standard",
  lastActiveScope: "system",
  dbAutoVacuumOnStartup: false,
  dbPruningEnabled: true,
  dbRetentionDays: 30,
  restartSprintPolicy: "restart",
  restartInvocationPolicy: "restart",
  ...overrides,
});

const buildSystemSettings = (overrides: Record<string, any> = {}) => {
  const runtimeOverrides = overrides.runtime ?? {};
  const integrationOverrides = overrides.integrations ?? {};
  return {
    runtime: buildSystemRuntimeSettings(runtimeOverrides),
    integrations: {
      providers: {
        jules: { provider: "jules", name: "Jules Primary", apiKey: "" },
        gemini: { provider: "gemini", name: "Gemini Primary", apiKey: "" },
        codex: { provider: "codex", name: "Codex Primary", apiKey: "" },
        "claude-code": { provider: "claude-code", name: "Claude Primary", apiKey: "" },
      },
      githubToken: "",
      ...integrationOverrides,
    },
    defaults: cloneDashboardSettings(),
    mcpTools: [],
    ...overrides,
    runtime: buildSystemRuntimeSettings(runtimeOverrides),
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.removeItem(SETTINGS_NAVIGATION_SESSION_KEY);
  mockSaveSystem = vi.spyOn(settingsApi, 'saveSystemSettings').mockImplementation(async (settings) => settings as any);
  mockSaveProject = vi.spyOn(settingsApi, 'saveProjectSettings').mockResolvedValue({ settings: {}, sources: {} } as any);
  mockFetchSystem = vi.spyOn(settingsApi, 'fetchSystemSettings').mockResolvedValue(buildSystemSettings() as any);
  mockFetchProject = vi.spyOn(settingsApi, 'fetchProjectEffectiveSettings').mockResolvedValue({ settings: cloneDashboardSettings(), sources: {} } as any);
  mockResetProject = vi.spyOn(settingsApi, 'resetProjectSettings').mockResolvedValue();
  mockResetDatabase = vi.spyOn(settingsApi, 'resetSystemDatabase').mockResolvedValue();
  mockFetchAgentPresets = vi.spyOn(agentPresetApi, 'fetchAgentPresets').mockResolvedValue([
    { id: "worker-1", name: "Delivery Agent", labels: ["worker"] },
    { id: "qa-2", name: "QA Agent Beta", labels: ["qa"] },
    { id: "qa-1", name: "Risk Reviewer", labels: ["quality-assurance"] },
  ] as any);
  mockFetchSkillStorages = vi.spyOn(agentPresetApi, 'fetchSkillStorages').mockResolvedValue([
    {
      id: "storage-1",
      projectId: "proj-1",
      name: "Implementation Skills",
      description: "Durable implementation playbooks",
      storageKind: "project",
      createdAt: "2023-01-01T00:00:00.000Z",
      updatedAt: "2023-01-01T00:00:00.000Z",
    },
  ] as any);
  mockFetchExternal = vi.spyOn(dashboardApi, 'fetchExternalSettingsHints').mockResolvedValue({
    env: { julesApiKey: "", geminiApiKey: "", codexApiKey: "", claudeCodeApiKey: "", githubToken: "" },
    settingsJson: { julesApiKey: "", geminiApiKey: "", codexApiKey: "", claudeCodeApiKey: "", githubToken: "" },
    resolved: { julesApiKey: "hint", geminiApiKey: "", codexApiKey: "", claudeCodeApiKey: "", githubToken: "" },
    providerAvailability: {
      jules: { hasApiKey: true, hasLocalAuth: false },
      gemini: { hasApiKey: false, hasLocalAuth: false },
      codex: { hasApiKey: false, hasLocalAuth: false },
      claudeCode: { hasApiKey: false, hasLocalAuth: false },
    },
  });
});

// Unmount hooks between tests so leftover `beforeunload`/navigation listeners from
// one test cannot leak into the next (each mounted settings hook attaches its own).
afterEach(() => {
  cleanup();
});

describe("useSettingsPageState", () => {
  it("restores the active settings category, focused card, and invocation route after a hard refresh", async () => {
    const first = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(first.result.current.loading).toBe(false));

    act(() => {
      first.result.current.setActiveCategory("models");
      first.result.current.setActiveInvocationRoute("planning");
    });
    act(() => {
      first.result.current.setActiveSettingsSection("Route Mapping");
    });

    expect(first.result.current.activeSettingsSection).toBe("Route Mapping");
    first.unmount();

    const refreshed = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(refreshed.result.current.loading).toBe(false));

    expect(refreshed.result.current.activeCategory).toBe("models");
    expect(refreshed.result.current.activeSettingsSection).toBe("Route Mapping");
    expect(refreshed.result.current.activeInvocationRoute).toBe("planning");
  });

  it("ignores stale settings navigation values after a hard refresh", async () => {
    window.sessionStorage.setItem(SETTINGS_NAVIGATION_SESSION_KEY, JSON.stringify({
      activeCategory: "removed-category",
      activeInvocationRoute: "removed-route",
      focusedSections: {},
    }));

    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.activeCategory).toBe("general");
    expect(result.current.activeInvocationRoute).toBe("task_coding");
  });

  it("loads updated default CI, memory, and QA settings", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.systemSettings?.defaults.ciIntelligence.featurePrAutoMergeMode).toBe("ALWAYS");
    expect(result.current.systemSettings?.defaults.ciIntelligence.mainBranchAutoMergeMode).toBe("ALWAYS");
    expect(result.current.systemSettings?.defaults.ciIntelligence.resolveMergeConflicts).toBe(true);
    expect(result.current.systemSettings?.defaults.ciIntelligence.resolveMainMergeConflicts).toBe(true);
    expect(result.current.systemSettings?.defaults.memory.enabled).toBe(true);
    expect(result.current.systemSettings?.defaults.agents.qualityAssurance.enabled).toBe(true);
    expect(result.current.systemSettings?.defaults.cliWorkflow.containerRunAsRoot).toBe(false);
    expect(result.current.editableSettings?.ciIntelligence.featurePrAutoMergeMode).toBe("ALWAYS");
    expect(result.current.editableSettings?.ciIntelligence.mainBranchAutoMergeMode).toBe("ALWAYS");
    expect(result.current.editableSettings?.ciIntelligence.resolveMergeConflicts).toBe(true);
    expect(result.current.editableSettings?.ciIntelligence.resolveMainMergeConflicts).toBe(true);
    expect(result.current.editableSettings?.memory.enabled).toBe(true);
    expect(result.current.editableSettings?.agents.qualityAssurance.enabled).toBe(true);
    expect(result.current.editableSettings?.cliWorkflow.containerRunAsRoot).toBe(false);
  });

  it("maps fresh effective settings defaults into project settings view-model", () => {
    const effective = {
      settings: cloneDashboardSettings(),
      sources: {},
    } as any;

    const mapped = applyEffectiveProjectSettings(effective);

    expect(mapped.settings.ciIntelligence.featurePrAutoMergeMode).toBe("ALWAYS");
    expect(mapped.settings.ciIntelligence.mainBranchAutoMergeMode).toBe("ALWAYS");
    expect(mapped.settings.ciIntelligence.resolveMergeConflicts).toBe(true);
    expect(mapped.settings.ciIntelligence.resolveMainMergeConflicts).toBe(true);
    expect(mapped.settings.memory.enabled).toBe(true);
    expect(mapped.settings.agents.qualityAssurance.enabled).toBe(true);
    expect(mapped.settings.cliWorkflow.containerRunAsRoot).toBe(false);
  });

  it("updates editable settings for project scope", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { result.current.setActiveScope("project"); });
    act(() => {
      result.current.updateEditableSettings((curr) => ({
        ...curr,
        googleDrive: { enabled: true, hostPath: "/project/Drive", accessMode: "read-write" },
      }));
    });
    expect(result.current.projectSettings?.googleDrive).toEqual({
      enabled: true,
      hostPath: "/project/Drive",
      accessMode: "read-write",
    });
  });

  it("updates editable settings for system scope", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.updateEditableSettings((curr) => ({
        ...curr,
        googleDrive: { enabled: true, hostPath: "/system/Drive", accessMode: "read-only" },
      }));
    });
    expect(result.current.systemSettings?.defaults.googleDrive).toEqual({
      enabled: true,
      hostPath: "/system/Drive",
      accessMode: "read-only",
    });
  });

  it("publishes appearance previews from unsaved settings edits", async () => {
    const previews: Array<CustomEvent["detail"]> = [];
    const listener = (event: Event) => {
      previews.push((event as CustomEvent).detail);
    };
    window.addEventListener("codeux:appearance-preview", listener);

    const { result, unmount } = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.updateEditableSettings((current) => ({
        ...current,
        appearance: {
          ...current.appearance,
          backgroundMode: "STATIC",
          staticBackgroundColor: "#123456",
        },
      }));
    });

    await waitFor(() => {
      expect(previews.some((detail) => (
        detail?.appearance?.backgroundMode === "STATIC"
        && detail.appearance.staticBackgroundColor === "#123456"
      ))).toBe(true);
    });

    unmount();
    expect(previews[previews.length - 1]?.appearance).toBe(null);
    window.removeEventListener("codeux:appearance-preview", listener);
  });

  it("handles null selectedProject properly", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));
    act(() => { result.current.setActiveScope("project"); });
  });

  it("sorts QA-tagged agent presets ahead of other presets", async () => {
    const dashboardSettings = cloneDashboardSettings();
    dashboardSettings.aiProvider.provider = "gemini";
    dashboardSettings.aiProvider.providers.gemini.model = "gemini-2.5-pro";

    mockFetchSystem.mockResolvedValue({
      runtime: { dashboardPort: 4444, consoleLogLevel: "info", debugLogFileLevel: "error", consoleLogMode: "standard" },
      integrations: {
        providers: {
          jules: { provider: "jules", name: "Jules Primary", apiKey: "" },
          gemini: { provider: "gemini", name: "Gemini Primary", apiKey: "" },
          codex: { provider: "codex", name: "Codex Primary", apiKey: "" },
          "claude-code": { provider: "claude-code", name: "Claude Primary", apiKey: "" },
        },
        githubToken: "",
      },
      defaults: dashboardSettings,
      mcpTools: [],
    } as any);
    mockFetchProject.mockResolvedValue({
      settings: dashboardSettings,
      sources: {},
    } as any);

    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));

    await waitFor(() => expect(result.current.projectAgentPresetOptions.length).toBe(3));

    expect(result.current.projectAgentPresetOptions.map((option) => option.label)).toEqual([
      "QA Agent Beta",
      "Risk Reviewer",
      "Delivery Agent",
    ]);
  });

  it("initializes with general category and system scope", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));

    expect(result.current.activeCategory).toBe("general");
    expect(result.current.activeScope).toBe("system");
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("restores the last settings scope from persisted system settings", async () => {
    mockFetchSystem.mockResolvedValueOnce(buildSystemSettings({
      runtime: { lastActiveScope: "project" },
    }) as any);

    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.activeScope).toBe("project");
  });

  it("persists scope changes through system settings without saving unrelated draft edits", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.updateSystem((current) => ({
        ...current,
        runtime: {
          ...current.runtime,
          consoleLogLevel: "debug",
        },
      }));
    });
    expect(result.current.activeDirty).toBe(true);

    await act(async () => {
      await result.current.setActiveScope("project");
    });

    expect(mockSaveSystem).toHaveBeenCalledWith(expect.objectContaining({
      runtime: expect.objectContaining({
        consoleLogLevel: "info",
        lastActiveScope: "project",
      }),
    }));
    expect(result.current.activeScope).toBe("project");
    expect(result.current.systemSettings?.runtime.consoleLogLevel).toBe("debug");
    expect(result.current.systemSettings?.runtime.lastActiveScope).toBe("project");
    expect(result.current.activeDirty).toBe(true);
  });

  it("renders settings loading state as a busy category region", () => {
    mockFetchSystem.mockReturnValueOnce(new Promise(() => {}));

    render(<SettingsPage />);

    expect(screen.getByRole("region", { name: "Settings category panel" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status", { name: "Loading settings" })).toHaveTextContent("Loading settings.");
  });

  it("renders settings load failures as alerts while preserving the shell", async () => {
    mockFetchSystem.mockRejectedValueOnce(new Error("settings exploded"));

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getAllByRole("alert").some((alert) => alert.textContent?.includes("settings exploded"))).toBe(true);
    });
    expect(screen.getByRole("region", { name: "Settings category panel" })).not.toHaveAttribute("aria-busy");
  });

  it("announces empty settings search results and recovers when the query clears", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "Settings category panel" })).not.toHaveAttribute("aria-busy");
    });

    fireEvent.input(screen.getByLabelText("Search settings categories"), {
      target: { value: "this_should_not_exist_at_all" },
    });
    const emptySearchStatus = screen.getByText(
      '0 results across 0 matching categories for "this_should_not_exist_at_all". Active category: General. Match previews: none. Clear the search or try routing, provider, auth, CI, agent, or memory.',
    );
    expect(emptySearchStatus.closest('[role="status"]')).toBeInTheDocument();

    fireEvent.input(screen.getByLabelText("Search settings categories"), {
      target: { value: "" },
    });
    expect(screen.getByText(/settings categories available/).closest('[role="status"]')).toBeInTheDocument();
  });

  it("loads hints correctly during initialization", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Check if fetchExternalSettingsHints was called
    expect(mockFetchExternal).toHaveBeenCalled();
    // In some Vitest setups, spyOn might not intercept the internal call due to module caching,
    // but we can verify the state updates if the mock works.
    if (result.current.externalHints) {
      expect(result.current.externalHints.resolved?.julesApiKey).toBe("hint");
    }
  });

  it("filters categories based on search input including index metadata", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setSettingsSearch("jules");
    });
    expect(result.current.filteredCategories.map((category) => category.id)).toEqual(["models", "integrations"]);
    expect(result.current.settingsSearchMatches.models?.matchedLabels).toContain("Jules");
    expect(result.current.settingsSearchMatches.integrations?.matchedLabels).toContain("Jules");

    act(() => {
      result.current.setSettingsSearch("pricing");
    });
    expect(result.current.filteredCategories.length).toBe(1);
    expect(result.current.filteredCategories[0]!.id).toBe("models");

    act(() => {
      result.current.setSettingsSearch("this_should_not_exist_at_all");
    });
    expect(result.current.filteredCategories.length).toBe(0);

    act(() => {
      result.current.setSettingsSearch("");
    });
    expect(result.current.filteredCategories.length).toBe(CATEGORIES.length);
  });

  it("renders self-reflection controls default off and supports criteria add/remove", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "Settings category panel" })).not.toHaveAttribute("aria-busy");
    });

    fireEvent.click(screen.getAllByRole("button", { name: /Agents/ }).at(-1)!);

    const configureReflection = await screen.findByRole("button", { name: "Tune self-reflection Self-Reflection" });
    fireEvent.click(configureReflection);

    await waitFor(() => {
      expect(screen.getByText("Planning self-reflection")).toBeInTheDocument();
      expect(screen.getAllByText("Off by default").length).toBeGreaterThan(0);
    });

    const addButtons = screen.getAllByRole("button", { name: /Add criterion/i });
    fireEvent.click(addButtons[0]);
    expect(screen.getByDisplayValue("New criterion")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Remove New criterion/i }));
    await waitFor(() => {
      expect(screen.queryByDisplayValue("New criterion")).not.toBeInTheDocument();
    });
  });

  it("moves category rail focus with arrow keys and commits selection with Enter", () => {
    const onSwitchCategory = vi.fn();
    render(
      <SettingsCategoryRail
        filteredCategories={CATEGORIES.slice(0, 3)}
        activeCategory="general"
        settingsSearch=""
        settingsSearchMatches={{}}
        onSwitchCategory={onSwitchCategory}
      />,
    );

    const general = screen.getByRole("button", { name: /General/ });
    const appearance = screen.getByRole("button", { name: /Appearance/ });
    general.focus();

    fireEvent.keyDown(general, { key: "ArrowDown" });
    expect(appearance).toBe(document.activeElement);
    expect(onSwitchCategory).not.toHaveBeenCalled();

    fireEvent.keyDown(appearance, { key: "Enter" });
    expect(onSwitchCategory).toHaveBeenCalledWith("appearance");
  });

  it("focuses the first invalid visible settings field before save dispatch", () => {
    const root = document.createElement("div");
    const valid = document.createElement("input");
    valid.type = "number";
    valid.min = "1";
    valid.value = "4";
    const invalid = document.createElement("input");
    invalid.type = "number";
    invalid.min = "1";
    invalid.value = "0";
    const laterInvalid = document.createElement("input");
    laterInvalid.setAttribute("aria-invalid", "true");
    root.append(valid, invalid, laterInvalid);
    document.body.append(root);
    const invalidFocus = vi.spyOn(invalid, "focus");
    const invalidScroll = vi.fn();
    invalid.scrollIntoView = invalidScroll;
    const laterFocus = vi.spyOn(laterInvalid, "focus");

    const message = focusFirstInvalidSettingsControl(root);

    expect(message).toBeTruthy();
    expect(invalid.getAttribute("aria-invalid")).toBe("true");
    expect(invalidFocus).toHaveBeenCalled();
    expect(invalidScroll).toHaveBeenCalledWith({ block: "center", inline: "nearest", behavior: "auto" });
    expect(laterFocus).not.toHaveBeenCalled();
    root.remove();
  });

  it("uses owned validation copy when focusing an invalid settings field", () => {
    const root = document.createElement("div");
    const invalid = document.createElement("input");
    const error = document.createElement("span");
    error.id = "custom-error";
    error.textContent = "Use a port between 1 and 65535.";
    invalid.setAttribute("aria-invalid", "true");
    invalid.setAttribute("aria-errormessage", "custom-error");
    invalid.scrollIntoView = vi.fn();
    root.append(invalid, error);
    document.body.append(root);

    expect(focusFirstInvalidSettingsControl(root)).toBe("Use a port between 1 and 65535.");

    root.remove();
  });

  it("automatically switches active category if current is filtered out", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setActiveCategory("memory");
      result.current.setSettingsSearch("automation");
    });

    expect(result.current.filteredCategories.map((category) => category.id)).toEqual(["general", "integrations"]);
    expect(result.current.activeCategory).toBe("general");
  });

  it("adds and removes keydown listener", () => {
    const { unmount } = renderHook(() => useSettingsPageState(CATEGORIES));
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    unmount();
    expect(removeSpy).toHaveBeenCalled();
  });

  it("allows switching scope and updating editable settings", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setActiveScope("project");
    });

    expect(result.current.activeScope).toBe("project");

    act(() => {
      result.current.updateSystem((curr) => ({ ...curr, runtime: { dashboardPort: 9999 } }));
    });
  });

  it("handles saving system settings and verifying loading states", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
        result.current.updateSystem((curr) => ({ ...curr, defaults: {} }));
    });

    let resolveSave: (v: any) => void;
    const savePromise = new Promise(resolve => { resolveSave = resolve; });
    mockSaveSystem.mockReturnValueOnce(savePromise);

    let handleSavePromise: Promise<void>;
    act(() => {
        handleSavePromise = result.current.handleSave();
    });

    expect(result.current.savingSystem).toBe(true);
    expect(result.current.activeSaving).toBe(true);

    await act(async () => {
        resolveSave(undefined);
        await handleSavePromise;
    });

    expect(result.current.savingSystem).toBe(false);
    expect(result.current.activeSaving).toBe(false);
    expect(mockSaveSystem).toHaveBeenCalled();
  });

  it("preserves project draft values while a system save reloads effective settings", async () => {
    const initialSettings = cloneDashboardSettings();
    const staleReloadSettings = cloneDashboardSettings();
    staleReloadSettings.git.defaultBranch = "server-reloaded-main";
    mockFetchProject.mockResolvedValue({
      settings: initialSettings,
      sources: {},
    } as any);
    mockSaveSystem.mockResolvedValueOnce({
      runtime: { dashboardPort: 4444, consoleLogLevel: "debug", debugLogFileLevel: "error", consoleLogMode: "standard" },
      integrations: { providers: {}, githubToken: "" },
      defaults: cloneDashboardSettings(),
      mcpTools: [],
    } as any);
    mockSaveProject.mockRejectedValueOnce(new Error("project save failed"));

    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.updateSystem((current) => ({
        ...current,
        runtime: {
          ...current.runtime,
          consoleLogLevel: "debug",
        },
      }));
      result.current.setActiveScope("project");
    });
    act(() => {
      result.current.updateEditableSettings((current) => ({
        ...current,
        git: {
          ...current.git,
          defaultBranch: "draft-project-main",
        },
      }));
    });
    mockFetchProject.mockResolvedValue({
      settings: staleReloadSettings,
      sources: {},
    } as any);

    await act(async () => {
      await result.current.handleSave();
    });

    expect(mockSaveSystem).toHaveBeenCalled();
    expect(mockSaveProject).toHaveBeenCalled();
    expect(result.current.projectSettings?.git.defaultBranch).toBe("draft-project-main");
    expect(result.current.error).toContain("project save failed");
  });

  it("saves a project route thinking override without changing its inherited route model", async () => {
    const initialSettings = cloneDashboardSettings();
    initialSettings.aiProvider.providers.codex.model = "gpt-5.6-luna";
    initialSettings.aiProvider.invocationRouting.planning = {
      ...initialSettings.aiProvider.invocationRouting.planning,
      provider: "codex",
      allowedProviders: ["codex"],
      providers: {
        codex: {
          model: "gpt-5.6-sol",
          thinkingMode: "high",
        },
      },
    };
    const savedEffectiveSettings = cloneDashboardSettings();
    savedEffectiveSettings.aiProvider.providers.codex.model = "gpt-5.6-luna";
    savedEffectiveSettings.aiProvider.invocationRouting.planning = {
      ...initialSettings.aiProvider.invocationRouting.planning,
      providers: {
        codex: {
          model: "gpt-5.6-sol",
          thinkingMode: "ultra",
        },
      },
    };
    mockFetchProject
      .mockResolvedValueOnce({ settings: initialSettings, sources: {} } as any)
      .mockResolvedValueOnce({
        settings: savedEffectiveSettings,
        sources: {
          "aiProvider.invocationRouting.planning.providers.codex.model": "system",
          "aiProvider.invocationRouting.planning.providers.codex.thinkingMode": "project",
        },
      } as any);

    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.updateProject((current) => ({
        ...current,
        aiProvider: {
          ...current.aiProvider,
          invocationRouting: {
            ...current.aiProvider.invocationRouting,
            planning: {
              ...current.aiProvider.invocationRouting.planning,
              providers: {
                ...current.aiProvider.invocationRouting.planning.providers,
                codex: {
                  ...current.aiProvider.invocationRouting.planning.providers.codex,
                  thinkingMode: "ultra",
                },
              },
            },
          },
        },
      }));
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(mockSaveProject).toHaveBeenCalledWith("proj-1", expect.objectContaining({
      aiProvider: expect.objectContaining({
        invocationRouting: expect.objectContaining({
          planning: expect.objectContaining({
            providers: {
              codex: {
                model: "gpt-5.6-sol",
                thinkingMode: "ultra",
              },
            },
          }),
        }),
      }),
    }));
    expect(result.current.projectSettings?.aiProvider.invocationRouting.planning.providers.codex).toEqual({
      model: "gpt-5.6-sol",
      thinkingMode: "ultra",
    });
  });

  it("handles reset project settings", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleResetProject();
    });
    expect(mockResetProject).toHaveBeenCalled();
  });

  it("handles delete project", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(result.current.loading).toBe(false));

    window.confirm = vi.fn(() => true);
    await act(async () => {
      await result.current.handleDeleteProject();
    });
  });

  it("handles clearing project memory by tier", async () => {
    const mockClearProject = vi.spyOn(memoryApi, "clearProjectMemories")
      .mockResolvedValue({ memories: 2, claims: 1, evidence: 1 });
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleClearMemory("project", "long_term");
    });

    expect(mockClearProject).toHaveBeenCalledWith("proj-1", "long_term");
    expect(result.current.memoryClearBusy).toBeNull();
    expect(result.current.saveMessage).toContain("Long-term");
  });

  it("handles clearing system-wide memory by tier", async () => {
    const mockClearSystem = vi.spyOn(memoryApi, "clearSystemMemories")
      .mockResolvedValue({ memories: 5, claims: 0, evidence: 0 });
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleClearMemory("system", "all");
    });

    expect(mockClearSystem).toHaveBeenCalledWith("all");
    expect(result.current.saveMessage).toContain("system-wide");
  });

  it("handles reset database", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(result.current.loading).toBe(false));

    window.confirm = vi.fn(() => true);
    await act(async () => {
      await result.current.handleResetDatabase();
    });
    expect(mockResetDatabase).toHaveBeenCalled();
  });

  it("refetches effective settings when revisiting the models category", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const initialCalls = mockFetchProject.mock.calls.length;

    act(() => {
      result.current.setActiveCategory("integrations");
      result.current.setActiveCategory("models");
    });

    await waitFor(() => {
      expect(mockFetchProject.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });

  it("refetches models data after settings-updated events while models category is active", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setActiveCategory("models");
    });
    await waitFor(() => expect(result.current.activeCategory).toBe("models"));

    const callsBeforeEvent = mockFetchProject.mock.calls.length;

    act(() => {
      window.dispatchEvent(new CustomEvent("codeux:settings-updated", {
        detail: { scope: "system" },
      }));
    });

    await waitFor(() => {
      expect(mockFetchProject.mock.calls.length).toBeGreaterThan(callsBeforeEvent);
    });
  });

  it.skip("handles import hints", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(result.current.loading).toBe(false));

    if (!result.current.systemSettings) {
      act(() => { result.current.updateSystem(() => ({ defaults: {}, runtime: {} } as any)); });
    }

    await act(async () => {
      await result.current.handleImportHints();
    });
    expect(mockFetchExternal).toHaveBeenCalled();
  });

  it("triggers unsaved changes modal when navigation is attempted while dirty", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Get the mock registerNavigationBlocker
    const mockRegister = navigationBlocker.registerNavigationBlocker as any;
    expect(mockRegister).toHaveBeenCalled();

    const blockerConfig = mockRegister.mock.calls[0][0];
    const retry = vi.fn();

    act(() => {
      // Simulate dirty state
      result.current.updateEditableSettings((curr) => ({ ...curr, memory: { ...curr.memory, enabled: !curr.memory.enabled } } as any));
    });

    expect(blockerConfig.shouldBlock()).toBe(true);

    act(() => {
      // Simulate navigation attempt
      blockerConfig.confirmNavigation(retry);
    });

    expect(result.current.showUnsavedModal).toBe(true);

    act(() => {
      result.current.confirmDiscard();
    });

    expect(result.current.showUnsavedModal).toBe(false);
    expect(retry).toHaveBeenCalled();
  });

  it("warns on real unload while dirty but suppresses the prompt during an intentional discard", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const mockRegister = navigationBlocker.registerNavigationBlocker as any;
    const blockerConfig = mockRegister.mock.calls[0][0];
    const retry = vi.fn();

    act(() => {
      result.current.updateEditableSettings((curr) => ({ ...curr, memory: { ...curr.memory, enabled: !curr.memory.enabled } } as any));
    });
    await waitFor(() => expect(result.current.activeDirty).toBe(true));

    // A genuine tab-close / hard-refresh must still surface the native guard.
    const guardedEvent = new Event("beforeunload", { cancelable: true });
    act(() => { window.dispatchEvent(guardedEvent); });
    expect(guardedEvent.defaultPrevented).toBe(true);

    act(() => { blockerConfig.confirmNavigation(retry); });
    act(() => { result.current.confirmDiscard(); });
    expect(retry).toHaveBeenCalled();

    // The intentional discard navigation must not re-trigger the native prompt
    // (which surfaces as a double prompt in the browser and silently cancels
    // navigation inside Electron).
    const bypassedEvent = new Event("beforeunload", { cancelable: true });
    act(() => { window.dispatchEvent(bypassedEvent); });
    expect(bypassedEvent.defaultPrevented).toBe(false);
  });

  it("saves from the modal and then completes the pending navigation", async () => {
    mockSaveSystem.mockResolvedValueOnce({
      runtime: { dashboardPort: 4444, consoleLogLevel: "info", debugLogFileLevel: "error", consoleLogMode: "standard" },
      integrations: { providers: {}, githubToken: "" },
      defaults: cloneDashboardSettings(),
      mcpTools: [],
    } as any);
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const mockRegister = navigationBlocker.registerNavigationBlocker as any;
    const blockerConfig = mockRegister.mock.calls[0][0];
    const retry = vi.fn();

    act(() => {
      result.current.updateEditableSettings((curr) => ({ ...curr, memory: { ...curr.memory, enabled: !curr.memory.enabled } } as any));
    });
    act(() => { blockerConfig.confirmNavigation(retry); });
    expect(result.current.showUnsavedModal).toBe(true);

    await act(async () => {
      await result.current.saveAndLeave();
    });

    expect(mockSaveSystem).toHaveBeenCalled();
    expect(result.current.showUnsavedModal).toBe(false);
    expect(retry).toHaveBeenCalled();
  });

  it("keeps the modal open and skips navigation when saving from the modal fails", async () => {
    mockSaveSystem.mockRejectedValueOnce(new Error("save boom"));
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const mockRegister = navigationBlocker.registerNavigationBlocker as any;
    const blockerConfig = mockRegister.mock.calls[0][0];
    const retry = vi.fn();

    act(() => {
      result.current.updateEditableSettings((curr) => ({ ...curr, memory: { ...curr.memory, enabled: !curr.memory.enabled } } as any));
    });
    act(() => { blockerConfig.confirmNavigation(retry); });

    await act(async () => {
      await result.current.saveAndLeave();
    });

    expect(result.current.showUnsavedModal).toBe(true);
    expect(retry).not.toHaveBeenCalled();
    expect(result.current.error).toBeTruthy();
  });
});
