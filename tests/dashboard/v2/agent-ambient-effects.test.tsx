/** @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";

import { AgentAmbientEffects } from "../../../dashboard/src/v2/components/chat/cinematic/AgentAmbientEffects.js";
import type { AgentAmbientCue } from "../../../dashboard/src/v2/components/chat/cinematic/use-agent-mood.js";

const singingCue: AgentAmbientCue = {
  kind: "sing",
  expression: "happy",
  animation: "nod",
  label: "Humming while I wait.",
  showNotes: true,
};

describe("AgentAmbientEffects", () => {
  afterEach(cleanup);

  it("renders a textual cue with non-semantic decorative notes", () => {
    render(<AgentAmbientEffects cue={singingCue} motionEnabled />);

    expect(screen.getByText("Humming while I wait.")).toBeTruthy();
    const notes = screen.getByTestId("agent-ambient-notes");
    expect(notes.closest('[aria-hidden="true"]')).toBeTruthy();
    expect(screen.getByTestId("agent-ambient-effects").getAttribute("data-cue")).toBe("sing");
  });

  it("does not create a live region or keyboard focus stop", () => {
    const { container } = render(<AgentAmbientEffects cue={singingCue} motionEnabled />);

    expect(container.querySelector('[aria-live], [role="status"]')).toBeNull();
    expect(container.querySelector("button, a, input, [tabindex]")).toBeNull();
  });

  it("omits transient visuals when motion is suppressed or no cue is active", () => {
    const { container, rerender } = render(<AgentAmbientEffects cue={singingCue} motionEnabled={false} />);
    expect(container.firstChild).toBeNull();

    rerender(<AgentAmbientEffects cue={null} motionEnabled />);
    expect(container.firstChild).toBeNull();
  });
});
