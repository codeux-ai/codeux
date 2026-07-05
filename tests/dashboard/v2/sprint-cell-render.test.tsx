/** @jsx h */
/** @vitest-environment happy-dom */
import { h } from "preact";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/preact";
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

  it("keeps hover shadows on the animated organic underlay instead of the square wrapper", () => {
    const { container } = render(<SprintCell sprint={defaultSprint} isEven={true} accentColor="text-blue-500" />);
    const wrapper = container.firstChild as HTMLDivElement;
    const shadowUnderlay = wrapper.firstElementChild as HTMLDivElement;

    expect(wrapper.className).not.toContain("hover:shadow-");
    expect(wrapper.className).not.toContain("group-hover:shadow-");
    expect(shadowUnderlay.className).toContain("animate-organic");
    expect(shadowUnderlay.className).toContain("group-hover:shadow-");
  });
});
