/** @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { forwardRef } from "preact/compat";
import { Sidebar } from "../Sidebar.js";
import * as ProjectDataHook from "../../../context/project-data.js";
import * as ProjectEffectiveSettingsHook from "../../../hooks/use-project-effective-settings.js";
import * as ReducedMotionHook from "../../../hooks/use-reduced-motion.js";
import * as RouterHook from "@tanstack/react-router";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
    set: vi.fn(),
    to: vi.fn(),
  },
}));

vi.mock("../../../context/project-data.js");
vi.mock("../../../hooks/use-project-effective-settings.js");
vi.mock("../../../hooks/use-reduced-motion.js");
vi.mock("../../../router/route-prefetch.js", () => ({
  prefetchRoute: vi.fn(),
}));
vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual("@tanstack/react-router");
  return {
    ...(actual as object),
    useRouterState: vi.fn(),
    Link: forwardRef(({ children, to, className, ...props }: any, ref: any) => (
      <a ref={ref} href={to} className={className} {...props}>
        {children}
      </a>
    )),
  };
});

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

describe("Sidebar shell navigation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: ResizeObserverMock,
    });
    vi.spyOn(ProjectDataHook, "useProjectData").mockReturnValue({ selectedProject: { id: "project-1" } } as any);
    vi.spyOn(ProjectEffectiveSettingsHook, "useProjectEffectiveSettings").mockReturnValue({
      data: { settings: { sprintPreview: { enabled: true, showInAppBrowser: true } } },
    } as any);
    vi.spyOn(ReducedMotionHook, "useReducedMotion").mockReturnValue(true);
    vi.spyOn(RouterHook, "useRouterState").mockReturnValue([{ pathname: "/tasks" }] as any);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("marks the active route with page semantics and preserves stable navigation labels", () => {
    render(<Sidebar />);

    expect(screen.getByRole("link", { name: "Tasks" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/config");
  });

  it("keeps minimized links accessible with explicit labels and visual-only tooltips", () => {
    window.localStorage.setItem("codeux:sidebar:minimized", "true");

    render(<Sidebar />);

    const tasksLink = screen.getByRole("link", { name: "Tasks" });
    expect(tasksLink).toHaveAttribute("aria-label", "Tasks");
    const tooltip = Array.from(tasksLink.querySelectorAll("[aria-hidden='true']")).find((node) => node.textContent?.includes("Tasks"));
    expect(tooltip).toBeInTheDocument();
  });

  it("removes Browser from the stable label set when preview browser navigation is hidden", () => {
    vi.spyOn(ProjectEffectiveSettingsHook, "useProjectEffectiveSettings").mockReturnValue({
      data: { settings: { sprintPreview: { enabled: true, showInAppBrowser: false } } },
    } as any);

    render(<Sidebar />);

    expect(screen.queryByRole("link", { name: "Browser" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Files" })).toBeInTheDocument();
  });

  it("focuses mobile navigation when opened and restores focus to the trigger on Escape", async () => {
    const onClose = vi.fn();
    const trigger = document.createElement("button");
    trigger.textContent = "Open mobile menu";
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(<Sidebar isMobile isOpen onClose={onClose} />);
    await vi.advanceTimersByTimeAsync(60);

    expect(screen.getByRole("dialog", { name: "Primary navigation" })).toContainElement(document.activeElement as HTMLElement);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
    await vi.advanceTimersByTimeAsync(1);
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
