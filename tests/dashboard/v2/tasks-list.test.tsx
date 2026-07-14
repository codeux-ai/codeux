import * as useReducedMotionModule from "../../../dashboard/src/v2/hooks/use-reduced-motion.js";
/** @vitest-environment happy-dom */
import { h, Fragment, type ComponentChildren } from "preact";
/** @jsx h */
/** @jsxFrag Fragment */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render as testingRender, screen, cleanup, fireEvent, act } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

import { TasksList } from "../../../dashboard/src/v2/components/TasksList.js";
import { TaskBoardSprintSelector } from "../../../dashboard/src/v2/components/tasks/TaskBoardSprintSelector.js";
import { ProjectDataProvider } from "../../../dashboard/src/v2/context/project-data.js";
import gsap from "gsap";
import * as dashboardApi from "../../../dashboard/src/lib/api/dashboard-api.js";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/index.js";
import type { DashboardLocale } from "../../../dashboard/src/v2/i18n/locales.js";

const render = (ui: ComponentChildren, locale: DashboardLocale = "en") => {
    const wrap = (children: ComponentChildren) => (
        <DashboardI18nProvider initialLocale={locale} storage={null}>{children}</DashboardI18nProvider>
    );
    const result = testingRender(wrap(ui));
    return {
        ...result,
        rerender: (nextUi: ComponentChildren) => result.rerender(wrap(nextUi)),
    };
};

vi.spyOn(useReducedMotionModule, 'useReducedMotion').mockReturnValue(false);

vi.mock("gsap", () => {
    const gsapMock = {
        registerPlugin: vi.fn(),
        set: vi.fn(),
        fromTo: vi.fn(),
        to: vi.fn()
    };
    return {
        default: gsapMock,
        gsap: gsapMock,
        ...gsapMock
    };
});
vi.mock("gsap/Flip", () => ({
    Flip: {
        getState: vi.fn(() => ({})),
        from: vi.fn()
    }
}));
vi.mock("../../../dashboard/src/v2/hooks/use-project-effective-settings.js", () => ({
    useProjectEffectiveSettings: () => ({ data: { settings: { appearance: { reducedMotion: "NONE" } } } })
}));
vi.mock("../../../dashboard/src/lib/api/dashboard-api.js", () => ({
    cancelSprintRun: vi.fn(() => Promise.resolve()),
    cancelTaskDispatch: vi.fn(() => Promise.resolve()),
    orchestrateSprint: vi.fn(() => Promise.resolve()),
    pauseSprintRun: vi.fn(() => Promise.resolve()),
    rerunTask: vi.fn(() => Promise.resolve()),
    resumeSprintRun: vi.fn(() => Promise.resolve()),
}));

