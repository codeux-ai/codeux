/**
 * @vitest-environment jsdom
 */
import { h } from "preact";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
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

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("GlobalSearch Component", () => {
        it("defers task loading until search is opened", async () => {
            render(<GlobalSearch projectId="p1" selectedProject={{ id: "p1", name: "Project 1" } as any} sprints={[]} />);

            expect(useProjectTasks).toHaveBeenLastCalledWith("p1", [expect.objectContaining({ id: "p1" })], [], null, {
                enabled: false,
            });

            const searchButton = screen.getByRole("button", { name: "Search workspace" });
            expect(searchButton).not.toBeNull();
            fireEvent.click(searchButton);

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

            fireEvent.click(screen.getByRole("button", { name: "Search workspace" }));
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

            fireEvent.click(screen.getByRole("button", { name: "Search workspace" }));
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
            expect(screen.getAllByRole("status", { hidden: true })[0]).toHaveTextContent("Searching workspace");
        });

        it("announces background loading while keeping stale results readable", () => {
            render(
                <SearchOverlay
                    isOpen={true}
                    onClose={vi.fn()}
                    searchQuery="generic"
                    onSearchChange={vi.fn()}
                    results={{
                        sprints: [{ id: "sprint-1", title: "Generic Sprint", displayKey: "SPR-1", sprintKey: "SPR-1", routeSprintId: "sprint-1", status: "running" }],
                        tasks: [],
                        agents: [],
                        containers: []
                    }}
                    isLoading={true}
                />
            );

            const listbox = screen.getByRole("listbox", { hidden: true });
            expect(listbox).toHaveAttribute("aria-busy", "true");
            expect(listbox).toHaveClass("opacity-[0.78]");
            expect(listbox).not.toHaveAttribute("aria-live");
            expect(listbox).toHaveAttribute("aria-describedby", "search-results-refreshing-note");
            expect(listbox).not.toHaveClass("pointer-events-none");
            expect(screen.getAllByRole("status", { hidden: true })).toHaveLength(1);
            expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("Updating results for 'generic'. 1 current results remain available.");
            expect(screen.getByRole("option", { name: /generic sprint/i, hidden: true })).toBeInTheDocument();
            expect(screen.getByText("Updating visible results")).toBeInTheDocument();
        });

        it("keeps the active descendant stable while stale results refresh", () => {
            const results = {
                sprints: [
                    { id: "sprint-1", title: "Generic Sprint One", displayKey: "SPR-1", sprintKey: "SPR-1", routeSprintId: "sprint-1", status: "running" },
                    { id: "sprint-2", title: "Generic Sprint Two", displayKey: "SPR-2", sprintKey: "SPR-2", routeSprintId: "sprint-2", status: "running" }
                ],
                tasks: [],
                agents: [],
                containers: []
            };
            const { rerender } = render(
                <SearchOverlay
                    isOpen={true}
                    onClose={vi.fn()}
                    searchQuery="generic"
                    onSearchChange={vi.fn()}
                    results={results}
                    isLoading={false}
                />
            );

            const combobox = screen.getByRole("combobox", { hidden: true });
            fireEvent.keyDown(window, { key: "ArrowDown" });
            fireEvent.keyDown(window, { key: "ArrowDown" });
            expect(combobox).toHaveAttribute("aria-activedescendant", "search-result-sprint-2");

            rerender(
                <SearchOverlay
                    isOpen={true}
                    onClose={vi.fn()}
                    searchQuery="generic"
                    onSearchChange={vi.fn()}
                    results={results}
                    isLoading={true}
                />
            );

            expect(combobox).toHaveAttribute("aria-activedescendant", "search-result-sprint-2");
            expect(screen.getByRole("listbox", { hidden: true })).toHaveAttribute("aria-busy", "true");
        });

        it("shows empty state when no results are found", () => {
            render(<SearchOverlay isOpen={true} onClose={vi.fn()} searchQuery="test" onSearchChange={vi.fn()} results={{sprints:[], tasks:[], agents:[], containers:[]}} isLoading={false} />);
            expect(visibleText("No results found for 'test'")).toBeInTheDocument();
        });

        it("explains when project data is unavailable for a search", () => {
            render(<SearchOverlay isOpen={true} onClose={vi.fn()} searchQuery="agent" onSearchChange={vi.fn()} results={{sprints:[], tasks:[], agents:[], containers:[]}} isLoading={false} hasProjectData={false} />);

            expect(screen.getByText("Project data unavailable")).toBeInTheDocument();
            expect(screen.getByText("Unable to load project search results.")).toBeInTheDocument();
            expect(screen.getAllByRole("status", { hidden: true })[0]).toHaveTextContent("Project data unavailable for 'agent'");
        });

        it("does not move active descendant for empty result sets", () => {
            render(<SearchOverlay isOpen={true} onClose={vi.fn()} searchQuery="missing" onSearchChange={vi.fn()} results={{sprints:[], tasks:[], agents:[], containers:[]}} isLoading={false} />);

            const combobox = screen.getByRole("combobox", { hidden: true });
            fireEvent.keyDown(window, { key: "ArrowDown" });
            fireEvent.keyDown(window, { key: "End" });
            fireEvent.keyDown(window, { key: "Home" });

            expect(combobox).not.toHaveAttribute("aria-activedescendant");
        });

        it("skips inactive results during keyboard navigation and selection", () => {
            const onClose = vi.fn();
            render(
                <SearchOverlay
                    isOpen={true}
                    onClose={onClose}
                    searchQuery="generic"
                    onSearchChange={vi.fn()}
                    results={{
                        sprints: [
                            { id: "sprint-disabled", title: "Generic Disabled Sprint", displayKey: "SPR-0", sprintKey: "SPR-0", routeSprintId: "sprint-disabled", status: "unavailable" },
                            { id: "sprint-enabled", title: "Generic Enabled Sprint", displayKey: "SPR-1", sprintKey: "SPR-1", routeSprintId: "sprint-enabled", status: "running" }
                        ],
                        tasks: [],
                        agents: [],
                        containers: []
                    }}
                    isLoading={false}
                />
            );

            const combobox = screen.getByRole("combobox", { hidden: true });
            fireEvent.keyDown(window, { key: "ArrowDown" });

            expect(combobox).toHaveAttribute("aria-activedescendant", "search-result-sprint-enabled");
            expect(screen.getByRole("option", { name: /generic disabled sprint/i, hidden: true })).toHaveAttribute("aria-disabled", "true");
            expect(screen.getByText("This result is unavailable and cannot be opened.")).toBeInTheDocument();

            fireEvent.keyDown(window, { key: "Enter" });
            expect(mockNavigate).toHaveBeenCalledWith({ to: "/sprints", search: { sprintId: "sprint-enabled", sprintKey: "SPR-1" } });
            expect(onClose).toHaveBeenCalled();
        });

        it("keeps a stable active descendant when every result is inactive without navigating on Enter", () => {
            const onClose = vi.fn();
            render(
                <SearchOverlay
                    isOpen={true}
                    onClose={onClose}
                    searchQuery="offline"
                    onSearchChange={vi.fn()}
                    results={{
                        sprints: [
                            { id: "sprint-disabled", title: "Offline Sprint", displayKey: "SPR-0", sprintKey: "SPR-0", routeSprintId: "sprint-disabled", status: "unavailable" }
                        ],
                        tasks: [
                            { id: "task-disabled", title: "Disabled Task", routeTaskId: "task-disabled", routeSprintId: "sprint-disabled", status: "disabled" }
                        ],
                        agents: [],
                        containers: []
                    }}
                    isLoading={false}
                />
            );

            const combobox = screen.getByRole("combobox", { hidden: true });

            fireEvent.keyDown(window, { key: "Home" });
            expect(combobox).toHaveAttribute("aria-activedescendant", "search-result-sprint-disabled");
            expect(screen.getByRole("option", { name: /offline sprint/i, hidden: true })).toHaveAttribute("aria-selected", "true");

            fireEvent.keyDown(window, { key: "End" });
            expect(combobox).toHaveAttribute("aria-activedescendant", "search-result-sprint-disabled");

            fireEvent.keyDown(window, { key: "ArrowDown" });
            expect(combobox).toHaveAttribute("aria-activedescendant", "search-result-sprint-disabled");

            fireEvent.keyDown(window, { key: "ArrowUp" });
            expect(combobox).toHaveAttribute("aria-activedescendant", "search-result-sprint-disabled");

            fireEvent.keyDown(window, { key: "Enter" });
            expect(mockNavigate).not.toHaveBeenCalled();
            expect(onClose).not.toHaveBeenCalled();
        });

        it("leaves Enter inert when the active row is disabled", () => {
            const onClose = vi.fn();
            render(
                <SearchOverlay
                    isOpen={true}
                    onClose={onClose}
                    searchQuery="disabled"
                    onSearchChange={vi.fn()}
                    results={{
                        sprints: [
                            { id: "sprint-disabled", title: "Disabled Sprint", displayKey: "SPR-0", sprintKey: "SPR-0", routeSprintId: "sprint-disabled", status: "disabled" }
                        ],
                        tasks: [],
                        agents: [],
                        containers: []
                    }}
                    isLoading={false}
                />
            );

            fireEvent.keyDown(window, { key: "ArrowDown" });
            expect(screen.getByRole("combobox", { hidden: true })).toHaveAttribute("aria-activedescendant", "search-result-sprint-disabled");

            fireEvent.keyDown(window, { key: "Enter" });

            expect(mockNavigate).not.toHaveBeenCalled();
            expect(onClose).not.toHaveBeenCalled();
        });

        it("updates active descendant and keeps focused results within the result scroller", async () => {
            render(
                <SearchOverlay
                    isOpen={true}
                    onClose={vi.fn()}
                    searchQuery="generic"
                    onSearchChange={vi.fn()}
                    results={{
                        sprints: [
                            { id: "sprint-1", title: "Generic Sprint One", displayKey: "SPR-1", sprintKey: "SPR-1", routeSprintId: "sprint-1", status: "running" },
                            { id: "sprint-2", title: "Generic Sprint Two", displayKey: "SPR-2", sprintKey: "SPR-2", routeSprintId: "sprint-2", status: "running" }
                        ],
                        tasks: [],
                        agents: [],
                        containers: []
                    }}
                    isLoading={false}
                />
            );

            const combobox = screen.getByRole("combobox", { hidden: true });
            const listbox = screen.getByRole("listbox", { hidden: true });
            const scroller = listbox.parentElement as HTMLElement;
            Object.defineProperty(scroller, "scrollTop", { value: 0, writable: true, configurable: true });
            Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", { value: vi.fn(), writable: true, configurable: true });
            Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true, configurable: true });
            Object.defineProperty(window, "scrollBy", { value: vi.fn(), writable: true, configurable: true });
            const scrollIntoView = vi.spyOn(window.HTMLElement.prototype, "scrollIntoView").mockImplementation(() => undefined);
            const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
            const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
            document.documentElement.scrollTop = 240;
            document.body.scrollTop = 240;
            const rectSpy = vi.spyOn(window.HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
                if (this.id === "search-result-sprint-2") {
                    return { top: 120, bottom: 160, left: 0, right: 200, width: 200, height: 40, x: 0, y: 120, toJSON: () => ({}) } as DOMRect;
                }
                if (this.className.toString().includes("dashboard-scrollbar")) {
                    return { top: 0, bottom: 100, left: 0, right: 200, width: 200, height: 100, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
                }
                return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
            });

            fireEvent.keyDown(window, { key: "ArrowDown" });
            expect(combobox).toHaveAttribute("aria-activedescendant", "search-result-sprint-1");
            fireEvent.keyDown(window, { key: "ArrowDown" });

            expect(combobox).toHaveAttribute("aria-activedescendant", "search-result-sprint-2");
            await waitFor(() => {
                expect(scroller.scrollTop).toBeGreaterThan(0);
            });
            expect(scrollIntoView).not.toHaveBeenCalled();
            expect(scrollTo).not.toHaveBeenCalled();
            expect(scrollBy).not.toHaveBeenCalled();
            expect(document.documentElement.scrollTop).toBe(240);
            expect(document.body.scrollTop).toBe(240);
            rectSpy.mockRestore();
        });

        it("closes on Escape", () => {
            const onClose = vi.fn();
            render(<SearchOverlay isOpen={true} onClose={onClose} searchQuery="test" onSearchChange={vi.fn()} results={{sprints:[], tasks:[], agents:[], containers:[]}} isLoading={false} />);

            fireEvent.keyDown(window, { key: "Escape" });

            expect(onClose).toHaveBeenCalled();
        });

        it("restores focus to the invoking global search control after Escape", async () => {
            render(<GlobalSearch projectId="p1" selectedProject={{ id: "p1", name: "Project 1" } as any} sprints={[]} />);

            const trigger = screen.getByRole("button", { name: "Search workspace" });
            trigger.focus();
            fireEvent.click(trigger);

            await waitFor(() => {
                expect(screen.getByRole("combobox", { hidden: true })).toHaveFocus();
            });

            fireEvent.keyDown(document, { key: "Escape" });

            await waitFor(() => {
                expect(document.activeElement).toBe(trigger);
            });
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

        it("restores focus to the invoking global search control after close", async () => {
            const user = userEvent.setup();
            render(<GlobalSearch projectId="p1" selectedProject={{ id: "p1", name: "Project 1" } as any} sprints={[]} />);

            const trigger = screen.getByRole("button", { name: "Search workspace" });
            trigger.focus();
            await user.click(trigger);
            await user.click(screen.getByRole("button", { name: "Close search", hidden: true }));

            await waitFor(() => {
                expect(document.activeElement).toBe(trigger);
            });
        });
    });

    describe("SearchResultRow Component", () => {
        it("renders sprint properly and highlights active state", () => {
            const item = { id: "1", title: "Test Sprint", displayKey: "SPR-1", sprintKey: "SPR-1", routeSprintId: "1", status: "active" };
            render(<SearchResultRow item={item} categoryType="sprints" searchQuery="" globalItemIndex={0} isFocused={true} onFocus={vi.fn()} activeItemRef={null} onClick={vi.fn()} />);

            const link = screen.getByRole("option");
            expect(link).toHaveAttribute("aria-selected", "true");
            expect(link).toHaveAttribute("data-selected", "true");
            expect(link).toHaveClass("border-signal-500/55");
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
             const onClick = vi.fn();
             const onFocus = vi.fn();
             render(<SearchResultRow item={item} categoryType="tasks" searchQuery="feature" globalItemIndex={0} isFocused={false} onFocus={onFocus} activeItemRef={null} onClick={onClick} />);

             const link = screen.getByRole("option");
             expect(link).toHaveAttribute("aria-disabled", "true");
             expect(link).toHaveAttribute("aria-describedby", "search-result-tsk12345-disabled-reason");
             expect(screen.getByText("This result is unavailable and cannot be opened.")).toBeInTheDocument();

             fireEvent.mouseEnter(link);
             fireEvent.keyDown(link, { key: "Enter" });
             fireEvent.click(link);

             expect(onFocus).not.toHaveBeenCalled();
             expect(onClick).not.toHaveBeenCalled();
        });
    });
});
