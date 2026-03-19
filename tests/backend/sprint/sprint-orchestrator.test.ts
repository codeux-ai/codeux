import { describe, expect, it, vi } from "vitest";
import { SprintOrchestrator } from "../../../src/sprint/sprint-orchestrator.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

describe("sprint-orchestrator", () => {
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
});
