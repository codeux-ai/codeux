/** @jsx h */
/** @vitest-environment happy-dom */
import { h } from "preact";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SprintReviewBadge } from "../../../../../dashboard/src/v2/components/sprints/SprintReviewBadge";

const requestedChangesSummary = {
  status: "completed",
  outcome: "changes_requested",
  summary: "Please address the blocking review notes.",
  findings: ["Add the missing validation", "Cover the keyboard path"],
  reviewer: "QA Reviewer",
  finishedAt: "2024-01-01T00:00:00.000Z",
};

const passedSummary = {
  status: "completed",
  outcome: "passed",
  summary: "Looks perfect.",
  findings: ["Optional naming note"],
  reviewer: "QA Reviewer",
  finishedAt: "2024-01-01T00:00:00.000Z",
};

function getTrigger(): HTMLElement {
  return screen.getByLabelText("QA review details");
}

async function expectOverlayOpen(): Promise<HTMLElement> {
  return waitFor(() => screen.getByRole("tooltip"));
}

describe("SprintReviewBadge", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders requested changes as a visible blue QA edit badge in regular mode", () => {
    render(<SprintReviewBadge summary={requestedChangesSummary} />);

    const trigger = getTrigger();
    expect(trigger.textContent).toContain("QA Changes Requested");
    expect(trigger.className).toContain("border-blue-500/30");
    expect(trigger.querySelector("svg")?.getAttribute("class")).toContain("lucide-pencil-line");
    expect(document.getElementById(trigger.getAttribute("aria-describedby") ?? "")?.textContent).toContain("QA changes requested.");
  });

  it("always keeps visible QA text on the compact requested-change badge", () => {
    render(<SprintReviewBadge summary={requestedChangesSummary} compact />);

    expect(getTrigger().textContent).toContain("QA");
  });

  it.each(["hover", "focus"] as const)(
    "opens requested-change details on %s and exposes the summary and every finding",
    async (interaction) => {
      render(<SprintReviewBadge summary={requestedChangesSummary} />);
      const trigger = getTrigger();

      if (interaction === "hover") {
        fireEvent.mouseEnter(trigger.parentElement as HTMLElement);
      } else {
        fireEvent.focus(trigger);
      }

      await expectOverlayOpen();
      expect(screen.getAllByText("QA Changes Requested").length).toBeGreaterThan(1);
      expect(screen.getByText("Requested-change summary")).toBeTruthy();
      expect(screen.getByText(requestedChangesSummary.summary)).toBeTruthy();
      expect(screen.getByText("2 Requested Changes")).toBeTruthy();
      for (const finding of requestedChangesSummary.findings) {
        expect(screen.getByText(finding)).toBeTruthy();
      }
      expect(screen.getByText("Reviewed by QA Reviewer")).toBeTruthy();
      expect(screen.getByText(/Review finished Jan 1/)).toBeTruthy();
    },
  );

  it("retains partial requested-change content and standalone completion metadata", async () => {
    render(
      <SprintReviewBadge
        summary={{
          ...requestedChangesSummary,
          status: "changes-requested",
          outcome: null,
          reviewer: null,
          summary: "Summary returned without reviewer metadata.",
          findings: ["Only finding returned"],
        }}
      />,
    );

    fireEvent.focus(getTrigger());
    await expectOverlayOpen();
    expect(screen.getByText("Summary returned without reviewer metadata.")).toBeTruthy();
    expect(screen.getByText("Only finding returned")).toBeTruthy();
    expect(screen.getByText(/Review finished Jan 1/)).toBeTruthy();
  });

  it("delays closing and cancels the close while the pointer crosses into the portal", async () => {
    vi.useFakeTimers();
    render(<SprintReviewBadge summary={requestedChangesSummary} />);
    const wrapper = getTrigger().parentElement as HTMLElement;

    fireEvent.mouseEnter(wrapper);
    const overlay = screen.getByRole("tooltip");
    fireEvent.mouseLeave(wrapper);
    act(() => vi.advanceTimersByTime(119));
    expect(screen.getByRole("tooltip")).toBeTruthy();

    fireEvent.mouseEnter(overlay);
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("tooltip")).toBeTruthy();

    fireEvent.mouseLeave(overlay);
    act(() => vi.advanceTimersByTime(120));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("clamps the overlay to the viewport beside an edge trigger", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 240 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 180 });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getRect() {
      const element = this as HTMLElement;
      if (element.getAttribute("aria-label") === "QA review details") {
        return {
          x: 220, y: 165, top: 165, left: 220, right: 236, bottom: 181, width: 16, height: 16,
          toJSON: () => ({}),
        } as DOMRect;
      }
      if (element.getAttribute("role") === "tooltip") {
        return {
          x: 0, y: 0, top: 0, left: 0, right: 320, bottom: 200, width: 320, height: 200,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return {
        x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });

    render(<SprintReviewBadge summary={requestedChangesSummary} align="left" />);
    fireEvent.focus(getTrigger());
    const overlay = await expectOverlayOpen();

    await waitFor(() => {
      expect(overlay.style.left).toBe("12px");
      expect(overlay.style.top).toBe("12px");
    });
    expect(overlay.firstElementChild?.className).toContain("calc(100vw-1.5rem)");
  });

  it("uses mobile-safe width and disables decorative transitions for reduced motion", async () => {
    render(<SprintReviewBadge summary={requestedChangesSummary} compact />);
    const trigger = getTrigger();
    expect(trigger.className).toContain("motion-reduce:transition-none");

    fireEvent.focus(trigger);
    const overlay = await expectOverlayOpen();
    expect(overlay.className).toContain("motion-reduce:transition-none");
    expect(overlay.firstElementChild?.className).toContain("w-[min(41rem,calc(100vw-1.5rem))]");
  });

  it("preserves the running review presentation with static reduced-motion copy", () => {
    render(
      <SprintReviewBadge
        summary={{
          status: "IN_PROGRESS",
          outcome: null,
          summary: null,
          findings: [],
          reviewer: null,
          finishedAt: null,
        }}
      />,
    );

    const status = screen.getByLabelText("QA review running");
    expect(status.textContent).toContain("Reviewing...");
    expect(status.parentElement?.className).toContain("motion-safe:animate-pulse");
    expect(status.querySelector("svg")?.getAttribute("class")).toContain("motion-reduce:animate-none");
  });

  it("preserves the successful green reviewed presentation and accurate details", async () => {
    render(<SprintReviewBadge summary={passedSummary} />);
    const trigger = getTrigger();

    expect(trigger.textContent).toContain("QA Reviewed");
    expect(trigger.className).toContain("border-signal-500/30");
    expect(trigger.querySelector("svg")?.getAttribute("class")).toContain("lucide-circle-check");
    const descriptionId = trigger.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(descriptionId)?.textContent).toContain("QA review complete.");

    fireEvent.focus(trigger);
    await expectOverlayOpen();
    expect(screen.getByText("QA Review Complete")).toBeTruthy();
    expect(screen.getByText("1 Findings")).toBeTruthy();
    expect(screen.getByText("Optional naming note")).toBeTruthy();
  });
});