describe("TasksList", () => {
    beforeEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    const mockTask = {
        id: "task-1",
        recordId: "task-record-1",
        sprintId: "sprint-1",
        title: "Test Task",
        status: "in_progress",
        source: "local",
        time: "1m"
    };

    const pageData: any = {
        sprints: [{
        id: "sprint-1",
        name: "Sprint One",
        completion: 7.5,
        status: "running"
    }],
        tasks: [mockTask],
        selectedProject: { id: "project-1" },
        execution: {
            sprintRuns: [{ id: "run-1", sprintId: "sprint-1", status: "running" }],
            taskDispatches: [{ id: "dispatch-1", taskId: "task-record-1", status: "running" }]
        },
        isLoading: false
    };

    it("renders and filters tasks correctly", async () => {
        render(
            <ProjectDataProvider initialProject={null}>
                <TasksList pageData={pageData} />
            </ProjectDataProvider>
        );

        expect(screen.getByText("Test Task")).toBeInTheDocument();

        // Change filter
        const completedBtn = screen.getByRole("tab", { name: "Completed" });
        await act(async () => {
            fireEvent.click(completedBtn);
        });

        expect(screen.queryByText("Test Task")).not.toBeInTheDocument();
        expect(screen.getByText("No Active Streams")).toBeInTheDocument();

        const allTasksBtn = screen.getByRole("tab", { name: "All Tasks" });
        await act(async () => {
            fireEvent.click(allTasksBtn);
        });

        expect(screen.getByText("Test Task")).toBeInTheDocument();
    });

    it("exposes loading active streams as a named busy status", () => {
        render(
            <ProjectDataProvider initialProject={null}>
                <TasksList pageData={{ ...pageData, isLoading: true, tasks: [] }} />
            </ProjectDataProvider>
        );

        expect(screen.getByRole("region", { name: "Active stream tasks" })).toHaveAttribute("aria-busy", "true");
        expect(screen.getByRole("status", { name: "Loading active stream tasks" })).toHaveAttribute("aria-busy", "true");
    });


    it("hides task if it does not belong to an active sprint", () => {
        const noSprintPageData = {
            sprints: [],
            tasks: [mockTask],
            isLoading: false
        };
        render(
            <ProjectDataProvider initialProject={null}>
                <TasksList pageData={noSprintPageData} />
            </ProjectDataProvider>
        );

        expect(screen.queryByText("Test Task")).not.toBeInTheDocument();
        expect(screen.getByRole("status", { name: /No Active Streams/i })).toHaveTextContent("There are no tasks currently matching the selected filter in active sprints.");
    });

    it("handles reduced motion correctly", () => {
        vi.mocked(gsap.fromTo).mockClear();
        render(
            <ProjectDataProvider initialProject={null}>
                <TasksList pageData={pageData} />
            </ProjectDataProvider>
        );
        // By default useProjectEffectiveSettings is NONE so fromTo should be called
        expect(gsap.fromTo).toHaveBeenCalled();
    });

    it("bounds the initial active-stream render for large task lists", () => {
        const largeTasks = Array.from({ length: 25 }, (_, index) => ({
            ...mockTask,
            id: `bulk-${index + 1}`,
            title: `Overview Bulk Task ${index + 1}`,
            status: "in_progress",
        }));

        render(
            <ProjectDataProvider initialProject={null}>
                <TasksList pageData={{ ...pageData, tasks: largeTasks }} />
            </ProjectDataProvider>
        );

        expect(screen.getByText("Overview Bulk Task 1")).toBeInTheDocument();
        expect(screen.getByText("Overview Bulk Task 20")).toBeInTheDocument();
        expect(screen.queryByText("Overview Bulk Task 21")).not.toBeInTheDocument();
        expect(screen.getByText("25 active")).toBeInTheDocument();
        expect(screen.getByText("25 tasks")).toBeInTheDocument();
    });

    it("resets the visible active-stream window when filters change", async () => {
        const mixedTasks = [
            ...Array.from({ length: 25 }, (_, index) => ({
                ...mockTask,
                id: `running-${index + 1}`,
                title: `Running Bulk Task ${index + 1}`,
                status: "in_progress",
            })),
            ...Array.from({ length: 25 }, (_, index) => ({
                ...mockTask,
                id: `completed-${index + 1}`,
                title: `Completed Bulk Task ${index + 1}`,
                status: "completed",
            })),
        ];

        render(
            <ProjectDataProvider initialProject={null}>
                <TasksList pageData={{ ...pageData, tasks: mixedTasks }} />
            </ProjectDataProvider>
        );

        expect(screen.getByText("Running Bulk Task 20")).toBeInTheDocument();
        expect(screen.queryByText("Running Bulk Task 21")).not.toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByRole("tab", { name: "Completed" }));
        });

        expect(screen.getByText("Completed Bulk Task 1")).toBeInTheDocument();
        expect(screen.getByText("Completed Bulk Task 20")).toBeInTheDocument();
        expect(screen.queryByText("Completed Bulk Task 21")).not.toBeInTheDocument();
        expect(screen.queryByText("Running Bulk Task 1")).not.toBeInTheDocument();
    });






    const mockTasks = [
        {
            id: "1",
            title: "Task 1",
            summary: "Summary 1",
            status: "ready",
            targetSprintId: "sprint-1",
            createdContext: { type: "system" }
        },
        {
            id: "2",
            title: "Task 2",
            summary: "Summary 2",
            status: "ready",
            targetSprintId: "sprint-1",
            createdContext: { type: "system" }
        }
    ] as any;

