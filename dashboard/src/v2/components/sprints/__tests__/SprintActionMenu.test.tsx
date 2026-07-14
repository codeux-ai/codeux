// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Sprint } from "../../../types.js";
import { SprintActionMenu } from "../SprintActionMenu.js";

expect.extend(matchers);

afterEach(() => {
  cleanup();
});

const sprint: Sprint = {
  id: "sprint-1",
  projectId: "project-1",
  number: 1,
  slug: "sprint-one",
  name: "Sprint One",
  isGeneratedName: false,
  goal: "Test safe branch refresh",
  originalPrompt: null,
  status: "idle",
  kind: "standard",
  featureBranch: "feature/sprint-one",
  baseCommitSha: null,
  startDate: null,
  endDate: null,
  date: "2026-07-14T00:00:00.000Z",
  tasksCount: 0,
  completion: 0,
  createdAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z",
  showcasePinned: false,
  rollbackSourceSprintId: null,
  rollbackMode: null,
  rollbackInstructions: null,
  rollbackSafetyReason: null,
  linkedIssues: [],
};

describe("SprintActionMenu branch refresh", () => {
  it("invokes Update Branch and exposes its busy state accessibly", async () => {
    const user = userEvent.setup();
    const onUpdateBranch = vi.fn();
    const view = render(
      <SprintActionMenu
        sprint={sprint}
        role="menuitem"
        onUpdateBranch={onUpdateBranch}
      />,
    );

    const updateButton = screen.getByRole("menuitem", { name: "Update branch for sprint Sprint One" });
    expect(updateButton).toHaveTextContent("Update Branch");
    await user.click(updateButton);
    expect(onUpdateBranch).toHaveBeenCalledOnce();

    view.rerender(
      <SprintActionMenu
        sprint={sprint}
        role="menuitem"
        onUpdateBranch={onUpdateBranch}
        updateBranchBusy
      />,
    );

    const busyButton = screen.getByRole("menuitem", { name: "Update branch for sprint Sprint One" });
    expect(busyButton).toBeDisabled();
    expect(busyButton).toHaveAttribute("aria-busy", "true");
    expect(busyButton).toHaveTextContent("Updating Branch");
  });
});
