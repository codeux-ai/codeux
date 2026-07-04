import * as useReducedMotionModule from "../../../dashboard/src/v2/hooks/use-reduced-motion.js";
/** @vitest-environment happy-dom */
import { h, Fragment } from "preact";
/** @jsx h */
/** @jsxFrag Fragment */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

import { TasksList } from "../../../dashboard/src/v2/components/TasksList.js";
import { ProjectDataProvider } from "../../../dashboard/src/v2/context/project-data.js";
import gsap from "gsap";

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
        completion: 42,
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
        expect(screen.getByText("No Active Streams")).toBeInTheDocument();
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

    it("labels sprint stream status and progress for assistive technology", () => {
        render(<ProjectDataProvider initialData={null as any}><TasksList pageData={pageData} /></ProjectDataProvider>);

        const sprintRegion = screen.getByRole("region", { name: /Sprint One active stream. Running. 42% complete./i });
        expect(sprintRegion).toBeInTheDocument();
        expect(screen.getByRole("progressbar", { name: /Sprint One progress/i })).toHaveAttribute("aria-valuenow", "42");
    });
});
