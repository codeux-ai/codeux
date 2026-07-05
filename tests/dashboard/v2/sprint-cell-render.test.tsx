/** @jsx h */
/** @vitest-environment happy-dom */
import { h } from "preact";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/preact";
import { SprintCell } from "../../../dashboard/src/v2/components/sprints/SprintCell";

afterEach(() => { cleanup(); });

describe("SprintCell DOM structure for Verification", () => {
  const defaultSprint = {
    id: "sprint-1",
    projectId: "proj-1",
    name: "Feature Alpha",
    goal: "Build Alpha",
    slug: "alpha",
    status: "idle" as const,
    tasksCount: 5,
    completion: 0,
    showcasePinned: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };

  it("uses a shape-following organic shadow instead of a wrapper box shadow", () => {
    const { container } = render(<SprintCell sprint={defaultSprint} isEven={true} accentColor="text-blue-500" />);
    const mainDiv = container.firstChild as HTMLDivElement;
    const shadowShell = Array.from(container.querySelectorAll("div")).find((node) =>
      node.className.toString().includes("drop-shadow-[0_24px_48px_rgba(0,0,0,0.07)]")
    );

    expect(mainDiv.className).not.toContain("hover:shadow-");
    expect(shadowShell).toBeTruthy();
    expect(shadowShell?.className.toString()).toContain("animate-organic");
  });
});
