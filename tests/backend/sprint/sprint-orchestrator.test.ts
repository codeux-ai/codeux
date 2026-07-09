import { afterEach, describe, expect, it, vi } from "vitest";
import { SprintOrchestrator } from "../../../src/sprint/sprint-orchestrator.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import type { CiIntelligenceSettings } from "../../../src/contracts/app-types.js";

describe("sprint-orchestrator", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("handles renderMainMergeCiFeedback when getCiStatusForScope is not provided", async () => {
        const deps = {
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
            settings: { dashboardPort: 3000 },
            completedSprints: new Set(),
            renderInstruction: vi.fn().mockResolvedValue(""),
            sprintExecutionStateService: {
                resolveContext: vi.fn().mockReturnValue({
                    project: { id: "project-1", name: "Test Project" },
                    sprint: { id: "sprint-1", name: "Sprint 1" },
                    sprintNumber: 1,
                    repoPath: "/tmp/repo",
                    featureBranch: "feature/sprint1-implementation",
                    defaultBranch: "main",
                }),
                hasPlannedTasks: vi.fn().mockReturnValue(true),
                loadSubtasks: vi.fn().mockResolvedValue([]),
            },
            getDashboardSettings: vi.fn().mockReturnValue({
                ...DEFAULT_DASHBOARD_SETTINGS,
                sprintLoopSteps: { ...DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps, planningPreflight: false },
                ciIntelligence: { ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence },
                aiProvider: { ...DEFAULT_DASHBOARD_SETTINGS.aiProvider, providers: {} as any },
            }),
        };
        const orch = new SprintOrchestrator(deps as any);

        const feedback = await (orch as any).renderMainMergeCiFeedback({ repoPath: "path", featureBranch: "a", defaultBranch: "b", featureBranchPrefix: "c" });
        expect(feedback).toMatchObject({
            text: "",
            state: "unavailable",
            prNumber: null,
        });
    });

    it("returns message if sprint already completed", async () => {
        const deps = {
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
            settings: { dashboardPort: 3000 },
            completedSprints: new Set([1]),
            renderInstruction: vi.fn().mockResolvedValue(""),
            sprintExecutionStateService: {
                resolveContext: vi.fn().mockReturnValue({
                    project: { id: "project-1", name: "Test Project" },
                    sprint: { id: "sprint-1", name: "Sprint 1" },
                    sprintNumber: 1,
                    repoPath: "/tmp/repo",
                    featureBranch: "feature/sprint1-implementation",
                    defaultBranch: "main",
                }),
                hasPlannedTasks: vi.fn().mockReturnValue(true),
                loadSubtasks: vi.fn().mockResolvedValue([]),
            },
            getDashboardSettings: vi.fn().mockReturnValue({
                ...DEFAULT_DASHBOARD_SETTINGS,
                sprintLoopSteps: { ...DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps, planningPreflight: false },
                ciIntelligence: { ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence },
                aiProvider: {
                    ...DEFAULT_DASHBOARD_SETTINGS.aiProvider,
                    providers: {
                        ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers,
                        gemini: {
                            ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.gemini,
                            enabled: true,
                        },
                    },
                },
            }),
        };
        const orch = new SprintOrchestrator(deps as any);

        const res = await orch.execute({ sprint_number: 1, action: "status" } as any);
        expect(res.content[0].text).toContain("already been finished");
    });

    it("creates the missing main PR and auto-merges it when main auto-merge is enabled", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-07-03T02:31:30.000Z"));
        const ciIntelligence: CiIntelligenceSettings = {
            ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence,
            enabled: true,
            enableLivePrMonitoring: true,
            mainBranchAutoMergeMode: "WHEN_GREEN",
        };
        const getCiStatusForScope = vi.fn()
            .mockResolvedValueOnce({
                available: true,
                openPullRequests: [],
                mergedPullRequests: [],
            })
            .mockResolvedValueOnce({
                available: true,
                openPullRequests: [
                    {
                        number: 321,
                        url: "https://github.com/example/repo/pull/321",
                        headRefName: "feature/sprint1-implementation",
                        baseRefName: "main",
                        reviewDecision: "APPROVED",
                        comments: 0,
                        checks: [{ name: "build", status: "completed", conclusion: "success" }],
                    },
                ],
                mergedPullRequests: [],
            });
        const resolveOrCreateMainBranchPr = vi.fn().mockResolvedValue({
            created: true,
            prNumber: 321,
            prUrl: "https://github.com/example/repo/pull/321",
        });
        const autoMergeFeaturePr = vi.fn().mockResolvedValue({ ok: true, merged: true });

        const deps = {
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
            settings: { dashboardPort: 3000 },
            completedSprints: new Set(),
            renderInstruction: vi.fn().mockResolvedValue(""),
            sprintExecutionStateService: {
                resolveContext: vi.fn(),
                hasPlannedTasks: vi.fn(),
                loadSubtasks: vi.fn(),
            },
            getDashboardSettings: vi.fn().mockReturnValue(DEFAULT_DASHBOARD_SETTINGS),
            getCiStatusForScope,
            resolveOrCreateMainBranchPr,
            autoMergeFeaturePr,
            projectManagementRepository: {
                getSprint: vi.fn().mockReturnValue({
                    id: "sprint-1",
                    projectId: "project-1",
                    number: 1,
                    name: "Sprint 1",
                    originalPrompt: null,
                    goal: "Awesome sprint description",
                    latestReview: undefined,
                }),
            },
            executionRepository: {
                getSprintRun: vi.fn().mockReturnValue({
                    id: "run-1",
                    projectId: "project-1",
                    sprintId: "sprint-1",
                    status: "running",
                    triggerType: "mcp",
                    triggeredBy: "worker",
                    executorMode: "mixed",
                    startedAt: "2026-07-03T02:18:16.000Z",
                    finishedAt: null,
                    lastHeartbeatAt: "2026-07-03T02:20:00.000Z",
                    createdAt: "2026-07-03T02:18:16.000Z",
                    updatedAt: "2026-07-03T02:20:00.000Z",
                }),
                getSprintUsageGroups: vi.fn().mockReturnValue([]),
                listProviderInvocationsForSprint: vi.fn().mockReturnValue([]),
            },
        };
        const orch = new SprintOrchestrator(deps as any);

        const feedback = await (orch as any).renderMainMergeCiFeedback({
            repoPath: "/tmp/repo",
            projectId: "project-1",
            sprintId: "sprint-1",
            sprintRunId: "run-1",
            featureBranch: "feature/sprint1-implementation",
            defaultBranch: "main",
            featureBranchPrefix: "feature/",
            sprintNumber: 1,
            sprintName: "Sprint 1",
            sprintDescription: "Awesome sprint description",
            ciIntelligence,
            githubMode: "REMOTE",
        });

        expect(resolveOrCreateMainBranchPr).toHaveBeenCalledWith(expect.objectContaining({
            repoPath: "/tmp/repo",
            featureBranch: "feature/sprint1-implementation",
            defaultBranch: "main",
            body: expect.stringContaining("Awesome sprint description"),
        }));
        const mainPrBody = resolveOrCreateMainBranchPr.mock.calls[0][0].body;
        expect(mainPrBody).toContain("| Started | 2026-07-03 02:18:16 UTC |");
        expect(mainPrBody).toContain("| Finished | 2026-07-03 02:31:30 UTC |");
        expect(mainPrBody).toContain("| Duration | 13m 14s |");
        expect(mainPrBody).not.toContain("NaN");
        expect(mainPrBody).not.toContain("| Duration | — |");
        expect(autoMergeFeaturePr).toHaveBeenCalledWith({ repoPath: "/tmp/repo", prNumber: 321 });
        expect(feedback.state).toBe("automerge_succeeded");
        expect(feedback.text).toContain("Main PR Created");
    });

    it("surfaces main PR creation failures in merge gate feedback", async () => {
        const ciIntelligence: CiIntelligenceSettings = {
            ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence,
            enabled: true,
            enableLivePrMonitoring: true,
            mainBranchAutoMergeMode: "WHEN_GREEN",
        };
        const getCiStatusForScope = vi.fn().mockResolvedValue({
            available: true,
            openPullRequests: [],
            mergedPullRequests: [],
        });
        const resolveOrCreateMainBranchPr = vi.fn().mockResolvedValue({
            created: false,
            prNumber: null,
            prUrl: null,
            errorMessage: "bad credentials",
        });

        const deps = {
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
            settings: { dashboardPort: 3000 },
            completedSprints: new Set(),
            renderInstruction: vi.fn().mockResolvedValue(""),
            sprintExecutionStateService: {
                resolveContext: vi.fn(),
                hasPlannedTasks: vi.fn(),
                loadSubtasks: vi.fn(),
            },
            getDashboardSettings: vi.fn().mockReturnValue(DEFAULT_DASHBOARD_SETTINGS),
            getCiStatusForScope,
            resolveOrCreateMainBranchPr,
            autoMergeFeaturePr: vi.fn(),
            projectManagementRepository: {
                getSprint: vi.fn().mockReturnValue({
                    id: "sprint-1",
                    projectId: "project-1",
                    number: 1,
                    name: "Sprint 1",
                    originalPrompt: null,
                    goal: "Awesome sprint description",
                    latestReview: undefined,
                }),
            },
            executionRepository: {
                getSprintRun: vi.fn().mockReturnValue(null),
                getSprintUsageGroups: vi.fn().mockReturnValue([]),
                listProviderInvocationsForSprint: vi.fn().mockReturnValue([]),
            },
        };
        const orch = new SprintOrchestrator(deps as any);

        const feedback = await (orch as any).renderMainMergeCiFeedback({
            repoPath: "/tmp/repo",
            projectId: "project-1",
            sprintId: "sprint-1",
            sprintRunId: "run-1",
            featureBranch: "feature/sprint1-implementation",
            defaultBranch: "main",
            featureBranchPrefix: "feature/",
            sprintNumber: 1,
            sprintName: "Sprint 1",
            sprintDescription: "Awesome sprint description",
            ciIntelligence,
            githubMode: "REMOTE",
        });

        expect(resolveOrCreateMainBranchPr).toHaveBeenCalled();
        expect(feedback.state).toBe("missing_pr");
        expect(feedback.text).toContain("Main PR Creation Failed");
        expect(feedback.text).toContain("bad credentials");
    });

    it("waits for PR status refresh after creating a main PR that is not immediately listed", async () => {
        const ciIntelligence: CiIntelligenceSettings = {
            ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence,
            enabled: true,
            enableLivePrMonitoring: true,
            mainBranchAutoMergeMode: "WHEN_GREEN",
        };
        const getCiStatusForScope = vi.fn()
            .mockResolvedValueOnce({
                available: true,
                openPullRequests: [],
                mergedPullRequests: [],
            })
            .mockResolvedValueOnce({
                available: true,
                openPullRequests: [],
                mergedPullRequests: [],
            });
        const resolveOrCreateMainBranchPr = vi.fn().mockResolvedValue({
            created: true,
            prNumber: 322,
            prUrl: "https://github.com/example/repo/pull/322",
        });
        const autoMergeFeaturePr = vi.fn();

        const deps = {
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
            settings: { dashboardPort: 3000 },
            completedSprints: new Set(),
            renderInstruction: vi.fn().mockResolvedValue(""),
            sprintExecutionStateService: {
                resolveContext: vi.fn(),
                hasPlannedTasks: vi.fn(),
                loadSubtasks: vi.fn(),
            },
            getDashboardSettings: vi.fn().mockReturnValue(DEFAULT_DASHBOARD_SETTINGS),
            getCiStatusForScope,
            resolveOrCreateMainBranchPr,
            autoMergeFeaturePr,
            projectManagementRepository: {
                getSprint: vi.fn().mockReturnValue({
                    id: "sprint-1",
                    projectId: "project-1",
                    number: 1,
                    name: "Sprint 1",
                    originalPrompt: null,
                    goal: "Awesome sprint description",
                    latestReview: undefined,
                }),
            },
            executionRepository: {
                getSprintRun: vi.fn().mockReturnValue(null),
                getSprintUsageGroups: vi.fn().mockReturnValue([]),
                listProviderInvocationsForSprint: vi.fn().mockReturnValue([]),
            },
        };
        const orch = new SprintOrchestrator(deps as any);

        const feedback = await (orch as any).renderMainMergeCiFeedback({
            repoPath: "/tmp/repo",
            projectId: "project-1",
            sprintId: "sprint-1",
            sprintRunId: "run-1",
            featureBranch: "feature/sprint1-implementation",
            defaultBranch: "main",
            featureBranchPrefix: "feature/",
            sprintNumber: 1,
            sprintName: "Sprint 1",
            sprintDescription: "Awesome sprint description",
            ciIntelligence,
            githubMode: "REMOTE",
        });

        expect(feedback.state).toBe("pending_checks");
        expect(feedback.prNumber).toBe(322);
        expect(feedback.text).toContain("Main PR Created");
        expect(feedback.text).toContain("Waiting for GitHub");
        expect(feedback.text).not.toContain("No open PR");
        expect(autoMergeFeaturePr).not.toHaveBeenCalled();
    });
});
