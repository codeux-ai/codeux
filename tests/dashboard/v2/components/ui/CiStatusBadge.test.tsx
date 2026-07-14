/** @vitest-environment happy-dom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { CiStatusBadge } from "../../../../../dashboard/src/v2/components/ui/CiStatusBadge.js";
import type { CiStatusPresentation } from "../../../../../dashboard/src/v2/lib/ci-status-presentation.js";

afterEach(cleanup);

function presentation(state: CiStatusPresentation["state"]): CiStatusPresentation {
  const failed = state === "failed";
  return {
    scope: "task",
    state,
    label: failed ? "CI failed" : state === "in_progress" ? "CI running" : state === "successful" ? "CI passed" : "CI pending",
    accessibleLabel: failed
      ? "CI failed. Pull request: Pull request ready. Checks: Checks failed. Merge: Blocked by checks."
      : "CI running. Pull request: Pull request ready. Checks: Checks running. Merge: Waiting for checks.",
    steps: [
      { id: "pull_request", label: "Pull request", state: "successful", statusLabel: "Pull request ready" },
      { id: "checks", label: "Checks", state, statusLabel: failed ? "Checks failed" : state === "in_progress" ? "Checks running" : state === "successful" ? "Checks passed" : "Checks pending", ...(failed ? { failureKind: "ci_checks" as const } : {}) },
      { id: "merge", label: "Merge", state: state === "successful" ? "successful" : "pending", statusLabel: state === "successful" ? "Merged" : "Waiting for checks" },
    ],
    ...(failed ? { failureKind: "ci_checks" } : {}),
  };
}

describe("CiStatusBadge", () => {
  it("renders failed checks with a visible, accessible red X treatment", () => {
    const { container } = render(<CiStatusBadge presentation={presentation("failed")} />);
    expect(screen.getByText("CI failed")).toBeVisible();
    const trigger = screen.getByRole("button", { name: /CI status: CI failed.*Show workflow details/i });
    expect(trigger).toHaveClass("text-status-red");
    const failureIcon = container.querySelector('[data-ci-icon="failure"]');
    expect(failureIcon).toBeTruthy();
    expect(failureIcon).toHaveClass("text-status-red");
  });

  it("opens every workflow step from the keyboard and restores focus on Escape", async () => {
    const user = userEvent.setup();
    render(<CiStatusBadge presentation={presentation("in_progress")} />);
    const trigger = screen.getByRole("button", { name: /Show workflow details/i });

    await user.tab();
    expect(trigger).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const details = screen.getByRole("region", { name: "CI workflow details" });
    expect(details).toBeVisible();
    expect(screen.getByText("Pull request")).toBeVisible();
    expect(screen.getByText("Checks")).toBeVisible();
    expect(screen.getByText("Merge")).toBeVisible();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "CI workflow details" })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("keeps progress animation reduced-motion safe and pending states non-red", () => {
    const { container, rerender } = render(<CiStatusBadge presentation={presentation("in_progress")} />);
    const progressIcon = container.querySelector('[data-ci-icon="in_progress"]');
    expect(progressIcon).toHaveClass("motion-safe:animate-spin", "motion-reduce:animate-none");
    expect(screen.getByRole("button")).not.toHaveClass("text-status-red");

    rerender(<CiStatusBadge presentation={presentation("pending")} />);
    expect(screen.getByText("CI pending")).toBeVisible();
    expect(screen.getByRole("button")).not.toHaveClass("text-status-red");
  });

  it("renders nothing when the presentation model has no related evidence", () => {
    const { container } = render(<CiStatusBadge presentation={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
