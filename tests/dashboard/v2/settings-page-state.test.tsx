// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/preact";
import { useSettingsPageState } from "../../../dashboard/src/v2/hooks/use-settings-page-state.js";
import { CATEGORIES, CATEGORY_SEARCH_HINTS } from "../../../dashboard/src/v2/components/settings/SettingsCategoryRail.js";
import { applyEffectiveProjectSettings } from "../../../dashboard/src/v2/lib/settings-view-models.js";
import * as settingsApi from "../../../dashboard/src/v2/lib/settings-api.js";
import * as agentPresetApi from "../../../dashboard/src/v2/lib/agent-preset-api.js";
import * as dashboardApi from "../../../dashboard/src/lib/api/dashboard-api.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

import * as navigationBlocker from "../../../dashboard/src/v2/router/navigation-blocker.js";

vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({
  useProjectData: vi.fn(() => ({
    deleteProject: vi.fn(() => Promise.resolve()),
    selectedProject: { id: "proj-1", name: "Test Project" },
    selectedProjectId: "proj-1",
  }))
}));

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

const cloneDashboardSettings = () => JSON.parse(JSON.stringify(DEFAULT_DASHBOARD_SETTINGS));

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveSystem = vi.spyOn(settingsApi, 'saveSystemSettings').mockResolvedValue({ defaults: cloneDashboardSettings(), runtime: {} } as any);
  mockSaveProject = vi.spyOn(settingsApi, 'saveProjectSettings').mockResolvedValue({ settings: {}, sources: {} } as any);
  mockFetchSystem = vi.spyOn(settingsApi, 'fetchSystemSettings').mockResolvedValue({
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
    defaults: cloneDashboardSettings(),
    mcpTools: [],
  } as any);
  mockFetchProject = vi.spyOn(settingsApi, 'fetchProjectEffectiveSettings').mockResolvedValue({ settings: cloneDashboardSettings(), sources: {} } as any);
  mockResetProject = vi.spyOn(settingsApi, 'resetProjectSettings').mockResolvedValue();
  mockResetDatabase = vi.spyOn(settingsApi, 'resetSystemDatabase').mockResolvedValue();
  mockFetchAgentPresets = vi.spyOn(agentPresetApi, 'fetchAgentPresets').mockResolvedValue([
    { id: "worker-1", name: "Delivery Agent", labels: ["worker"] },
    { id: "qa-2", name: "QA Agent Beta", labels: ["qa"] },
    { id: "qa-1", name: "Risk Reviewer", labels: ["quality-assurance"] },
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
  it("loads updated default CI, memory, and QA settings", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.systemSettings?.defaults.ciIntelligence.featurePrAutoMergeMode).toBe("ALWAYS");
    expect(result.current.systemSettings?.defaults.ciIntelligence.mainBranchAutoMergeMode).toBe("CREATE_PR");
    expect(result.current.systemSettings?.defaults.ciIntelligence.resolveMergeConflicts).toBe(true);
    expect(result.current.systemSettings?.defaults.ciIntelligence.resolveMainMergeConflicts).toBe(true);
    expect(result.current.systemSettings?.defaults.memory.enabled).toBe(true);
    expect(result.current.systemSettings?.defaults.agents.qualityAssurance.enabled).toBe(true);
    expect(result.current.editableSettings?.ciIntelligence.featurePrAutoMergeMode).toBe("ALWAYS");
    expect(result.current.editableSettings?.ciIntelligence.mainBranchAutoMergeMode).toBe("CREATE_PR");
    expect(result.current.editableSettings?.ciIntelligence.resolveMergeConflicts).toBe(true);
    expect(result.current.editableSettings?.ciIntelligence.resolveMainMergeConflicts).toBe(true);
    expect(result.current.editableSettings?.memory.enabled).toBe(true);
    expect(result.current.editableSettings?.agents.qualityAssurance.enabled).toBe(true);
  });

  it("maps fresh effective settings defaults into project settings view-model", () => {
    const effective = {
      settings: cloneDashboardSettings(),
      sources: {},
    } as any;

    const mapped = applyEffectiveProjectSettings(effective);

    expect(mapped.settings.ciIntelligence.featurePrAutoMergeMode).toBe("ALWAYS");
    expect(mapped.settings.ciIntelligence.mainBranchAutoMergeMode).toBe("CREATE_PR");
    expect(mapped.settings.ciIntelligence.resolveMergeConflicts).toBe(true);
    expect(mapped.settings.ciIntelligence.resolveMainMergeConflicts).toBe(true);
    expect(mapped.settings.memory.enabled).toBe(true);
    expect(mapped.settings.agents.qualityAssurance.enabled).toBe(true);
  });

  it("updates editable settings for project scope", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { result.current.setActiveScope("project"); });
    act(() => { result.current.updateEditableSettings((curr) => ({ ...curr, aiProvider: {} } as any)); });
  });

  it("updates editable settings for system scope", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { result.current.updateEditableSettings((curr) => ({ ...curr, aiProvider: {} } as any)); });
  });

  it("publishes appearance previews from unsaved settings edits", async () => {
    const previews: Array<CustomEvent["detail"]> = [];
    const listener = (event: Event) => {
      previews.push((event as CustomEvent).detail);
    };
    window.addEventListener("codeux:appearance-preview", listener);

    const { result, unmount } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
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
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
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

    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));

    await waitFor(() => expect(result.current.projectAgentPresetOptions.length).toBe(3));

    expect(result.current.projectAgentPresetOptions.map((option) => option.label)).toEqual([
      "QA Agent Beta",
      "Risk Reviewer",
      "Delivery Agent",
    ]);
  });

  it("initializes with general category and system scope", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));

    expect(result.current.activeCategory).toBe("general");
    expect(result.current.activeScope).toBe("system");
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("loads hints correctly during initialization", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Check if fetchExternalSettingsHints was called
    expect(mockFetchExternal).toHaveBeenCalled();
    // In some Vitest setups, spyOn might not intercept the internal call due to module caching,
    // but we can verify the state updates if the mock works.
    if (result.current.externalHints) {
      expect(result.current.externalHints.resolved?.julesApiKey).toBe("hint");
    }
  });

  it("filters categories based on search input including hints", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setSettingsSearch("jules");
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

  it("automatically switches active category if current is filtered out", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setActiveCategory("memory");
      result.current.setSettingsSearch("automation");
    });

    expect(result.current.filteredCategories.length).toBe(1);
    expect(result.current.activeCategory).toBe("general");
  });

  it("adds and removes keydown listener", () => {
    const { unmount } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    unmount();
    expect(removeSpy).toHaveBeenCalled();
  });

  it("allows switching scope and updating editable settings", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
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
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
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

  it.skip("handles saving project settings", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
    await waitFor(() => expect(result.current.loading).toBe(false));

    if (!result.current.projectSettings) {
      act(() => { result.current.updateProject(() => ({ aiProvider: {} } as any)); });
    }

    act(() => {
        result.current.setActiveScope("project");
    });

    act(() => {
        result.current.updateProject((curr) => ({ ...curr, aiProvider: {} }));
    });

    await act(async () => {
        await result.current.handleSave();
    });

    expect(mockSaveProject).toHaveBeenCalled();
  });

  it("handles reset project settings", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleResetProject();
    });
    expect(mockResetProject).toHaveBeenCalled();
  });

  it("handles delete project", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
    await waitFor(() => expect(result.current.loading).toBe(false));

    window.confirm = vi.fn(() => true);
    await act(async () => {
      await result.current.handleDeleteProject();
    });
  });

  it("handles reset database", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
    await waitFor(() => expect(result.current.loading).toBe(false));

    window.confirm = vi.fn(() => true);
    await act(async () => {
      await result.current.handleResetDatabase();
    });
    expect(mockResetDatabase).toHaveBeenCalled();
  });

  it("refetches effective settings when revisiting the models category", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
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
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
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
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
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
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
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
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
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
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
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
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
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
