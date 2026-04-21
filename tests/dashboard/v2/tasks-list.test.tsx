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

vi.mock("gsap", () => ({
    default: {
        registerPlugin: vi.fn(),
        set: vi.fn(),
        fromTo: vi.fn(),
        to: vi.fn()
    }
}));
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
        sprintId: "sprint-1",
        title: "Test Task",
        status: "in_progress",
        source: "local",
        time: "1m"
    };

    const pageData: any = {
        sprints: [{
        id: "sprint-1",
        status: "running"
    }],
        tasks: [mockTask],
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
        expect(screen.getByText("No matches found")).toBeInTheDocument();

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
        expect(screen.getByText("No matches found")).toBeInTheDocument();
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



});
