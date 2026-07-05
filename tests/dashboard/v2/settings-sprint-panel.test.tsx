/** @vitest-environment happy-dom */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { useState } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { SettingsSprintPanel } from "../../../dashboard/src/v2/components/settings/panels/SettingsSprintPanel.js";

expect.extend(matchers);

describe("SettingsSprintPanel", () => {
  it("renders Quality Assurance after Merge Gates & Autofix and preserves multi-agent QA project-scope updates", async () => {
    const setActiveScope = vi.fn();
    const baseSettings = {
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
          taskCompletion: { enabled: true, agentPresetIds: [], agentPresetId: null },
          sprintCompletion: { enabled: true, agentPresetIds: [], agentPresetId: null },
          completedTaskWithoutPr: { enabled: true, agentPresetIds: [], agentPresetId: null },
        },
      },
    } as any;
    const updateEditableSettings = vi.fn();
    const updateProject = vi.fn();

    const Harness = () => {
      const [projectSettings, setProjectSettings] = useState(baseSettings);
      updateProject.mockImplementation((recipe: (current: any) => any) => {
        setProjectSettings((current: any) => recipe(current));
      });
      return (
        <SettingsSprintPanel
          state={{
            activeScope: "system",
            setActiveScope,
            selectedProject: { id: "proj-1", name: "Test Project" },
            editableSettings: projectSettings,
            projectSettings,
            projectSources: {},
            projectAgentPresetOptions: [
              { value: "qa-agent-2", label: "QA Agent Beta" },
              { value: "qa-agent-1", label: "Risk Reviewer" },
              { value: "worker-1", label: "Delivery Agent" },
            ],
            updateProject,
            updateEditableSettings,
          } as any}
        />
      );
    };

    render(<Harness />);

    const mergeGatesHeading = screen.getByText("Merge Gates & Autofix");
    const qaHeading = screen.getByText("Quality Assurance");
    const guardrailsHeading = screen.getByText("Guardrails");

    expect(screen.queryByText("Jules CI autofix")).toBeNull();
    expect(Boolean(mergeGatesHeading.compareDocumentPosition(qaHeading) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(qaHeading.compareDocumentPosition(guardrailsHeading) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    const taskCompletionRow = screen.getByText("Review every completed task").closest(".group");
    expect(taskCompletionRow).not.toBeNull();
    const taskCompletionControls = within(taskCompletionRow as HTMLElement);
    expect(taskCompletionControls.getByText("Built-in QA agent fallback is active.")).toBeInTheDocument();

    fireEvent.click(taskCompletionControls.getByRole("checkbox", { name: "QA Agent Beta" }));
    expect(setActiveScope).toHaveBeenCalledWith("project");
    expect(updateProject).toHaveBeenCalled();

    await waitFor(() => {
      expect(taskCompletionControls.getByRole("checkbox", { name: "QA Agent Beta" })).toBeChecked();
    });

    fireEvent.click(taskCompletionControls.getByRole("checkbox", { name: "Risk Reviewer" }));

    await waitFor(() => {
      expect(taskCompletionControls.getByText("2 custom QA agents selected.")).toBeInTheDocument();
      expect(taskCompletionControls.getByRole("checkbox", { name: "QA Agent Beta" })).toBeChecked();
      expect(taskCompletionControls.getByRole("checkbox", { name: "Risk Reviewer" })).toBeChecked();
    });

    const selectTwoRecipe = updateProject.mock.calls[1][0];
    const selectedTwo = selectTwoRecipe({
      ...baseSettings,
      agents: {
        ...baseSettings.agents,
        qualityAssurance: {
          ...baseSettings.agents.qualityAssurance,
          taskCompletion: { enabled: true, agentPresetIds: ["qa-agent-2"], agentPresetId: "qa-agent-2" },
        },
      },
    });
    expect(selectedTwo.agents.qualityAssurance.taskCompletion).toEqual({
      enabled: true,
      agentPresetIds: ["qa-agent-2", "qa-agent-1"],
      agentPresetId: "qa-agent-2",
    });

    fireEvent.click(taskCompletionControls.getByRole("checkbox", { name: "QA Agent Beta" }));

    await waitFor(() => {
      expect(taskCompletionControls.getByText("1 custom QA agent selected.")).toBeInTheDocument();
      expect(taskCompletionControls.getByRole("checkbox", { name: "QA Agent Beta" })).not.toBeChecked();
      expect(taskCompletionControls.getByRole("checkbox", { name: "Risk Reviewer" })).toBeChecked();
    });

    const removeOneRecipe = updateProject.mock.calls[2][0];
    const selectedOne = removeOneRecipe({
      ...baseSettings,
      agents: {
        ...baseSettings.agents,
        qualityAssurance: {
          ...baseSettings.agents.qualityAssurance,
          taskCompletion: { enabled: true, agentPresetIds: ["qa-agent-2", "qa-agent-1"], agentPresetId: "qa-agent-2" },
        },
      },
    });
    expect(selectedOne.agents.qualityAssurance.taskCompletion).toEqual({
      enabled: true,
      agentPresetIds: ["qa-agent-1"],
      agentPresetId: "qa-agent-1",
    });

    fireEvent.click(taskCompletionControls.getByRole("checkbox", { name: "Risk Reviewer" }));

    await waitFor(() => {
      expect(taskCompletionControls.getByText("Built-in QA agent fallback is active.")).toBeInTheDocument();
      expect(taskCompletionControls.getByRole("checkbox", { name: "Risk Reviewer" })).not.toBeChecked();
    });

    const fallbackRecipe = updateProject.mock.calls[3][0];
    const fallback = fallbackRecipe({
      ...baseSettings,
      agents: {
        ...baseSettings.agents,
        qualityAssurance: {
          ...baseSettings.agents.qualityAssurance,
          taskCompletion: { enabled: true, agentPresetIds: ["qa-agent-1"], agentPresetId: "qa-agent-1" },
        },
      },
    });
    expect(fallback.agents.qualityAssurance.taskCompletion).toEqual({
      enabled: true,
      agentPresetIds: [],
      agentPresetId: null,
    });
  });
});