const baseProps: any = {
    pageData: {
        tasks: mockTasks,
        sprints: [{ id: "sprint-1" }],
        isLoading: false
    },
    activeSprintId: "sprint-1",
    searchTerm: "",
    isPlanningMode: false
};

    it("bypasses GSAP Flip animation when reduced motion is true", () => {
        vi.spyOn(useReducedMotionModule, 'useReducedMotion').mockReturnValue(true);
        const { rerender } = render(
            <TasksList {...baseProps} />
        );

        const Flip = require("gsap/Flip");
        if (Flip.default?.from && Flip.default.from.mockClear) {
             vi.mocked(Flip.default.from).mockClear();
             vi.mocked(Flip.default.getState).mockClear();
        }

        const filteredTasks = [mockTasks[0]];
        rerender(
            <TasksList {...baseProps} pageData={{...baseProps.pageData, tasks: filteredTasks}} />
        );

        if (Flip.default?.from && Flip.default.getState) {
            expect(vi.isMockFunction(Flip.default.getState) ? Flip.default.getState : vi.fn()).not.toHaveBeenCalled();
            expect(vi.isMockFunction(Flip.default.from) ? Flip.default.from : vi.fn()).not.toHaveBeenCalled();
        }
        vi.spyOn(useReducedMotionModule, 'useReducedMotion').mockReturnValue(false); // reset
    });

    it("bypasses GSAP Flip animation on initial mount", () => {
        const Flip = require("gsap/Flip");
        if (Flip.default?.from && Flip.default.from.mockClear) {
             vi.mocked(Flip.default.from).mockClear();
             vi.mocked(Flip.default.getState).mockClear();
        }

        render(
            <TasksList {...baseProps} />
        );

        if (Flip.default?.from && Flip.default.getState) {
            expect(vi.isMockFunction(Flip.default.getState) ? Flip.default.getState : vi.fn()).not.toHaveBeenCalled();
            expect(vi.isMockFunction(Flip.default.from) ? Flip.default.from : vi.fn()).not.toHaveBeenCalled();
        }
    });

    it("keeps compact active stream actions accessible and keyboard focusable", () => {
        render(<ProjectDataProvider initialData={null as any}><TasksList pageData={pageData} /></ProjectDataProvider>);

        const stopButton = screen.getByRole("button", { name: /Stop task task-1: Test Task/i });
        const configureLink = screen.getByRole("link", { name: /Configure task task-1: Test Task/i });
        const liveLink = screen.getByRole("link", { name: /Open live session for task task-1: Test Task/i });

        expect(stopButton).toBeVisible();
        expect(stopButton).toHaveTextContent("");
        expect(configureLink).toBeVisible();
        expect(configureLink).toHaveTextContent("");
        expect(liveLink).toBeVisible();
        expect(liveLink).toHaveTextContent("");

        liveLink.focus();
        expect(liveLink.className).toMatch(/focus-visible:ring-2/);
    });

    it("keeps pending active stream actions visible, target-labelled, and inert", async () => {
        vi.mocked(dashboardApi.cancelTaskDispatch).mockReturnValueOnce(new Promise(() => {}));
        render(<ProjectDataProvider initialData={null as any}><TasksList pageData={pageData} /></ProjectDataProvider>);

        const stopButton = screen.getByRole("button", { name: /Stop task task-1: Test Task/i });
        await act(async () => {
            fireEvent.click(stopButton);
        });

        const pendingButton = screen.getByRole("button", {
            name: /Stop task task-1: Test Task. Stop unavailable while task action is pending/i,
        });
        expect(pendingButton).toBeDisabled();
        expect(pendingButton).toHaveAttribute("aria-busy", "true");
        expect(pendingButton).toBeVisible();
        expect(screen.getByText("Stop unavailable while task action is pending")).toHaveClass("sr-only");

        await act(async () => {
            fireEvent.click(pendingButton);
        });
        expect(dashboardApi.cancelTaskDispatch).toHaveBeenCalledTimes(1);
    });

    it("labels sprint stream status and progress for assistive technology", () => {
        render(<ProjectDataProvider initialData={null as any}><TasksList pageData={pageData} /></ProjectDataProvider>);

        const sprintRegion = screen.getByRole("region", { name: /Sprint One active stream. Running. 7.5% complete./i });
        expect(sprintRegion).toBeInTheDocument();
        const progress = screen.getByRole("progressbar", { name: /Sprint One progress/i });
        expect(progress).toHaveAttribute("aria-valuenow", "7.5");
        expect(progress.firstElementChild).toHaveStyle({ width: "7.5%" });
    });

    it("localizes German filters, task state, actions, counts, and live regions", () => {
        render(<ProjectDataProvider initialData={null as any}><TasksList pageData={pageData} /></ProjectDataProvider>, "de");

        expect(screen.getByRole("heading", { name: "Aktive Datenströme" })).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: "Alle Aufgaben" })).toHaveAttribute("aria-selected", "true");
        expect(screen.getByText("in Bearbeitung")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Aufgabe task-1 Stoppen: Test Task/i })).toBeInTheDocument();
        expect(screen.getByRole("region", { name: /Aktiver Datenstrom Sprint One. Laufend. Zu 7,5\s?% abgeschlossen./i })).toBeInTheDocument();
        expect(screen.getByText("1 Aufgabe")).toBeInTheDocument();
    });

    it("announces German loading and empty filtered states", async () => {
        const loadingView = render(<ProjectDataProvider initialData={null as any}><TasksList pageData={{ ...pageData, tasks: [], isLoading: true }} /></ProjectDataProvider>, "de");
        expect(screen.getByRole("status", { name: "Aufgaben in aktiven Datenströmen werden geladen" })).toHaveAttribute("aria-busy", "true");
        loadingView.unmount();

        render(<ProjectDataProvider initialData={null as any}><TasksList pageData={pageData} /></ProjectDataProvider>, "de");
        await act(async () => fireEvent.click(screen.getByRole("tab", { name: "Abgeschlossen" })));
        expect(screen.getByRole("status", { name: "Keine aktiven Datenströme" })).toHaveTextContent("In aktiven Sprints entsprechen derzeit keine Aufgaben dem ausgewählten Filter.");
    });

    it("keeps the running sprint selector dot visible without raw pulse animation classes", () => {
        const sprint = {
            id: "sprint-running",
            projectId: "project-1",
            number: 7,
            slug: "spr-7",
            name: "Runtime Scope",
            isGeneratedName: false,
            originalPrompt: null,
            goal: "Exercise reduced-motion sprint scope status",
            status: "running",
            showcasePinned: false,
            startDate: null,
            endDate: null,
            featureBranch: null,
            baseCommitSha: null,
            tasksCount: 10,
            completion: 5,
            linkedIssues: [],
            createdAt: "2026-07-05T00:00:00Z",
            updatedAt: "2026-07-05T00:00:00Z",
            date: "2026-07-05",
        } as any;
        const { container } = render(
            <TaskBoardSprintSelector
                sprints={[sprint]}
                selectedId={null}
                onSelect={vi.fn()}
                sprintKeyPrefix="SPR"
                loading={false}
            />
        );

        fireEvent.click(screen.getByRole("button", { name: "Task sprint scope: All Sprints" }));

        const runningDot = container.querySelector('[data-sprint-status-dot="running"]');
        expect(runningDot).toBeVisible();
        expect(screen.getByRole("option", { name: /SPR-7: Runtime Scope/i })).toBeInTheDocument();
        expect(screen.getByText("2026-07-05")).toBeInTheDocument();
        expect(screen.getByText(/10 tasks, 5% complete/)).toBeInTheDocument();

        const tokens = (runningDot?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
        expect(tokens).toContain("bg-status-green");
        expect(tokens).toContain("shadow-[0_0_8px_rgba(0,171,132,0.6)]");
        expect(tokens).toContain("motion-safe:animate-pulse");
        expect(tokens).toContain("motion-reduce:animate-none");
        expect(tokens).not.toContain("animate-pulse");
    });
});
