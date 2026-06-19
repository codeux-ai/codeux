/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { RuntimeEventFeed } from "../../../src/v2/components/RuntimeEventFeed.js";
import { ExecutionTimeline } from "../../../src/v2/components/ExecutionTimeline.js";

expect.extend(matchers);

describe("Live Session Feedback", () => {
  afterEach(() => cleanup());

  it("renders empty state correctly for RuntimeEventFeed", () => {
    render(<RuntimeEventFeed events={[]} />);
    expect(screen.getByText("No runtime events yet")).toBeInTheDocument();
    expect(screen.getByText("Listening for execution activity...")).toBeInTheDocument();
  });

  it("renders events correctly for RuntimeEventFeed", () => {
    const events = [
      {
        id: "event-1",
        eventType: "TASK_STARTED",
        createdAt: new Date().toISOString(),
        originator: "system",
      }
    ];
    render(<RuntimeEventFeed events={events as any} />);
    expect(screen.getAllByText("TASK STARTED")[0]).toBeInTheDocument();
    expect(screen.queryByText("No runtime events yet")).not.toBeInTheDocument();
  });
});
