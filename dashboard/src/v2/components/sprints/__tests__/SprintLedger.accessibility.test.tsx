// @vitest-environment jsdom
import { render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";

import { SprintLedger } from "../SprintLedger.js";
import { SprintLedgerRow } from "../SprintLedgerRow.js";
import type { Sprint } from "../../../types.js";

expect.extend(matchers);

const mockSprint: Sprint = {
  date: "2023-01-01T00:00:00.000Z",
  projectId: "p-1",
  originalPrompt: "test",
  startDate: null,
  endDate: null,
  featureBranch: null,
  baseCommitSha: null,
    latestReview: undefined,
  id: "sprint-1",
  number: 1,
  slug: "spr-1",
  name: "Frontend Onboarding",
  status: "running",
  goal: "Onboard new developers",
  tasksCount: 10,
  completion: 50,
  createdAt: "2023-01-01T00:00:00.000Z",
  updatedAt: "2023-01-02T00:00:00.000Z",
  showcasePinned: false,
  linkedIssues: [],
};

describe("SprintLedger Accessibility", () => {
  it("renders an accessible table name/caption", () => {
    const { getByRole } = render(
      <SprintLedger
        sprints={[mockSprint]}
        listWindow={10}
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

    const table = getByRole("table");
    expect(table).toBeInTheDocument();

    const caption = screen.getByText(/Sprint ledger with selection/);
    expect(caption).toBeInTheDocument();
  });

  it("supports action menu keyboard open/close", async () => {
    const user = userEvent.setup();
    render(
      <table>
        <tbody>
          <SprintLedgerRow
            sprint={mockSprint}
            isSelected={false}
            isEven={false} activeRun={undefined} pauseResumeRun={undefined} humanIntervention={null} isAnyBulkPending={false}
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
          />
        </tbody>
      </table>
    );

    const menuBtn = screen.getAllByRole("button", { name: /Open actions menu for sprint Frontend Onboarding/i })[0];
    expect(menuBtn).toBeInTheDocument();
    expect(menuBtn).toHaveAttribute("aria-expanded", "false");

    await user.click(menuBtn);
    expect(menuBtn).toHaveAttribute("aria-expanded", "true");

    const editBtn = screen.getByRole("menuitem", { name: /Edit sprint Frontend Onboarding/i });
    expect(editBtn).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(menuBtn).toHaveAttribute("aria-expanded", "false");
  });

  it("announces sorting state via aria-sort and sort buttons", () => {
    render(
      <SprintLedger
        sprints={[mockSprint]}
        listWindow={10}
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

    const createdBtns = screen.getAllByRole("button", { name: /Sort by Created, currently sorted/i });
    const createdBtn = createdBtns[0];
    expect(createdBtn).toBeInTheDocument();

    const cell = createdBtn.closest("th");
    expect(cell).toHaveAttribute("aria-sort", "descending");
  });

  it("provides explicit names for row controls including the sprint name", () => {
    const { getByRole, getAllByRole } = render(
      <table>
        <tbody>
          <SprintLedgerRow
            sprint={mockSprint}
            isSelected={false}
            isEven={false} activeRun={undefined} pauseResumeRun={undefined} humanIntervention={null} isAnyBulkPending={false}
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
          />
        </tbody>
      </table>
    );

    expect(getAllByRole("button", { name: /Select sprint Frontend Onboarding/i })[0]).toBeInTheDocument();
    expect(getAllByRole("button", { name: /Pin sprint Frontend Onboarding to showcase/i })[0]).toBeInTheDocument();
    expect(getAllByRole("link", { name: /Open sprint Frontend Onboarding/i })[0]).toBeInTheDocument();
    expect(getAllByRole("button", { name: /Open actions menu for sprint Frontend Onboarding/i })[0]).toBeInTheDocument();
    expect(getAllByRole("button", { name: /Start Frontend Onboarding/i })[0]).toBeInTheDocument();
  });

  it("announces bulk selection count in a live region", () => {
    render(
      <SprintLedger
        sprints={[mockSprint]}
        listWindow={10}
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

    const liveRegion = screen.getAllByText(/0 of 1 selected/i)[0].closest("div[aria-live]");
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
  });

  it("has mobile labels mapped correctly via TableCell mobileLabel", () => {
    render(
      <table>
        <tbody>
          <SprintLedgerRow
            sprint={mockSprint}
            isSelected={false}
            isEven={false} activeRun={undefined} pauseResumeRun={undefined} humanIntervention={null} isAnyBulkPending={false}
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
          />
        </tbody>
      </table>
    );

    // mobileLabels are rendered as spans with uppercase tracking class and lg:hidden
    // the previous test should just check for text, wait, mobileLabel is mapped in TableCell
    const idLabels = screen.getAllByText("Sprint ID");
    const idLabel = idLabels.find(el => el.classList.contains('lg:hidden'));
    expect(idLabel).toBeInTheDocument();
    expect(idLabel).toHaveClass("lg:hidden");
  });
});
