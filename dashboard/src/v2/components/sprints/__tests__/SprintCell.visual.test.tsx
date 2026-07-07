// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Sprint } from "../../../types.js";
import { ORGANIC_CELL_SHADOW_CLASS } from "../../ui/organic-cell-styles.js";
import { SprintCell } from "../SprintCell.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
    killTweensOf: vi.fn(),
    set: vi.fn(),
    to: vi.fn(),
  },
}));

vi.mock("../../../hooks/use-reduced-motion.js", () => ({
  useReducedMotion: () => true,
  useResolvedMotionDuration: <T,>(duration: T) => duration,
}));

const sprint: Sprint = {
  date: "2026-01-01T00:00:00.000Z",
  projectId: "project-1",
  originalPrompt: "Build the dashboard",
  startDate: null,
  endDate: null,
  featureBranch: null,
  baseCommitSha: null,
  latestReview: undefined,
  id: "sprint-1",
  number: 1,
  slug: "sprint-1",
  name: "Dashboard polish",
  isGeneratedName: false,
  status: "idle",
  goal: "Polish dashboard cells",
  tasksCount: 3,
  completion: 25,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  showcasePinned: false,
  linkedIssues: [],
};

describe("SprintCell visuals", () => {
  afterEach(() => {
    cleanup();
  });

  it("uses the shared organic project-cell background shadow", () => {
    const { container } = render(
      <SprintCell
        sprint={sprint}
        isEven={false}
        accentColor="text-signal-600 dark:text-signal-300"
      />,
    );

    const shadowUnderlay = container.querySelector("[data-organic-cell-shadow]");

    expect(shadowUnderlay).toBeInTheDocument();
    expect(shadowUnderlay).toHaveClass(...ORGANIC_CELL_SHADOW_CLASS.split(" "));
    expect(shadowUnderlay?.className).not.toContain("drop-shadow");
  });

  it("keeps hover-revealed card actions keyboard reachable and reduced-motion visible", () => {
    const { container } = render(
      <SprintCell
        sprint={sprint}
        isEven={false}
        accentColor="text-signal-600 dark:text-signal-300"
        onPrimaryAction={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Start sprint Dashboard polish" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open actions menu for sprint Dashboard polish" })).toBeInTheDocument();
    expect(screen.getByText("Draft").parentElement).toHaveClass("motion-reduce:opacity-100");

    const actionCluster = container.querySelector(".group-focus-within\\:opacity-100");
    expect(actionCluster).toBeInTheDocument();
  });

  it("shows target-specific busy state for the primary sprint action", () => {
    const onPrimaryAction = vi.fn();
    render(
      <SprintCell
        sprint={sprint}
        isEven={false}
        accentColor="text-signal-600 dark:text-signal-300"
        primaryBusy
        onPrimaryAction={onPrimaryAction}
      />,
    );

    const startButton = screen.getByRole("button", { name: "Start sprint Dashboard polish is pending" });
    expect(startButton).toBeDisabled();
    expect(startButton).toHaveAttribute("aria-busy", "true");

    fireEvent.click(startButton);
    expect(onPrimaryAction).not.toHaveBeenCalled();
  });
});
