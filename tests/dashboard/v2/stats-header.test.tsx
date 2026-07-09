/** @vitest-environment happy-dom */
import { h } from "preact";
/** @jsx h */
import { useState } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { StatsHeader } from "../../../dashboard/src/v2/components/StatsHeader.js";
import type { DashboardStats } from "../../../dashboard/src/types.js";

expect.extend(matchers);

const gsapMock = vi.hoisted(() => ({
  fromTo: vi.fn(),
  to: vi.fn((target: Record<string, unknown>, vars: Record<string, unknown>) => {
    for (const key of ["offset", "size", "opacity"]) {
      if (key in vars) {
        target[key] = vars[key];
      }
    }
    if (typeof vars.onUpdate === "function") {
      vars.onUpdate();
    }
    if (typeof vars.onComplete === "function") {
      vars.onComplete();
    }
  }),
  set: vi.fn((target: Record<string, unknown>, vars: Record<string, unknown>) => {
    Object.assign(target, vars);
  }),
  context: vi.fn(() => ({ revert: vi.fn() })),
  killTweensOf: vi.fn(),
  registerPlugin: vi.fn(),
}));

vi.mock("gsap", () => ({
  default: gsapMock,
  gsap: gsapMock,
}));

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useReducedMotion: vi.fn(() => false),
  useResolvedMotionDuration: <T extends number | string>(duration: T): T => duration,
}));

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

type HeaderView = "stats" | "race" | "dag";

const visibleStats: DashboardStats = {
  total: 0,
  running: 0,
  codingCompleted: 0,
  completed: 0,
  failed: 0,
  ci: 0,
  qa: 0,
  automerge: 0,
  merged: 0,
  mergeBlocked: 0,
  mergeConflicts: 0,
};

function StatsHeaderHarness({ initialView = "stats" }: { initialView?: HeaderView }) {
  const [headerView, setHeaderView] = useState<HeaderView>(initialView);

  return (
    <StatsHeader
      headerView={headerView}
      setHeaderView={setHeaderView}
      visibleStats={visibleStats}
      hasSprintContext={true}
      hasLiveSprint={false}
      initialLoadComplete={true}
      liveSprintRun={null}
      pausedInterventionRun={null}
      scopedFeatureBranch={null}
      selectedSession={null}
      statusTimestamp={null}
    />
  );
}

describe("StatsHeader view toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.ResizeObserver = ResizeObserverMock;

    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        return this.getAttribute("role") === "tab" ? 72 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetLeft", {
      configurable: true,
      get() {
        const parent = this.parentElement;
        if (!parent || this.getAttribute("role") !== "tab") {
          return 0;
        }
        return Array.from(parent.querySelectorAll('[role="tab"]')).indexOf(this) * 76;
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("uses one shared active indicator while click selection updates ARIA state", () => {
    render(<StatsHeaderHarness initialView="stats" />);

    const tablist = screen.getByRole("tablist", { name: "View toggle" });
    const indicator = tablist.querySelector('[aria-hidden="true"]');
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveClass("bg-white", "dark:bg-void-700");

    const statsTab = screen.getByRole("tab", { name: /stats/i });
    const raceTab = screen.getByRole("tab", { name: /race/i });
    const dagTab = screen.getByRole("tab", { name: /dag/i });

    expect(statsTab).toHaveAttribute("aria-selected", "true");
    expect(statsTab).toHaveAttribute("tabindex", "0");
    expect(raceTab).toHaveAttribute("aria-selected", "false");
    expect(raceTab).toHaveAttribute("tabindex", "-1");

    fireEvent.click(raceTab);

    expect(statsTab).toHaveAttribute("aria-selected", "false");
    expect(statsTab).toHaveAttribute("tabindex", "-1");
    expect(raceTab).toHaveAttribute("aria-selected", "true");
    expect(raceTab).toHaveAttribute("tabindex", "0");
    expect(dagTab).toHaveAttribute("aria-selected", "false");
    expect(dagTab).toHaveAttribute("tabindex", "-1");
  });

  it("moves focus with arrow and Home/End keys without duplicating selection logic", () => {
    render(<StatsHeaderHarness initialView="stats" />);

    const statsTab = screen.getByRole("tab", { name: /stats/i });
    const raceTab = screen.getByRole("tab", { name: /race/i });
    const dagTab = screen.getByRole("tab", { name: /dag/i });

    statsTab.focus();
    fireEvent.keyDown(statsTab, { key: "ArrowRight" });
    expect(raceTab).toHaveFocus();

    fireEvent.keyDown(raceTab, { key: "ArrowRight" });
    expect(dagTab).toHaveFocus();

    fireEvent.keyDown(dagTab, { key: "ArrowRight" });
    expect(statsTab).toHaveFocus();

    fireEvent.keyDown(statsTab, { key: "ArrowLeft" });
    expect(dagTab).toHaveFocus();

    fireEvent.keyDown(dagTab, { key: "Home" });
    expect(statsTab).toHaveFocus();

    fireEvent.keyDown(statsTab, { key: "End" });
    expect(dagTab).toHaveFocus();

    fireEvent.keyDown(dagTab, { key: "ArrowDown" });
    expect(statsTab).toHaveFocus();

    fireEvent.keyDown(statsTab, { key: "ArrowUp" });
    expect(dagTab).toHaveFocus();

    expect(statsTab).toHaveAttribute("aria-selected", "true");
    expect(statsTab).toHaveAttribute("tabindex", "0");
    expect(raceTab).toHaveAttribute("aria-selected", "false");
    expect(raceTab).toHaveAttribute("tabindex", "-1");
    expect(dagTab).toHaveAttribute("aria-selected", "false");
    expect(dagTab).toHaveAttribute("tabindex", "-1");
  });
});
