/** @jsx h */
/** @vitest-environment happy-dom */
import { h } from "preact";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/preact";
import { SprintControls } from "../../../dashboard/src/v2/components/sprints/SprintControls.js";

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

    expect(screen.getByRole("button", { name: "Pausing..." }).getAttribute("disabled")).not.toBeNull();
  });
});
