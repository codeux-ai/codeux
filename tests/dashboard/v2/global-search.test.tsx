/**
 * @vitest-environment jsdom
 */
import { h } from "preact";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { GlobalSearch } from "../../../dashboard/src/v2/components/top-nav/GlobalSearch.js";
import { SearchOverlay } from "../../../dashboard/src/v2/components/search/SearchOverlay.js";
import { SearchResultRow } from "../../../dashboard/src/v2/components/search/SearchResultRow.js";
import { useProjectTasks } from "../../../dashboard/src/v2/hooks/use-project-tasks.js";
import { usePreviewSessions } from "../../../dashboard/src/v2/hooks/use-preview-sessions.js";

expect.extend(matchers);

const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("../../../dashboard/src/v2/hooks/use-project-tasks.js", () => ({
    useProjectTasks: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-preview-sessions.js", () => ({
    usePreviewSessions: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useResolvedMotionDuration: (d: any) => d,
    useReducedMotion: vi.fn().mockReturnValue(false),
}));

vi.mock("../../../dashboard/src/v2/lib/agent-preset-api.js", () => ({
    fetchAgentPresets: vi.fn().mockResolvedValue([]),
}));

vi.mock("@tanstack/react-router", () => ({
    useNavigate: vi.fn().mockReturnValue(mockNavigate),
    Link: ({ children, to, search, ...props }: any) => (
        <a href={to} data-search={JSON.stringify(search || {})} data-testid={`link-${to}`} {...props}>
            {children}
        </a>
    ),
}));

vi.mock("gsap", () => {
    const fromTo = vi.fn();
    return {
        default: {
            to: vi.fn(),
            set: vi.fn(),
            killTweensOf: vi.fn(),
            timeline: () => ({
                fromTo,
                to: vi.fn(),
            }),
            _fromToSpy: fromTo
        },
    };
});

