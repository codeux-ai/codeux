// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, it, expect, vi } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";

import { SprintLedger } from "../SprintLedger.js";
import { SprintLedgerRow } from "../SprintLedgerRow.js";
import { SprintLedgerHeader } from "../SprintLedgerHeader.js";
import { SprintLedgerBulkActions } from "../SprintLedgerBulkActions.js";
import type { Sprint } from "../../../types.js";
import type { CiStatusPresentation } from "../../../lib/ci-status-presentation.js";
import { renderWithI18n } from "../../../../../../tests/dashboard/render-with-i18n.js";

expect.extend(matchers);

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, search, to, ...props }: any) => (
    <a href={`${to}?${new URLSearchParams(search).toString()}`} {...props}>{children}</a>
  ),
}));

afterEach(() => {
  cleanup();
});

const mockSprint: Sprint = {
  date: "2023-01-01T00:00:00.000Z",
  projectId: "p-1",
  originalPrompt: "test",
  startDate: null,
  endDate: null,
  featureBranch: null,
  baseCommitSha: null,
  kind: "standard",
  rollbackSourceSprintId: null,
  rollbackMode: null,
  rollbackInstructions: null,
  rollbackSafetyReason: null,
  latestReview: undefined,
  id: "sprint-1",
  number: 1,
  slug: "spr-1",
  name: "Frontend Onboarding",
  isGeneratedName: false,
  status: "running",
  goal: "Onboard new developers",
  tasksCount: 10,
  completion: 50,
  createdAt: "2023-01-01T00:00:00.000Z",
  updatedAt: "2023-01-02T00:00:00.000Z",
  showcasePinned: false,
  linkedIssues: [],
};

const failedCiStatus: CiStatusPresentation = {
  scope: "sprint",
  state: "failed",
  label: "CI failed",
  accessibleLabel: "CI failed. Pull request: Pull request ready. Checks: Checks failed. Merge: Blocked by checks.",
  failureKind: "ci_checks",
  steps: [
    { id: "pull_request", label: "Pull request", state: "successful", statusLabel: "Pull request ready" },
    { id: "checks", label: "Checks", state: "failed", statusLabel: "Checks failed", failureKind: "ci_checks" },
    { id: "merge", label: "Merge", state: "pending", statusLabel: "Blocked by checks" },
  ],
};

