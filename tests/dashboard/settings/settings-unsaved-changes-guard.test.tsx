// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, renderHook, render } from "@testing-library/preact";
import { UnsavedChangesModal } from "../../../dashboard/src/v2/components/ui/UnsavedChangesModal.js";
import { useUnsavedChangesGuard } from "../../../dashboard/src/v2/hooks/useUnsavedChangesGuard.js";
import { getNavigationBlockerCount } from "../../../dashboard/src/v2/router/navigation-blocker.js";

describe("useUnsavedChangesGuard", () => {
  const originalConfirm = window.confirm;

  beforeEach(() => {
    window.confirm = vi.fn(() => true);
    window.history.replaceState({}, "", "/config");
  });

  afterEach(() => {
    cleanup();
    window.confirm = originalConfirm;
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
});