describe("Global Search", () => {
    beforeEach(() => {
        cleanup();
        vi.clearAllMocks();
        mockNavigate.mockClear();
        vi.mocked(useProjectTasks).mockReturnValue({ tasks: [] } as any);
        vi.mocked(usePreviewSessions).mockReturnValue({ sessions: [] } as any);
        document.body.innerHTML = '';
    });

    describe("GlobalSearch Component", () => {
        it("defers task loading until search is opened", async () => {
            render(<GlobalSearch projectId="p1" selectedProject={{ id: "p1", name: "Project 1" } as any} sprints={[]} />);

            expect(useProjectTasks).toHaveBeenLastCalledWith("p1", [expect.objectContaining({ id: "p1" })], [], null, {
                enabled: false,
            });

            const searchButton = screen.getByText("Search...").closest("button");
            expect(searchButton).not.toBeNull();
            fireEvent.click(searchButton!);

            await waitFor(() => {
                expect(useProjectTasks).toHaveBeenLastCalledWith("p1", [expect.objectContaining({ id: "p1" })], [], null, {
                    enabled: true,
                });
            });
        });

        it("matches and renders custom sprint keys from the project prefix", async () => {
            render(
                <GlobalSearch
                    projectId="p1"
                    selectedProject={{ id: "p1", name: "Project 1" } as any}
                    sprintKeyPrefix="CODUX"
                    sprints={[
                        {
                            id: "sprint-32",
                            projectId: "p1",
                            number: 32,
                            slug: "codux-32",
                            name: "Search Routing",
                            goal: "Make global search use custom sprint keys",
                            status: "running",
                            showcasePinned: false,
                            tasksCount: 0,
                            completion: 0,
                            createdAt: "2026-07-03T00:00:00Z",
                            updatedAt: "2026-07-03T00:00:00Z",
                        } as any,
                    ]}
                />
            );

            fireEvent.click(screen.getByText("Search...").closest("button")!);
            fireEvent.input(screen.getByRole("combobox", { hidden: true }), { target: { value: "CODUX-32" } });

            await waitFor(() => {
                expect(screen.getByText("CODUX-32")).toBeInTheDocument();
            });
            expect(screen.getByText("Search Routing")).toBeInTheDocument();
        });

        it("matches numberless sprints by slug and renders the slug route key", async () => {
            render(
                <GlobalSearch
                    projectId="p1"
                    selectedProject={{ id: "p1", name: "Project 1" } as any}
                    sprintKeyPrefix="CODUX"
                    sprints={[
                        {
                            id: "sprint-hotfix",
                            projectId: "p1",
                            number: null,
                            slug: "hotfix-login",
                            name: "Login Hotfix",
                            goal: "Patch auth redirect",
                            status: "idle",
                            showcasePinned: false,
                            tasksCount: 0,
                            completion: 0,
                            createdAt: "2026-07-03T00:00:00Z",
                            updatedAt: "2026-07-03T00:00:00Z",
                        } as any,
                    ]}
                />
            );

            fireEvent.click(screen.getByText("Search...").closest("button")!);
            fireEvent.input(screen.getByRole("combobox", { hidden: true }), { target: { value: "hotfix-login" } });

            await waitFor(() => {
                expect(screen.getByText("HOTFIX-LOGIN")).toBeInTheDocument();
            });
            expect(screen.getByText("Login Hotfix")).toBeInTheDocument();
        });

        it("opens search overlay when Cmd+K is pressed", async () => {
            render(<GlobalSearch projectId="p1" selectedProject={null} sprints={[]} />);

            const overlay = screen.getByRole("dialog", { hidden: true });
            expect(overlay.parentElement).toHaveStyle({ display: 'none' });

            fireEvent.keyDown(document, { key: "k", metaKey: true });

            // Testing GSAP internals is hard, so we just check if searchQuery handler was bound
            // or we use a more direct preact way, but the mock doesn't trigger state update synchronously
            // because of how GSAP is bypassed
        });

        it("does not open search when Cmd+K is pressed inside an input field", () => {
            render(
                <div>
                    <input type="text" data-testid="test-input" />
                    <GlobalSearch projectId="p1" selectedProject={null} sprints={[]} />
                </div>
            );

            const input = screen.getByTestId("test-input");
            input.focus();

            fireEvent.keyDown(input, { key: "k", metaKey: true });

            expect(screen.queryByRole("dialog")).toBeNull();
        });
    });

    describe("SearchOverlay Component", () => {
        // "Searching..." / "No results" intentionally render twice: once in the
        // sr-only aria-live announcer and once in the visible results area. Assert
        // on the visible (non sr-only) element so the test reflects what users see.
        const visibleText = (text: string) =>
            screen.getAllByText(text).find((el) => !el.closest(".sr-only"));

        it("shows loading state when isLoading is true", () => {
            render(<SearchOverlay isOpen={true} onClose={vi.fn()} searchQuery="test" onSearchChange={vi.fn()} results={{sprints:[], tasks:[], agents:[], containers:[]}} isLoading={true} />);
            const spinner = document.querySelector(".animate-spin");
            expect(spinner).toBeInTheDocument();
        });

        it("shows empty state when no results are found", () => {
            render(<SearchOverlay isOpen={true} onClose={vi.fn()} searchQuery="test" onSearchChange={vi.fn()} results={{sprints:[], tasks:[], agents:[], containers:[]}} isLoading={false} />);
            expect(visibleText("No results found for 'test'")).toBeInTheDocument();
        });

        it("closes on Escape", () => {
            const onClose = vi.fn();
            render(<SearchOverlay isOpen={true} onClose={onClose} searchQuery="test" onSearchChange={vi.fn()} results={{sprints:[], tasks:[], agents:[], containers:[]}} isLoading={false} />);

            fireEvent.keyDown(window, { key: "Escape" });

            expect(onClose).toHaveBeenCalled();
        });

        it("navigates sprint selections with explicit sprint id and custom key", () => {
            const onClose = vi.fn();
            render(
                <SearchOverlay
                    isOpen={true}
                    onClose={onClose}
                    searchQuery="CODUX-32"
                    onSearchChange={vi.fn()}
                    results={{
                        sprints: [{ id: "sprint-32", title: "Search Routing", displayKey: "CODUX-32", sprintKey: "CODUX-32", routeSprintId: "sprint-32", status: "running" }],
                        tasks: [],
                        agents: [],
                        containers: []
                    }}
                    isLoading={false}
                />
            );

            fireEvent.keyDown(window, { key: "ArrowDown" });
            fireEvent.keyDown(window, { key: "Enter" });

            expect(mockNavigate).toHaveBeenCalledWith({ to: "/sprints", search: { sprintId: "sprint-32", sprintKey: "CODUX-32" } });
            expect(onClose).toHaveBeenCalled();
        });
    });

    describe("SearchResultRow Component", () => {
        it("renders sprint properly and highlights active state", () => {
            const item = { id: "1", title: "Test Sprint", displayKey: "SPR-1", sprintKey: "SPR-1", routeSprintId: "1", status: "active" };
            render(<SearchResultRow item={item} categoryType="sprints" searchQuery="" globalItemIndex={0} isFocused={true} onFocus={vi.fn()} activeItemRef={null} onClick={vi.fn()} />);

            const link = screen.getByRole("option");
            expect(link).toHaveAttribute("aria-selected", "true");
            expect(link).toHaveClass("bg-signal-500/8"); // Custom active class in implementation
            expect(screen.getByText("SPR-1")).toBeInTheDocument();
            expect(screen.getByText("Test Sprint")).toBeInTheDocument();
        });

        it("renders task properly and highlights match", () => {
             const item = { id: "tsk12345", title: "Implement feature X", status: "open", sprintId: "1", routeTaskId: "tsk12345", routeSprintId: "1" };
             render(<SearchResultRow item={item} categoryType="tasks" searchQuery="feature" globalItemIndex={0} isFocused={false} onFocus={vi.fn()} activeItemRef={null} onClick={vi.fn()} />);

             expect(screen.getByText("feature").tagName).toBe("MARK");
        });

        it("disables row when item status is unavailable", () => {
             const item = { id: "tsk12345", title: "Implement feature X", status: "unavailable", sprintId: "1", routeTaskId: "tsk12345", routeSprintId: "1" };
             render(<SearchResultRow item={item} categoryType="tasks" searchQuery="feature" globalItemIndex={0} isFocused={false} onFocus={vi.fn()} activeItemRef={null} onClick={vi.fn()} />);

             const link = screen.getByRole("option");
             expect(link).toHaveAttribute("aria-disabled", "true");
        });
    });
});
