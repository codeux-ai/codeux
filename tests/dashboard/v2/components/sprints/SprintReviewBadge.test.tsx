/** @vitest-environment happy-dom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SprintReviewBadge } from "../../../../../dashboard/src/v2/components/sprints/SprintReviewBadge.js";
import type { SprintReviewSummary } from "../../../../../dashboard/src/v2/types.js";
import { renderWithI18n } from "../../../render-with-i18n.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const baseSummary: SprintReviewSummary = {
  status: "completed",
  outcome: "pass",
  summary: "Looks perfect.",
  findings: [],
  reviewer: "QA Bot",
  finishedAt: "2024-01-01T00:00:00.000Z",
};

function trigger(): HTMLButtonElement {
  return screen.getByRole("button", { name: "QA review details" });
}

async function openWithPointer(): Promise<HTMLElement> {
  fireEvent.mouseEnter(trigger().parentElement as Element);
  return screen.findByRole("region", { name: /QA/i });
}

describe("SprintReviewBadge", () => {
  it("renders running review progress with reduced-motion-safe cues", () => {
    renderWithI18n(<SprintReviewBadge summary={{
      status: "running",
      outcome: null,
      summary: null,
      findings: [],
      reviewer: null,
      finishedAt: null,
    }} />);

    expect(screen.getByRole("status", { name: "QA review running" })).toHaveTextContent("Reviewing...");
    expect(document.querySelector("svg")).toHaveClass("motion-safe:animate-spin", "motion-reduce:animate-none");
    expect(screen.queryByRole("button", { name: "QA review details" })).toBeNull();
  });

  it.each([
    {
      name: "passed",
      summary: baseSummary,
      label: "QA passed",
      state: "passed",
      tone: "text-signal-600",
    },
    {
      name: "changes requested",
      summary: { ...baseSummary, outcome: "changes_requested", summary: "Please address the requested edits." },
      label: "QA changes requested",
      state: "changes_requested",
      tone: "text-blue-700",
    },
    {
      name: "provider failure",
      summary: { ...baseSummary, status: "failed", outcome: null, summary: "The provider stopped before returning a verdict." },
      label: "QA review failed",
      state: "failed",
      tone: "text-status-red",
    },
  ])("renders the $name state with distinct text, icon, and tone", ({ summary, label, state, tone }) => {
    const { container } = renderWithI18n(<SprintReviewBadge summary={summary} />);

    expect(screen.getByText(label)).toBeVisible();
    expect(trigger()).toHaveClass(tone);
    expect(trigger()).toHaveAccessibleDescription(new RegExp(label, "i"));
    expect(container.querySelector(`[data-qa-state="${state}"]`)).toBeTruthy();
    expect(container.querySelector(`[data-qa-icon="${state}"]`)).toBeTruthy();
  });

  it("opens on pointer hover and keeps the card open while the pointer moves into it", async () => {
    renderWithI18n(<SprintReviewBadge summary={baseSummary} />);
    const card = await openWithPointer();

    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(card).toHaveTextContent("Looks perfect.");

    fireEvent.mouseLeave(trigger().parentElement as Element);
    fireEvent.mouseEnter(card);
    await new Promise((resolve) => window.setTimeout(resolve, 140));
    expect(card).toBeVisible();
  });

  it("opens from keyboard focus, retains focus in disclosures, and restores the trigger on Escape", async () => {
    const user = userEvent.setup();
    renderWithI18n(<SprintReviewBadge summary={{
      ...baseSummary,
      outcome: "changes_requested",
      followUpTasks: [{
        title: "Repair the edge case",
        description: "Cover the missing path.",
        priority: "high",
        dependsOnTaskKeys: [],
        promptMarkdown: "Implement and test the edge-case repair.",
      }],
    }} />);

    await user.tab();
    expect(trigger()).toHaveFocus();
    const card = await screen.findByRole("region", { name: "QA Changes Requested" });

    await user.tab();
    const disclosure = within(card).getByRole("button", { name: "Follow-up task 1" });
    expect(disclosure).toHaveFocus();
    expect(card).toBeVisible();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "QA Changes Requested" })).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it("supports click and touch-style activation and dismisses on an outside pointer", async () => {
    renderWithI18n(<SprintReviewBadge summary={baseSummary} />);

    fireEvent.click(trigger());
    expect(await screen.findByRole("region", { name: "QA Review Passed" })).toBeVisible();

    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "QA Review Passed" })).toBeNull();
    });
  });

  it("shows labelled review context and all requested-change guidance without relying on color", async () => {
    renderWithI18n(<SprintReviewBadge summary={{
      ...baseSummary,
      outcome: "changes_requested",
      summary: "Authentication needs one more guard.",
      findings: ["Reject expired sessions", "Cover the timeout branch"],
      fixInstructions: "Validate expiry before loading the protected resource.",
      targetTaskKey: "T17",
    }} />);

    const card = await openWithPointer();
    expect(within(card).getByText("QA Changes Requested")).toBeVisible();
    expect(within(card).getByText("Summary")).toBeVisible();
    expect(within(card).getByText("Authentication needs one more guard.")).toBeVisible();
    expect(within(card).getByRole("region", { name: "Review findings" })).toHaveTextContent("Findings (2)");
    expect(within(card).getByText("Reject expired sessions")).toBeVisible();
    expect(within(card).getByText("Fix instructions")).toBeVisible();
    expect(within(card).getByText("Validate expiry before loading the protected resource.")).toBeVisible();
    expect(within(card).getByText("Target task")).toBeVisible();
    expect(within(card).getByText("T17")).toBeVisible();
    expect(within(card).getByText("Reviewer")).toBeVisible();
    expect(within(card).getByText("Reviewed by QA Bot")).toBeVisible();
  });

  it("keeps follow-up specifications collapsed until their native disclosures are expanded", async () => {
    const user = userEvent.setup();
    renderWithI18n(<SprintReviewBadge summary={{
      ...baseSummary,
      outcome: "changes_requested",
      followUpTasks: [{
        title: "Harden session expiry",
        description: "Reject stale sessions before data access.",
        priority: "critical",
        dependsOnTaskKeys: ["T15", "T16"],
        promptMarkdown: "Add expiry validation.\nInclude deterministic regression coverage.",
      }],
    }} />);

    fireEvent.click(trigger());
    const disclosure = await screen.findByRole("button", { name: "Follow-up task 1" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Harden session expiry")).toBeNull();
    expect(screen.queryByText(/Add expiry validation/)).toBeNull();

    await user.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Harden session expiry")).toBeVisible();
    expect(screen.getByText("Reject stale sessions before data access.")).toBeVisible();
    expect(screen.getByText("critical")).toBeVisible();
    expect(screen.getByText("T15, T16")).toBeVisible();
    expect(screen.getByText(/Add expiry validation/)).toBeVisible();
  });

  it("handles long wrapping content and missing optional metadata", async () => {
    const longSummary = "A long review explanation ".repeat(40);
    renderWithI18n(<SprintReviewBadge summary={{
      status: "completed",
      outcome: "pass",
      summary: longSummary,
      findings: [],
      reviewer: null,
      finishedAt: null,
    }} />);

    const card = await openWithPointer();
    expect(card).toHaveClass("max-h-[calc(100vh-1.5rem)]", "max-w-[calc(100vw-1.5rem)]", "overflow-y-auto");
    expect(within(card).getByText(/A long review explanation/)).toHaveClass("break-words");
    expect(within(card).queryByText("Reviewer")).toBeNull();
    expect(within(card).queryByText("Fix instructions")).toBeNull();
    expect(within(card).queryByRole("region", { name: "Follow-up tasks" })).toBeNull();
  });

  it("provides an honest fallback when all optional details are missing", async () => {
    renderWithI18n(<SprintReviewBadge summary={{
      status: "completed",
      outcome: "pass",
      summary: null,
      findings: [],
      reviewer: null,
      finishedAt: null,
    }} />);

    const card = await openWithPointer();
    expect(within(card).getByText("No additional review details were provided.")).toBeVisible();
  });

  it("positions the viewport-aware card beside its trigger", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getRect() {
      if (this.getAttribute("aria-label") === "QA review details") {
        return {
          x: 120, y: 80, top: 80, left: 120, right: 136, bottom: 96, width: 16, height: 16,
          toJSON: () => ({}),
        } as DOMRect;
      }
      if (this.getAttribute("role") === "region") {
        return {
          x: 0, y: 0, top: 0, left: 0, right: 320, bottom: 180, width: 320, height: 180,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return {
        x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });

    renderWithI18n(<SprintReviewBadge summary={baseSummary} align="left" />);
    const card = await openWithPointer();
    await waitFor(() => {
      expect(card.style.left).toBe("146px");
    });
  });
});
