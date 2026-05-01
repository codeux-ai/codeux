/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { TaskExecutionMeta } from "../TaskExecutionMeta.js";

expect.extend(matchers);

describe("TaskExecutionMeta", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders all fields populated correctly", () => {
    const { getByText, container } = render(
      <TaskExecutionMeta
        time="2m 30s"
        executorType="jules"
        executionMode="custom"
      />
    );

    expect(getByText("2m 30s")).toBeTruthy();
    expect(getByText("Jules")).toBeTruthy();
    expect(getByText("custom")).toBeTruthy();

    // Check that we have 3 chips
    const chips = container.querySelectorAll(".flex.items-center.gap-1\\.5");
    expect(chips.length).toBe(3);
  });

  it("renders gracefully with missing time", () => {
    const { getByText } = render(
      <TaskExecutionMeta
        executorType="docker_cli"
        executionMode="standard"
      />
    );

    expect(getByText("Not started")).toBeTruthy();
    expect(getByText("CLI")).toBeTruthy();
    expect(getByText("standard")).toBeTruthy();
  });

  it("renders gracefully with fully missing metadata", () => {
    const { getByText } = render(<TaskExecutionMeta />);

    expect(getByText("Not started")).toBeTruthy();
    expect(getByText("Auto")).toBeTruthy();
    expect(getByText("Standard")).toBeTruthy();
  });

  it("applies custom className", () => {
    const { container } = render(<TaskExecutionMeta className="my-custom-class" />);

    // The first div is the wrapper
    expect((container.firstChild as HTMLElement)?.className).toContain("my-custom-class");
    expect((container.firstChild as HTMLElement)?.className).toContain("flex flex-wrap items-center");
  });
});