describe("SprintLedger Accessibility", () => {
  it("renders an accessible table name/caption", () => {
    const { getByRole } = renderWithI18n(
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
    renderWithI18n(
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

  it("announces sorting state via aria-sort, sort buttons, and live text", async () => {
    const user = userEvent.setup();
    renderWithI18n(
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

    const createdBtns = screen.getAllByRole("button", { name: /Sort by Created/i });
    const createdBtn = createdBtns[0];
    expect(createdBtn).toBeInTheDocument();

    const activeCell = createdBtn.closest("th");
    expect(activeCell).toHaveAttribute("aria-sort", "descending");
    expect(createdBtn).toHaveAccessibleDescription(/Currently sorted descending\. Activate to sort Created ascending\./i);

    const nameBtns = screen.getAllByRole("button", { name: /Sort by Sprint/i });
    const inactiveCell = nameBtns[0].closest("th");
    expect(inactiveCell).toHaveAttribute("aria-sort", "none");
    expect(nameBtns[0]).toHaveAccessibleDescription(/Not currently sorted\. Activate to sort Sprint ID ascending\./i);

    await user.click(nameBtns[0]);
    expect(inactiveCell).toHaveAttribute("aria-sort", "ascending");
  });

  it("provides explicit names for row controls including the sprint name", () => {
    const { getByRole, getAllByRole } = renderWithI18n(
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
    expect(getAllByRole("link", { name: /Open tasks for sprint Frontend Onboarding/i })[0]).toBeInTheDocument();
    expect(getAllByRole("link", { name: /Open live session for sprint Frontend Onboarding/i })[0]).toBeInTheDocument();
    expect(getAllByRole("button", { name: /Open actions menu for sprint Frontend Onboarding/i })[0]).toBeInTheDocument();
    expect(getAllByRole("button", { name: /Start sprint Frontend Onboarding/i })[0]).toBeInTheDocument();
  });

  it("keeps a compact human-attention row discoverable without removing keyboard controls", async () => {
    const user = userEvent.setup();
    const { container } = renderWithI18n(
      <table>
        <tbody>
          <SprintLedgerRow
            sprint={{ ...mockSprint, status: "paused" }}
            isSelected={false}
            isEven={false}
            activeRun={undefined}
            pauseResumeRun={undefined}
            humanIntervention={{
              title: "Manual approval required",
              reason: "Review the changes",
              instructions: "Approve or request changes",
              attentionType: null,
              severity: "high",
              ownerType: "human",
            }}
            isAnyBulkPending={false}
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
      </table>,
    );

    const indicator = screen.getByRole("status", { name: "Sprint waiting for human intervention" });
    expect(indicator).toHaveAttribute("data-compact", "true");
    expect(indicator).toHaveTextContent("zZZ");
    expect(container.querySelector("tr.sprint-attention-human")).toHaveClass("border-status-red/55");
    expect(container.querySelector("td[class*='lg:border-status-red/45']")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open tasks for sprint Frontend Onboarding" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open live session for sprint Frontend Onboarding" })).toBeInTheDocument();

    await user.tab();
    expect(screen.getByRole("button", { name: "Select sprint Frontend Onboarding" })).toHaveFocus();
  });

  it("keeps QA, CI, lifecycle, and human-attention states independently accessible", async () => {
    const user = userEvent.setup();
    const { container } = renderWithI18n(
      <table>
        <tbody>
          <SprintLedgerRow
            sprint={{
              ...mockSprint,
              status: "paused",
              latestReview: {
                status: "completed",
                outcome: "changes_requested",
                summary: "One requested change remains.",
                findings: [],
                fixInstructions: "Cover the failed-check recovery path.",
                targetTaskKey: "T03",
                reviewer: "QA Worker",
                finishedAt: "2026-07-13T10:00:00.000Z",
              },
            }}
            isSelected={false}
            isEven={false}
            activeRun={undefined}
            pauseResumeRun={undefined}
            humanIntervention={{
              title: "Operator review required",
              reason: "Confirm the CI repair",
              instructions: "Resume after review",
              attentionType: "ci_fix_required",
              severity: "high",
              ownerType: "human",
            }}
            ciStatus={failedCiStatus}
            isAnyBulkPending={false}
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
      </table>,
    );

    expect(screen.getByText("Paused")).toBeVisible();
    expect(screen.getByText("Needs you")).toBeVisible();
    expect(screen.queryByText("CI")).not.toBeInTheDocument();
    const ciTrigger = screen.getByRole("button", { name: /CI status: CI failed.*Show workflow details/i });
    expect(ciTrigger).toHaveAccessibleName(/CI status: CI failed/i);
    expect(container.querySelector('[data-ci-icon="failure"]')).toHaveClass("text-status-red");

    await user.click(ciTrigger);
    const workflow = screen.getByRole("region", { name: "CI workflow details" });
    expect(within(workflow).getByText("Checks failed")).toBeVisible();

    const qaTrigger = screen.getByRole("button", { name: "QA review details" });
    expect(qaTrigger).toHaveAccessibleDescription(/QA changes requested/i);
    await user.click(qaTrigger);
    const review = screen.getByRole("region", { name: "QA Changes Requested" });
    expect(within(review).getByText("Cover the failed-check recovery path.")).toBeVisible();
    expect(within(review).getByText("T03")).toBeVisible();
  });

  it("announces bulk selection count through the ledger live region", async () => {
    const user = userEvent.setup();
    renderWithI18n(
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

    await user.click(screen.getAllByRole("button", { name: /Select sprint Frontend Onboarding/i })[0]);

    const liveRegion = screen.getByText(/Selected sprint Frontend Onboarding\. Showing 1 of 1 sprint\. 1 selected\./i).closest("div[aria-live]");
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
  });

  it("clears filters when the clear button is clicked", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    renderWithI18n(
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
    const { getAllByRole } = renderWithI18n(
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
    const startBtn = getAllByRole("button", { name: /Start sprint Frontend Onboarding/i })[0];
    expect(startBtn).not.toBeDisabled();
  });

  it("requests confirmation before bulk delete", async () => {
    const user = userEvent.setup();
    const onBulkDelete = vi.fn();
    renderWithI18n(
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
    const bulkDeleteBtns = screen.getAllByRole("button", { name: /Delete 1 selected sprint\. Permanent action\./i });
    const bulkDeleteBtn = bulkDeleteBtns[0];
    await user.click(bulkDeleteBtn);

    // Check for confirmation dialog
    expect(await screen.findByText(/Delete 1 Selected Sprint\?/i)).toBeInTheDocument();
    expect(screen.getByText(/You are deleting 1 selected sprint/i)).toBeInTheDocument();
    expect(screen.getByText(/Affected sprints: "Frontend Onboarding"\./i)).toBeInTheDocument();
    expect(screen.getByText(/This action is permanent and will cascade/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(bulkDeleteBtn).toHaveFocus());
    expect(screen.getByText(/Bulk delete canceled\. Selected sprints were not deleted\./i)).toBeInTheDocument();
  });

  it("requests confirmation before a row delete and restores fallback focus on cancel", async () => {
    const user = userEvent.setup();
    const onDeleteSprint = vi.fn();
    renderWithI18n(
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
        onDeleteSprint={onDeleteSprint}
        onBulkShowcaseEnable={vi.fn()}
        onBulkShowcaseDisable={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: /Open actions menu for sprint Frontend Onboarding/i }));
    await user.click(await screen.findByRole("menuitem", { name: /Delete sprint Frontend Onboarding/i }));

    expect(await screen.findByText(/Delete Sprint "Frontend Onboarding"\?/i)).toBeInTheDocument();
    expect(screen.getByText(/You are deleting sprint "Frontend Onboarding"/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(onDeleteSprint).not.toHaveBeenCalled();
      expect(document.activeElement).toHaveAttribute("data-ledger-view-state");
    });
    expect(screen.getByText(/Delete canceled for sprint Frontend Onboarding\. Sprint was not deleted\./i)).toBeInTheDocument();
  });

  it("announces bulk action completion after pending state clears", async () => {
    const user = userEvent.setup();
    const onBulkStart = vi.fn();
    const { rerender } = renderWithI18n(
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
        onBulkStart={onBulkStart}
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

    await user.click(screen.getAllByRole("button", { name: /Select sprint Frontend Onboarding/i })[0]);
    await user.click(screen.getByRole("button", { name: /Start 1 selected sprint/i }));
    expect(onBulkStart).toHaveBeenCalledWith(["sprint-1"]);

    rerender(
      <SprintLedger
        sprints={[mockSprint]}
        listWindow={10}
        onListWindowChange={vi.fn()}
        activeRunsBySprintId={new Map()}
        pauseResumeRunsBySprintId={new Map()}
        interventionBySprintId={new Map()}
        pendingActionIds={new Set(["sprint-start:sprint-1"])}
        onToggleShowcase={vi.fn()}
        onSprintToggle={vi.fn()}
        onSprintPauseResume={vi.fn()}
        onBulkStart={onBulkStart}
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
    expect(screen.getByRole("button", { name: /Starting 1 selected sprint/i })).toBeDisabled();

    rerender(
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
        onBulkStart={onBulkStart}
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

    expect(screen.getByText(/Start completed for 1 selected sprint\./i)).toBeInTheDocument();
  });

  it("surfaces mark-completed pending state on the target row", () => {
    renderWithI18n(
      <table>
        <tbody>
          <SprintLedgerRow
            sprint={mockSprint}
            isSelected={false}
            isEven={false} activeRun={undefined} pauseResumeRun={undefined} humanIntervention={null} isAnyBulkPending={false}
            pendingActionIds={new Set(["sprint-mark-completed:sprint-1"])}
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

    expect(screen.getByText("Completion pending")).toBeInTheDocument();
    expect(screen.getAllByRole("row")[0]).toHaveAttribute("aria-busy", "true");
  });

  it("describes row controls disabled by pending delete", () => {
    renderWithI18n(
      <table>
        <tbody>
          <SprintLedgerRow
            sprint={mockSprint}
            isSelected={false}
            isEven={false} activeRun={undefined} pauseResumeRun={undefined} humanIntervention={null} isAnyBulkPending={false}
            pendingActionIds={new Set(["sprint-delete:sprint-1"])}
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

    const selectButton = screen.getByRole("button", { name: /Cannot select sprint Frontend Onboarding while deleting/i });
    expect(selectButton).toBeDisabled();
    expect(selectButton).toHaveAccessibleDescription(/Controls for sprint Frontend Onboarding are disabled while deletion is pending\./i);
    expect(screen.getByText("Delete pending")).toBeInTheDocument();
  });

  it("reveals and collapses bulk actions based on selection count", () => {
    const { rerender } = renderWithI18n(
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
    renderWithI18n(
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

    const selectLabels = screen.getAllByText("Select");
    expect(selectLabels.find(el => el.classList.contains('lg:hidden'))).toBeInTheDocument();

    const pinLabels = screen.getAllByText("Pin");
    expect(pinLabels.find(el => el.classList.contains('lg:hidden'))).toBeInTheDocument();

    const controlsLabels = screen.getAllByText("Controls");
    expect(controlsLabels.find(el => el.classList.contains('lg:hidden'))).toBeInTheDocument();

    const statusLabels = screen.getAllByText("Status");
    expect(statusLabels.find(el => el.classList.contains('lg:hidden'))).toBeInTheDocument();
  });
});


  it("announces filter results politely", () => {
    renderWithI18n(
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
    const liveRegion = screen.getByText(/Sorted by Created descending\. Showing 1 of 1 sprint\. No sprints selected\./i).closest("div[aria-live]");
    expect(liveRegion).toBeInTheDocument();
  });

  it("supports German filtering, selection, bulk actions, keyboard menus, mobile labels, and live updates", async () => {
    const user = userEvent.setup();
    const onBulkStart = vi.fn();
    const onOpenRowMenu = vi.fn();
    const longName = "Frontend Onboarding mit einem sehr langen unveränderten Sprintnamen für mobile Ansichten";
    const runningSprint = {
      ...mockSprint,
      name: longName,
      goal: "Keep issue OPS-17 and branch feature/original-content verbatim",
    };
    const commonProps = {
      listWindow: 10 as const,
      onListWindowChange: vi.fn(),
      activeRunsBySprintId: new Map<string, { id: string; status: string }>(),
      pauseResumeRunsBySprintId: new Map<string, { id: string; status: string }>(),
      interventionBySprintId: new Map(),
      pendingActionIds: new Set<string>(),
      onToggleShowcase: vi.fn(),
      onSprintToggle: vi.fn(),
      onSprintPauseResume: vi.fn(),
      onOpenRowMenu,
      onBulkStart,
      onBulkDelete: vi.fn(),
      onEditSprint: vi.fn(),
      onExportSprint: vi.fn(),
      onOverridesSprint: vi.fn(),
      onMarkCompletedSprint: vi.fn(),
      onDeleteSprint: vi.fn(),
      onBulkShowcaseEnable: vi.fn(),
      onBulkShowcaseDisable: vi.fn(),
    };
    const view = renderWithI18n(
      <SprintLedger initialQuery="läuft" sprints={[runningSprint, { ...mockSprint, id: "idle-2", status: "idle", name: "Hidden idle record" }]} {...commonProps} />,
      {},
      "de",
    );

    expect(screen.getByText(longName)).toBeInTheDocument();
    expect(screen.getByText("Keep issue OPS-17 and branch feature/original-content verbatim")).toBeInTheDocument();
    expect(screen.queryByText("Hidden idle record")).not.toBeInTheDocument();
    expect(screen.getAllByText("Auswählen").some((element) => element.classList.contains("lg:hidden"))).toBe(true);

    const menuButton = screen.getByRole("button", { name: new RegExp(`Aktionsmenü für Sprint ${longName} öffnen`) });
    menuButton.focus();
    await user.keyboard("{Enter}");
    expect(onOpenRowMenu).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: `Sprint ${longName} auswählen` }));
    expect(await screen.findByText("1 von 1 ausgewählt")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /1 ausgewählten Sprint starten/i }));
    expect(onBulkStart).toHaveBeenCalledWith([runningSprint.id]);

    view.rerender(
      <SprintLedger initialQuery="läuft" sprints={[{ ...runningSprint, status: "paused" }]} {...commonProps} />,
    );
    await waitFor(() => expect(screen.queryByText(longName)).not.toBeInTheDocument());
    expect(screen.getByText("Keine passenden Sprints")).toBeInTheDocument();
  });
