/** @jsx h */
/** @vitest-environment happy-dom */
import { h } from "preact";
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/preact";
import { within } from "@testing-library/preact";
import { SprintControls } from "../../../dashboard/src/v2/components/sprints/SprintControls.js";
import { SprintActionMenu } from "../../../dashboard/src/v2/components/sprints/SprintActionMenu.js";

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
    killTweensOf: vi.fn(),
    context: vi.fn(() => ({ add: (callback: () => void) => callback(), revert: vi.fn() })),
  };
  return { default: gsap, gsap };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("SprintControls pause and resume actions", () => {
  it("fires pause action for active runs", () => {
    const onPauseResume = vi.fn();
    render(
      <SprintControls
        isActive={true}
        isPaused={false}
        isStartStopPending={false}
        isPauseResumePending={false}
        onStartStop={vi.fn()}
        onPauseResume={onPauseResume}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Pause sprint" }));
    expect(onPauseResume).toHaveBeenCalledTimes(1);
  });

  it("fires resume action for paused runs", () => {
    const onPauseResume = vi.fn();
    render(
      <SprintControls
        isActive={false}
        isPaused={true}
        isStartStopPending={false}
        isPauseResumePending={false}
        onStartStop={vi.fn()}
        onPauseResume={onPauseResume}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Resume sprint" }));
    expect(onPauseResume).toHaveBeenCalledTimes(1);
  });

  it("disables pause-resume while pending", () => {
    render(
      <SprintControls
        isActive={true}
        isPaused={false}
        isStartStopPending={false}
        isPauseResumePending={true}
        onStartStop={vi.fn()}
        onPauseResume={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Pause sprint is pending" }).getAttribute("disabled")).not.toBeNull();
  });

  it("keeps inactive pause guidance out of the visible control row", () => {
    render(
      <SprintControls
        isActive={false}
        isPaused={false}
        isStartStopPending={false}
        isPauseResumePending={false}
        onStartStop={vi.fn()}
        onPauseResume={vi.fn()}
      />
    );

    const pauseButton = screen.getByRole("button", { name: "Pause sprint" });
    expect(pauseButton.getAttribute("disabled")).not.toBeNull();
    expect(pauseButton.classList.contains("no-underline")).toBe(true);
    const reasonId = pauseButton.getAttribute("aria-describedby");
    expect(reasonId).toBeTruthy();
    const reason = document.getElementById(reasonId ?? "");
    expect(reason?.textContent).toBe("Pause is available after the sprint starts.");
    expect(reason?.classList.contains("sr-only")).toBe(true);
  });
});

describe("SprintActionMenu confirmation gates", () => {
  const sprint = {
    id: "sprint-1",
    projectId: "project-1",
    name: "Sprint Alpha",
    status: "running",
    taskCount: 2,
    completedTaskCount: 0,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };

  it("requires dialog confirmation before pausing a running sprint from the menu", async () => {
    const onPauseResume = vi.fn();

    render(
      <SprintActionMenu
        sprint={sprint as any}
        isRunning={true}
        onPauseResume={onPauseResume}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(onPauseResume).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Pause Sprint" }).textContent).toContain("Sprint Alpha");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Pause Sprint" })).toBeNull());
    expect(onPauseResume).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Pause Sprint" })).getByRole("button", { name: "Pause" }));

    await waitFor(() => {
      expect(onPauseResume).toHaveBeenCalledTimes(1);
    });
  });

  it("removes link underlines from menu actions rendered as buttons", () => {
    render(
      <SprintActionMenu
        sprint={sprint as any}
        isRunning={true}
        viewTasksHref="/tasks?sprintId=sprint-1"
      />,
    );

    expect(screen.getByRole("link", { name: "View tasks for sprint Sprint Alpha" }).classList.contains("no-underline")).toBe(true);
  });

  it("does not stop a sprint on cancel and forwards delete to the page-level confirmation flow", async () => {
    const onPrimaryAction = vi.fn();
    const onDelete = vi.fn();

    render(
      <SprintActionMenu
        sprint={sprint as any}
        isRunning={true}
        onPrimaryAction={onPrimaryAction}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Stop Sprint" }));
    expect(onPrimaryAction).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Stop Sprint" }).textContent).toContain("Active task dispatches");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Stop Sprint" })).toBeNull());
    expect(onPrimaryAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete sprint Sprint Alpha" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onPrimaryAction).not.toHaveBeenCalled();
  });
});
