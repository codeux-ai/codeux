/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { DependencyStatusIndicators } from "../DependencyStatusIndicators.js";

expect.extend(matchers);

describe("DependencyStatusIndicators", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders correctly with indicators", () => {
    const { getByText, container } = render(
      <DependencyStatusIndicators
        indicators={[
          { recordId: "1", id: "TASK-1", title: "Test task 1", status: "completed" },
          { recordId: "2", id: "TASK-2", title: "Test task 2", status: "pending" }
        ]}
      />
    );

    expect(getByText("TASK-1")).toBeTruthy();
    expect(getByText("TASK-2")).toBeTruthy();
  });

  it("returns null when no indicators provided", () => {
    const { container } = render(<DependencyStatusIndicators indicators={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
