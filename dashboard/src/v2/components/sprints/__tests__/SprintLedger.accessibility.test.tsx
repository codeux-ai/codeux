// @vitest-environment jsdom
import { render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";

import { SprintLedger } from "../SprintLedger.js";
import { SprintLedgerRow } from "../SprintLedgerRow.js";
import { SprintLedgerHeader } from "../SprintLedgerHeader.js";
import { SprintLedgerBulkActions } from "../SprintLedgerBulkActions.js";
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

    const activeCell = createdBtn.closest("th");
    expect(activeCell).toHaveAttribute("aria-sort", "descending");

    const nameBtns = screen.getAllByRole("button", { name: /Sort by Sprint, currently sorted/i });
    const inactiveCell = nameBtns[0].closest("th");
    expect(inactiveCell).not.toHaveAttribute("aria-sort");
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

  it("clears filters when the clear button is clicked", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    render(
      <SprintLedgerHeader
        sprintsCount={10}
        ledgerSprintsCount={5}
        pinnedCount={0}
        activeCount={0}
        completedCount={0}
        listWindow={10}
        onListWindowChange={vi.fn()}
        filters={{ query: "test", status: "all", showcase: "all", qa: "all" }}
        onFiltersChange={onFiltersChange}
      />
    );
    const clearBtn = screen.getByRole("button", { name: /Clear all applied filters/i });
    await user.click(clearBtn);
    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ query: "", status: "all", showcase: "all", qa: "all" }));
  });

  it("disables unrelated controls properly based on pending states", () => {
    const { getAllByRole } = render(
      <table>
        <tbody>
          <SprintLedgerRow
            sprint={mockSprint}
            isSelected={false}
            isEven={false} activeRun={undefined} pauseResumeRun={undefined} humanIntervention={null} isAnyBulkPending={false}
            pendingActionIds={new Set(["delete-mock"])}
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
    const startBtn = getAllByRole("button", { name: /Start Frontend Onboarding/i })[0];
    expect(startBtn).not.toBeDisabled();
  });

  it("requests confirmation before bulk delete", async () => {
    const user = userEvent.setup();
    const onBulkDelete = vi.fn();
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
        onBulkDelete={onBulkDelete}
        onEditSprint={vi.fn()}
        onExportSprint={vi.fn()}
        onOverridesSprint={vi.fn()}
        onMarkCompletedSprint={vi.fn()}
        onDeleteSprint={vi.fn()}
        onBulkShowcaseEnable={vi.fn()}
        onBulkShowcaseDisable={vi.fn()}
      />
    );

    // Select the row
    const checkbox = screen.getAllByRole("button", { name: /Select sprint Frontend Onboarding/i })[0];
    await user.click(checkbox);

    await vi.waitFor(() => expect(screen.getByText(/1 of 1 selected/i)).toBeInTheDocument());

    // Click bulk delete
    const bulkDeleteBtns = screen.getAllByRole("button", { name: /^Delete$/i });
    const bulkDeleteBtn = bulkDeleteBtns[0];
    await user.click(bulkDeleteBtn);

    // Check for confirmation dialog
    expect(await screen.findByText(/Delete Sprints\?/i)).toBeInTheDocument();
    expect(screen.getByText(/This action is permanent and will cascade/i)).toBeInTheDocument();
  });

  it("reveals and collapses bulk actions based on selection count", () => {
    const { rerender } = render(
      <SprintLedgerBulkActions
        selectedCount={0}
        totalCount={10}
        onBulkStart={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkShowcaseEnable={vi.fn()}
        onBulkShowcaseDisable={vi.fn()}
        onClearSelection={vi.fn()}
      />
    );
    expect(screen.getByText(/0 of 10 selected/i)).toBeInTheDocument();

    rerender(
      <SprintLedgerBulkActions
        selectedCount={2}
        totalCount={10}
        onBulkStart={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkShowcaseEnable={vi.fn()}
        onBulkShowcaseDisable={vi.fn()}
        onClearSelection={vi.fn()}
      />
    );
    expect(screen.getByText(/2 of 10 selected/i)).toBeInTheDocument();
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


  it("announces filter results politely", () => {
    const { getByText } = render(
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
    // 0 of 1 selected is already checked, but we added a "Showing 1 of 1 sprints" span
    // Let's test the span with aria-live exists
    const liveRegion = document.querySelector('span[aria-live="polite"][aria-atomic="true"]');
    expect(liveRegion).toBeInTheDocument();
  });
