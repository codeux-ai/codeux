/** @jsx h */
/**
 * @vitest-environment jsdom
 */
import { h } from "preact";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { SprintLedgerRow } from "../../../../../dashboard/src/v2/components/sprints/SprintLedgerRow.js";
import type { SprintLedgerRowProps } from "../../../../../dashboard/src/v2/components/sprints/SprintLedgerRow.js";
import type { Sprint } from "../../../../../dashboard/src/types.js";

expect.extend(matchers);

vi.mock("../../../../../dashboard/src/v2/hooks/use-project-effective-settings.js", () => ({
  useProjectEffectiveSettings: () => ({
    data: {
      settings: {
        git: {
          sprintKeyPrefix: "SPR",
        },
      },
    },
  }),
}));

const sprint: Sprint = {
  id: "sprint-1",
  projectId: "proj-1",
  number: 1,
  slug: "alpha",
  name: "Alpha Design",
  originalPrompt: null,
  goal: "Redesign dashboard",
  status: "running",
  showcasePinned: false,
  startDate: null,
  endDate: null,
  featureBranch: null,
  tasksCount: 5,
  completion: 50,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  date: "Jan 1",
  latestReview: null,
  linkedIssues: [],
};

describe("SprintLedgerRow", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const renderRow = (overrides: Partial<SprintLedgerRowProps> = {}) => render(
    <table>
      <tbody>
        <SprintLedgerRow
          sprint={sprint}
          isSelected={false}
          isEven={true}
          activeRun={undefined}
          pauseResumeRun={undefined}
          humanIntervention={null}
          pendingActionIds={new Set()}
          onToggleRow={vi.fn()}
          onToggleShowcase={vi.fn()}
          onSprintToggle={vi.fn()}
          onSprintPauseResume={vi.fn()}
          onEdit={vi.fn()}
          onExport={vi.fn()}
          onOverrides={vi.fn()}
          onMarkCompleted={vi.fn()}
          onDelete={vi.fn()}
          {...overrides}
        />
      </tbody>
    </table>,
  );

  it("reveals quick actions on hover and keyboard focus", async () => {
    const { container } = renderRow();

    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();

    const row = container.querySelector("tr") as HTMLTableRowElement;
    fireEvent.mouseEnter(row);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Open" })).toBeInTheDocument();
    });

    fireEvent.mouseLeave(row);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    });

    fireEvent.focus(screen.getByRole("button", { name: "Pause" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    });
  });

  it("adds a pulsing glow to pending row actions", async () => {
    const { container } = renderRow({
      pendingActionIds: new Set(["sprint-showcase:sprint-1"]),
    });

    const row = container.querySelector("tr") as HTMLTableRowElement;
    fireEvent.mouseEnter(row);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add Showcase" })).toBeDisabled();
    });

    const busyPanel = container.querySelector("[aria-busy='true']");
    expect(busyPanel).not.toBeNull();
    expect(busyPanel?.className).toContain("animate-pulse");
  });
});
