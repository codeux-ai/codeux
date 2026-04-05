/** @jsx h */
/** @vitest-environment jsdom */
import { h } from "preact";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/preact";
import { SprintBubble } from "../../../dashboard/src/v2/components/ui/SprintBubble";

afterEach(() => { cleanup(); });

describe("SprintBubble DOM structure for Verification", () => {
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

  it("prints container classes", () => {
    const { container } = render(<SprintBubble sprint={defaultSprint} isEven={true} accentColor="text-blue-500" />);
    const mainDiv = container.firstChild as HTMLDivElement;
    console.log(mainDiv.className);
    expect(mainDiv.className).not.toContain("hover:shadow-[0_4px_24px_rgba(0,0,0,0.08)]");
  });
});
