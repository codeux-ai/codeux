// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook, render, screen, fireEvent, waitFor } from "@testing-library/preact";
import { UnsavedChangesModal } from "../../../dashboard/src/v2/components/ui/UnsavedChangesModal.js";
import { NumberInput } from "../../../dashboard/src/v2/components/settings/SettingsFormFields.js";
import { useUnsavedChangesGuard } from "../../../dashboard/src/v2/hooks/useUnsavedChangesGuard.js";
import { getNavigationBlockerCount } from "../../../dashboard/src/v2/router/navigation-blocker.js";

vi.mock("gsap", () => {
  const gsap = {
    fromTo: vi.fn((_target, _from, to) => {
      to?.onComplete?.();
      return { kill: vi.fn() };
    }),
    to: vi.fn((_target, to) => {
      to?.onComplete?.();
      return { kill: vi.fn() };
    }),
    set: vi.fn(),
    killTweensOf: vi.fn(),
    context: vi.fn(() => ({ add: (callback: () => void) => callback(), revert: vi.fn() })),
  };
  return { default: gsap, gsap };
});

describe("useUnsavedChangesGuard", () => {
  const originalConfirm = window.confirm;

  beforeEach(() => {
    window.confirm = vi.fn(() => true);
    window.history.replaceState({}, "", "/config");
  });

  afterEach(() => {
    cleanup();
    window.confirm = originalConfirm;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("registers beforeunload only while dirty and clears on clean/unmount", () => {
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

    const { rerender, unmount } = renderHook(({ dirty }) => useUnsavedChangesGuard(dirty), {
      initialProps: { dirty: false },
    });

    expect(addEventListenerSpy.mock.calls.some(([type]) => type === "beforeunload")).toBe(false);

    rerender({ dirty: true });
    expect(addEventListenerSpy.mock.calls.some(([type]) => type === "beforeunload")).toBe(true);

    rerender({ dirty: false });
    expect(removeEventListenerSpy.mock.calls.some(([type]) => type === "beforeunload")).toBe(true);

    unmount();
    expect(getNavigationBlockerCount()).toBe(0);
  });

  it("prevents browser unload while dirty", () => {
    renderHook(() => useUnsavedChangesGuard(true));

    const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    Object.defineProperty(event, "returnValue", { writable: true, configurable: true, value: undefined });

    const dispatchResult = window.dispatchEvent(event);

    expect(dispatchResult).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it("blocks and allows internal navigation based on confirmation", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    confirmSpy.mockReturnValue(false);

    renderHook(() => useUnsavedChangesGuard(true));

    window.history.pushState({}, "", "/agents");
    expect(window.location.pathname).toBe("/config");
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    confirmSpy.mockReturnValue(true);
    window.history.pushState({}, "", "/agents");
    expect(window.location.pathname).toBe("/agents");
  });

  it("uses explicit unsaved-change messaging for internal navigation prompts", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    renderHook(() => useUnsavedChangesGuard(true, {
      message: "Settings have local edits that are not saved yet. Leave without saving?",
    }));

    window.history.pushState({}, "", "/integrations");

    expect(window.location.pathname).toBe("/config");
    expect(confirmSpy).toHaveBeenCalledWith("Settings have local edits that are not saved yet. Leave without saving?");
  });

  it("stops prompting immediately after dirty state is cleared", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    const { rerender } = renderHook(({ dirty }) => useUnsavedChangesGuard(dirty), {
      initialProps: { dirty: true },
    });

    window.history.pushState({}, "", "/sprints");
    expect(window.location.pathname).toBe("/config");
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    rerender({ dirty: false });

    window.history.pushState({}, "", "/sprints");
    expect(window.location.pathname).toBe("/sprints");
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it("restores navigation behavior after unmount", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    const { unmount } = renderHook(() => useUnsavedChangesGuard(true));

    unmount();

    expect(getNavigationBlockerCount()).toBe(0);
    window.history.pushState({}, "", "/memory");
    expect(window.location.pathname).toBe("/memory");
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});


describe("UnsavedChangesModal rendering", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders action buttons with w-full for mobile layouts", () => {
    const { container } = render(
      <UnsavedChangesModal
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />
    );
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((btn) => {
      expect(btn.className).toContain("w-full");
    });
  });

  it("reveals locally derived numeric validation after the field is visited", async () => {
    render(
      <NumberInput
        value={0}
        onChange={vi.fn()}
        min={1}
        max={10}
        aria-label="Retry budget"
        helperText="Use a value from 1 to 10."
      />,
    );

    const input = screen.getByRole("spinbutton", { name: "Retry budget" });
    expect(input.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.input(input, { target: { value: "0" } });

    await waitFor(() => expect(input.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByRole("alert").textContent).toContain("Use a value of at least 1.");
  });
});

describe("SettingsPage reset confirmation", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("gates the header project reset side effect behind cancelable confirmation", async () => {
    vi.resetModules();
    const handleResetProject = vi.fn().mockResolvedValue(undefined);

    vi.doMock("../../../dashboard/src/v2/hooks/use-settings-page-state.js", () => ({
      useSettingsPageState: () => ({
        clearFeedback: vi.fn(),
        activeCategory: "general",
        activeScope: "project",
        setActiveScope: vi.fn(),
        settingsSearch: "",
        setSettingsSearch: vi.fn(),
        activeCategoryConfig: {
          label: "General",
          description: "General settings",
          icon: () => null,
          danger: false,
        },
        filteredCategories: [{ id: "general", label: "General" }],
        settingsSearchMatches: {},
        error: null,
        selectedProject: { id: "project-1", name: "Approved local test project" },
        activeDirty: false,
        activeSaving: false,
        loading: false,
        saveMessage: null,
        handleSave: vi.fn(),
        handleResetProject,
        resettingProject: false,
        showUnsavedModal: false,
        confirmDiscard: vi.fn(),
        cancelDiscard: vi.fn(),
        saveAndLeave: vi.fn(),
        setActiveCategory: vi.fn(),
        searchInputRef: { current: null },
      }),
    }));
    vi.doMock("../../../dashboard/src/v2/components/settings/SettingsCategoryRail.js", () => ({
      CATEGORIES: [{ id: "general", label: "General", description: "General settings", icon: () => null }],
      SettingsCategoryRail: () => null,
    }));
    vi.doMock("../../../dashboard/src/v2/components/settings/SettingsContentPanels.js", () => ({
      SettingsContentPanels: () => null,
    }));

    const { SettingsPage } = await import("../../../dashboard/src/v2/SettingsPage.js");

    render(<SettingsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Reset Project" }));
    expect(handleResetProject).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Reset Project Overrides" }).textContent).toContain("Approved local test project");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Reset Project Overrides" })).toBeNull());
    expect(handleResetProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reset Project" }));
    vi.useFakeTimers();
    const confirmButton = screen.getByRole("button", { name: "Hold to Reset Project" });
    fireEvent.pointerDown(confirmButton, { button: 0, pointerId: 1 });
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    vi.useRealTimers();

    await waitFor(() => {
      expect(handleResetProject).toHaveBeenCalledTimes(1);
    });
  });
});
