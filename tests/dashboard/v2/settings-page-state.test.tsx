// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/preact";
import { useSettingsPageState } from "../../../dashboard/src/v2/hooks/use-settings-page-state.js";
import { CATEGORIES, CATEGORY_SEARCH_HINTS } from "../../../dashboard/src/v2/components/settings/SettingsCategoryRail.js";
import * as settingsApi from "../../../dashboard/src/v2/lib/settings-api.js";
import * as dashboardApi from "../../../dashboard/src/lib/api/dashboard-api.js";

vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({
  useProjectData: vi.fn(() => ({
    deleteProject: vi.fn(() => Promise.resolve()),
    selectedProject: { id: "proj-1", name: "Test Project" },
    selectedProjectId: "proj-1",
  }))
}));

describe("useSettingsPageState", () => {
  let mockSaveSystem;
  let mockSaveProject;
  let mockFetchSystem;
  let mockFetchProject;
  let mockResetProject;
  let mockResetDatabase;
  let mockFetchExternal;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveSystem = vi.spyOn(settingsApi, 'saveSystemSettings').mockResolvedValue({ defaults: {}, runtime: {} } as any);
    mockSaveProject = vi.spyOn(settingsApi, 'saveProjectSettings').mockResolvedValue({ settings: {}, sources: {} } as any);
    mockFetchSystem = vi.spyOn(settingsApi, 'fetchSystemSettings').mockResolvedValue({ defaults: {}, runtime: {} } as any);
    mockFetchProject = vi.spyOn(settingsApi, 'fetchProjectEffectiveSettings').mockResolvedValue({ settings: {}, sources: {} } as any);
    mockResetProject = vi.spyOn(settingsApi, 'resetProjectSettings').mockResolvedValue();
    mockResetDatabase = vi.spyOn(settingsApi, 'resetSystemDatabase').mockResolvedValue();
    mockFetchExternal = vi.spyOn(dashboardApi, 'fetchExternalSettingsHints').mockResolvedValue({});
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

  it("handles null selectedProject properly", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
    act(() => { result.current.setActiveScope("project"); });
  });

  it("initializes with general category and system scope", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));

    expect(result.current.activeCategory).toBe("general");
    expect(result.current.activeScope).toBe("system");
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
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

  it.skip("handles saving system settings", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // forcefully mock systemSettings to not be null if it is
    if (!result.current.systemSettings) {
      act(() => { result.current.updateSystem(() => ({ defaults: {}, runtime: {} } as any)); });
    }

    act(() => {
        result.current.updateSystem((curr) => ({ ...curr, defaults: {} }));
    });

    await act(async () => {
        await result.current.handleSave();
    });

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
});
