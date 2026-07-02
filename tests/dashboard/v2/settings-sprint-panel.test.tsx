/** @vitest-environment happy-dom */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { SettingsSprintPanel } from "../../../dashboard/src/v2/components/settings/panels/SettingsSprintPanel.js";

expect.extend(matchers);

describe("SettingsSprintPanel", () => {
  it("renders Quality Assurance after Merge Gates & Autofix and preserves QA project-scope updates", async () => {
    const setActiveScope = vi.fn();
    const updateProject = vi.fn((recipe: (current: any) => any) => recipe({
      git: {
        githubMode: "REMOTE",
        defaultBranch: "main",
        featureBranchPrefix: "feat/",
        sprintKeyPrefix: "SPR",
        sprintBranchScheme: "{sprint_name}",
        autoCreatePr: true,
        autoCloseLinkedIssues: true,
        deleteMergedBranches: true,
      },
      ciIntelligence: {
        resolveAllCommentsBeforeMainMerge: true,
        resolveMainMergeConflicts: true,
        resolveMainMergeFailedChecks: true,
        resolveAllCommentsBeforeFeatureMerge: true,
        resolveMergeConflicts: true,
        waitForJulesCiAutofix: true,
        featurePrAutoMergeMode: "CREATE_PR",
        mainBranchAutoMergeMode: "CREATE_PR",
      },
      guardrails: {
        enabled: true,
        jobs: {
          task_coding: { cap: 1, onLimit: "BLOCK_AND_ESCALATE" },
          ci_fix: { cap: 1, onLimit: "BLOCK_AND_ESCALATE" },
          merge_conflict: { cap: 1, onLimit: "BLOCK_AND_ESCALATE" },
          clarification_reply: { cap: 1, onLimit: "BLOCK_AND_ESCALATE" },
          planning: { cap: 1, onLimit: "BLOCK_AND_ESCALATE" },
          remediation: { cap: 1, onLimit: "BLOCK_AND_ESCALATE" },
        },
        perTaskTotalCeiling: 0,
      },
      cliWorkflow: {
        retryOnQuotaReset: true,
        retryOnRateLimit: true,
        rateLimitRetryDelaySeconds: 30,
        maxRateLimitRetries: 5,
        maxQuotaRetriesWithoutTimer: 3,
        cleanupWorktreeOnSuccess: true,
        cleanupWorktreeOnFailure: true,
      },
      sprintLoopSteps: {
        watchLoop: true,
        watchLoopIntervalSeconds: 30,
        watchLoopOutputIntervalSeconds: 30,
      },
      agents: {
        qualityAssurance: {
          enabled: true,
          maxTaskReviewRuns: 2,
          maxSprintReviewRuns: 2,
          exhaustionPolicy: "ESCALATE_TO_HUMAN",
          taskCompletion: { enabled: true, agentPresetId: null },
          sprintCompletion: { enabled: true, agentPresetId: null },
          completedTaskWithoutPr: { enabled: true, agentPresetId: null },
        },
      },
    }));
    const editableSettings = {
      git: {
        githubMode: "REMOTE",
        defaultBranch: "main",
        featureBranchPrefix: "feat/",
        sprintKeyPrefix: "SPR",
        sprintBranchScheme: "{sprint_name}",
        autoCreatePr: true,
        autoCloseLinkedIssues: true,
        deleteMergedBranches: true,
      },
      ciIntelligence: {
        resolveAllCommentsBeforeMainMerge: true,
        resolveMainMergeConflicts: true,
        resolveMainMergeFailedChecks: true,
        resolveAllCommentsBeforeFeatureMerge: true,
        resolveMergeConflicts: true,
        waitForJulesCiAutofix: true,
        featurePrAutoMergeMode: "CREATE_PR",
        mainBranchAutoMergeMode: "CREATE_PR",
      },
      guardrails: {
        enabled: true,
        jobs: {
          task_coding: { cap: 1, onLimit: "BLOCK_AND_ESCALATE" },
          ci_fix: { cap: 1, onLimit: "BLOCK_AND_ESCALATE" },
          merge_conflict: { cap: 1, onLimit: "BLOCK_AND_ESCALATE" },
          clarification_reply: { cap: 1, onLimit: "BLOCK_AND_ESCALATE" },
          planning: { cap: 1, onLimit: "BLOCK_AND_ESCALATE" },
          remediation: { cap: 1, onLimit: "BLOCK_AND_ESCALATE" },
        },
        perTaskTotalCeiling: 0,
      },
      cliWorkflow: {
        retryOnQuotaReset: true,
        retryOnRateLimit: true,
        rateLimitRetryDelaySeconds: 30,
        maxRateLimitRetries: 5,
        maxQuotaRetriesWithoutTimer: 3,
        cleanupWorktreeOnSuccess: true,
        cleanupWorktreeOnFailure: true,
      },
      sprintLoopSteps: {
        watchLoop: true,
        watchLoopIntervalSeconds: 30,
        watchLoopOutputIntervalSeconds: 30,
      },
      agents: {
        qualityAssurance: {
          enabled: true,
          maxTaskReviewRuns: 2,
          maxSprintReviewRuns: 2,
          exhaustionPolicy: "ESCALATE_TO_HUMAN",
          taskCompletion: { enabled: true, agentPresetId: null },
          sprintCompletion: { enabled: true, agentPresetId: null },
          completedTaskWithoutPr: { enabled: true, agentPresetId: null },
        },
      },
    } as any;

    render(
      <SettingsSprintPanel
        state={{
          activeScope: "system",
          setActiveScope,
          selectedProject: { id: "proj-1", name: "Test Project" },
          editableSettings,
          projectSettings: editableSettings,
          projectSources: {},
          projectAgentPresetOptions: [
            { value: "qa-agent-2", label: "QA Agent Beta" },
            { value: "qa-agent-1", label: "Risk Reviewer" },
            { value: "worker-1", label: "Delivery Agent" },
          ],
          updateProject,
          updateEditableSettings: vi.fn(),
        } as any}
      />,
    );

    const mergeGatesHeading = screen.getByText("Merge Gates & Autofix");
    const qaHeading = screen.getByText("Quality Assurance");
    const guardrailsHeading = screen.getByText("Guardrails");

    expect(Boolean(mergeGatesHeading.compareDocumentPosition(qaHeading) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(qaHeading.compareDocumentPosition(guardrailsHeading) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    const taskCompletionRow = screen.getByText("Review every completed task").closest(".group");
    expect(taskCompletionRow).not.toBeNull();
    const presetTrigger = within(taskCompletionRow as HTMLElement).getByText("Built-in QA agent");
    expect(presetTrigger).toBeInTheDocument();

    fireEvent.click(presetTrigger);

    await waitFor(() => {
      expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
        "Built-in QA agent",
        "QA Agent Beta",
        "Risk Reviewer",
        "Delivery Agent",
      ]);
    });

    fireEvent.click(screen.getByRole("option", { name: "QA Agent Beta" }));

    expect(setActiveScope).toHaveBeenCalledWith("project");
    expect(updateProject).toHaveBeenCalled();

    const recipe = updateProject.mock.calls[0][0];
    const next = recipe({
      ...editableSettings,
      agents: {
        ...editableSettings.agents,
        qualityAssurance: {
          ...editableSettings.agents.qualityAssurance,
          taskCompletion: { enabled: true, agentPresetId: null },
        },
      },
    });
    expect(next.agents.qualityAssurance.taskCompletion.agentPresetId).toBe("qa-agent-2");
  });
});
