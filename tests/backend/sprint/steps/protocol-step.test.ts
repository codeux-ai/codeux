import { describe, expect, it, vi } from "vitest";
import { runProtocolStep } from "../../../../src/sprint/steps/protocol-step.js";
import { Subtask, CiIntelligenceSettings } from "../../../../src/contracts/app-types.js";

describe("protocol-step", () => {
    const ciIntelligence: CiIntelligenceSettings = {
        enabled: true,
        enableLivePrMonitoring: false,
        waitForCiBeforeMainMerge: false,
        resolveAllCommentsBeforeMainMerge: false,
        resolveMainMergeConflicts: false,
        waitForCiBeforeFeatureMerge: true,
        resolveAllCommentsBeforeFeatureMerge: true,
        resolveMergeConflicts: false,
        waitForJulesCiAutofix: false,
        julesCiAutofixMaxRetries: 0,
        featurePrAutoMergeMode: "OFF",
        mainBranchAutoMergeMode: "OFF",
    };

    it("renders lines correctly", async () => {
        const subtasks: Subtask[] = [
            { id: "1", title: "t", prompt: "p", depends_on: [], is_independent: false, status: "COMPLETED", is_merged: false, worker_branch: "worker/1" },
            { id: "2", title: "t", prompt: "p", depends_on: [], is_independent: false, status: "BLOCKED", intervention_owner: "AGENT", intervention_hint: "hint 2" },
            { id: "3", title: "t", prompt: "p", depends_on: [], is_independent: false, status: "BLOCKED", intervention_owner: "HUMAN", intervention_hint: "" },
        ];

        const renderInstruction = vi.fn(async (t, v) => `${t}:${JSON.stringify(v)}`);
        const onTaskEvent = vi.fn();

        const res = await runProtocolStep(subtasks, {
            featureBranch: "fb",
            githubMode: "REMOTE",
            ciIntelligence,
            enableMergeProtocol: true,
            enableActionRequiredProtocol: true,
            isActionRequiredState: () => true,
            renderInstruction,
            onTaskEvent,
        });

        expect(res.instructions).toContain("Wait for CI checks");
        expect(res.instructions).toContain("Resolve all PR comments");
        expect(res.instructions).toContain("hint 2");
        expect(res.instructions).not.toContain("hint 3"); // hint 3 doesn't exist
        expect(onTaskEvent).toHaveBeenCalledWith(expect.objectContaining({
            eventType: "protocol_merge_required",
        }));
        expect(onTaskEvent).toHaveBeenCalledWith(expect.objectContaining({
            eventType: "protocol_action_required",
        }));
    });

    it("excludes PR_CREATED tasks from manual merge protocol", async () => {
        const subtasks: Subtask[] = [
            { id: "1", title: "t", prompt: "p", depends_on: [], is_independent: false, status: "COMPLETED", is_merged: false, merge_indicator: "PR_CREATED", pr_url: "url" },
        ];

        const renderInstruction = vi.fn(async (t, v) => `${t}:${JSON.stringify(v)}`);

        const res = await runProtocolStep(subtasks, {
            featureBranch: "fb",
            githubMode: "REMOTE",
            ciIntelligence,
            enableMergeProtocol: true,
            enableActionRequiredProtocol: true,
            isActionRequiredState: () => false,
            renderInstruction,
        });

        expect(res.instructions).not.toContain("mergeHeader");
        expect(res.manualMergeTasks).toHaveLength(0);
    });

    it("suppresses manual merge instructions for worker-escalated merge conflicts", async () => {
        const subtasks: Subtask[] = [
            { id: "1", title: "t", prompt: "p", depends_on: [], is_independent: false, status: "COMPLETED", is_merged: false, worker_branch: "worker/1" },
        ];

        const renderInstruction = vi.fn(async (t, v) => `${t}:${JSON.stringify(v)}`);
        const res = await runProtocolStep(subtasks, {
            featureBranch: "fb",
            githubMode: "REMOTE",
            ciIntelligence,
            enableMergeProtocol: true,
            enableActionRequiredProtocol: true,
            isActionRequiredState: () => true,
            isWorkerEscalatedMergeConflictTask: () => true,
            renderInstruction,
        });

        expect(res.instructions).toBe("");
        expect(res.manualMergeTasks).toEqual([]);
        expect(res.workerEscalatedMergeConflictTasks).toHaveLength(1);
    });

    it("disables lines when CI intelligence is off", async () => {
        const subtasks: Subtask[] = [
            { id: "1", title: "t", prompt: "p", depends_on: [], is_independent: false, status: "COMPLETED", is_merged: false, worker_branch: "worker/1" },
        ];

        const renderInstruction = vi.fn(async (t, v) => JSON.stringify(v));

        const res = await runProtocolStep(subtasks, {
            featureBranch: "fb",
            githubMode: "REMOTE",
            ciIntelligence: { ...ciIntelligence, enabled: false },
            enableMergeProtocol: true,
            enableActionRequiredProtocol: true,
            isActionRequiredState: () => true,
            renderInstruction
        });

        expect(res.instructions).toContain('"feature_ci_wait_line":""');
        expect(res.instructions).toContain('"feature_comments_line":""');
    });

    it("does not require a merge protocol for completed tasks with no branch or PR output", async () => {
        const subtasks: Subtask[] = [
            { id: "1", title: "t", prompt: "p", depends_on: [], is_independent: false, status: "COMPLETED", is_merged: false },
        ];

        const renderInstruction = vi.fn(async (t, v) => `${t}:${JSON.stringify(v)}`);
        const onTaskEvent = vi.fn();

        const res = await runProtocolStep(subtasks, {
            featureBranch: "fb",
            githubMode: "REMOTE",
            ciIntelligence,
            enableMergeProtocol: true,
            enableActionRequiredProtocol: true,
            isActionRequiredState: () => false,
            renderInstruction,
            onTaskEvent,
        });

        expect(res.awaitingMerge).toEqual([]);
        expect(res.manualMergeTasks).toEqual([]);
        expect(res.instructions).toBe("");
        expect(onTaskEvent).not.toHaveBeenCalled();
    });
});
