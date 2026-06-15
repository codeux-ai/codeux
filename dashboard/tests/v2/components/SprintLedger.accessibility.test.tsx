import { SprintLedgerBulkActions } from "../../../src/v2/components/sprints/SprintLedgerBulkActions.js";
/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { SprintLedger } from "../../../src/v2/components/sprints/SprintLedger.js";
import { SprintLedgerRow } from "../../../src/v2/components/sprints/SprintLedgerRow.js";
import type { Sprint } from "../../../src/v2/types.js";

vi.mock("gsap", () => ({
  default: {
    to: vi.fn(),
    fromTo: vi.fn(),
    context: (cb: any) => {
      cb();
      return { revert: vi.fn() };
    },
  },
}));

const mockSprint: Sprint = {
  id: "sprint-1",
  projectId: "proj-1",
  name: "Frontend Polish",
  goal: "Make it accessible",
  status: "running",
  completion: 50,
  tasksCount: 10,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  showcasePinned: false,
  slug: "frontend-polish",
};

test("renders accessible column headers and allows sorting", async () => {
  render(
    <SprintLedger
      sprints={[mockSprint]}
      listWindow="all"
      onListWindowChange={vi.fn()}
      activeRunsBySprintId={new Map()}
      pauseResumeRunsBySprintId={new Map()}
      interventionBySprintId={new Map()}
      pendingActionIds={new Set()}
      onToggleShowcase={vi.fn()}
      onSprintToggle={vi.fn()}
      onSprintPauseResume={vi.fn()}
      onBulkStart={vi.fn()}
      onBulkDelete={vi.fn()}
      onEditSprint={vi.fn()}
      onExportSprint={vi.fn()}
      onOverridesSprint={vi.fn()}
      onMarkCompletedSprint={vi.fn()}
      onDeleteSprint={vi.fn()}
      onBulkShowcaseEnable={vi.fn()}
      onBulkShowcaseDisable={vi.fn()}
    />
  );

  const headers = screen.getAllByRole("columnheader");
  expect(headers.length).toBeGreaterThan(0);

  const nameHeader = screen.getByRole("columnheader", { name: /^Sprint$/i });
  expect(nameHeader).toHaveAttribute("aria-sort", "none");

  const nameSortButton = screen.getByRole("button", { name: /^Sprint$/i });
  await userEvent.click(nameSortButton);

  expect(screen.getByRole("columnheader", { name: /^Sprint$/i })).toHaveAttribute(
    "aria-sort",
    "ascending"
  );
});

test("renders accessible buttons for row actions", () => {
  render(
    <table>
      <tbody>
        <SprintLedgerRow
          sprint={mockSprint}
          isSelected={false}
          isEven={true}
          activeRun={undefined}
          pauseResumeRun={undefined}
          humanIntervention={null}
          pendingActionIds={new Set()}
          isAnyBulkPending={false}
          onToggleRow={vi.fn()}
          onToggleShowcase={vi.fn()}
          onSprintToggle={vi.fn()}
          onSprintPauseResume={vi.fn()}
          onOpenRowMenu={vi.fn()}
          onEdit={vi.fn()}
          onExport={vi.fn()}
          onOverrides={vi.fn()}
          onMarkCompleted={vi.fn()}
          onDelete={vi.fn()}
        />
      </tbody>
    </table>
  );

  expect(
    screen.getByRole("button", { name: `Select sprint Frontend Polish` })
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: `Pin Frontend Polish to showcase` })
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: `Open sprint Frontend Polish` })
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: `Open sprint actions for Frontend Polish` })
  ).toBeInTheDocument();
});

test("hides redundant mobile field labels from screen readers", () => {
  render(
    <table>
      <tbody>
        <SprintLedgerRow
          sprint={mockSprint}
          isSelected={false}
          isEven={true}
          activeRun={undefined}
          pauseResumeRun={undefined}
          humanIntervention={null}
          pendingActionIds={new Set()}
          isAnyBulkPending={false}
          onToggleRow={vi.fn()}
          onToggleShowcase={vi.fn()}
          onSprintToggle={vi.fn()}
          onSprintPauseResume={vi.fn()}
          onEdit={vi.fn()}
          onExport={vi.fn()}
          onOverrides={vi.fn()}
          onMarkCompleted={vi.fn()}
          onDelete={vi.fn()}
        />
      </tbody>
    </table>
  );

  const mobileLabels = screen.getAllByText(/Sprint ID|Status|Tasks|Completion/i);
  mobileLabels.forEach((label) => {
    if (label.classList.contains("lg:hidden")) {
      expect(label).toHaveAttribute("aria-hidden", "true");
    }
  });
});

test("announces selection count via polite live region", async () => {

  render(<SprintLedgerBulkActions selectedCount={1} totalCount={3} onBulkStart={vi.fn()} onBulkDelete={vi.fn()} onBulkShowcaseEnable={vi.fn()} onBulkShowcaseDisable={vi.fn()} onClearSelection={vi.fn()} />);
  const liveRegion = screen.getByText(/1 of 3 selected/i);
  expect(liveRegion).toHaveAttribute("aria-live", "polite");
  expect(liveRegion).toHaveAttribute("aria-atomic", "true");
});
