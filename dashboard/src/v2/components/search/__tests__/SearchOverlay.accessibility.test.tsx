// @vitest-environment jsdom
import { h } from "preact";
import { useState } from "preact/hooks";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect, describe, it, vi, beforeEach, afterEach } from "vitest";

expect.extend(matchers);

const { gsapFromTo, gsapTo, gsapSet, gsapKillTweensOf } = vi.hoisted(() => ({
    gsapFromTo: vi.fn(),
    gsapTo: vi.fn(),
    gsapSet: vi.fn(),
    gsapKillTweensOf: vi.fn(),
}));

// Mock GSAP to prevent animation issues in test environment
vi.mock("gsap", () => ({
    default: {
        killTweensOf: gsapKillTweensOf,
        set: gsapSet,
        timeline: () => ({
            fromTo: gsapFromTo,
            to: gsapTo,
        }),
    },
}));

// Mock use-reduced-motion to return true so tests don't wait for animations
vi.mock("../../../hooks/use-reduced-motion.js", () => ({
    useReducedMotion: () => true,
    useResolvedMotionDuration: (duration: number | string) => typeof duration === "number" ? 0 : "0ms",
}));

// Provide mocked components
vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => vi.fn(),
    Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

import { SearchOverlay } from "../SearchOverlay";

describe("SearchOverlay Accessibility", () => {
    const mockResults = {
        sprints: [{ id: "spr-1", title: "Sprint 1", displayKey: "SPR-1", sprintKey: "SPR-1", routeSprintId: "spr-1", status: "active" }],
        tasks: [{ id: "tsk-1", title: "Task 1", sprintId: "spr-1", routeTaskId: "tsk-1", routeSprintId: "spr-1" }],
        agents: [],
        containers: [],
    };

    const mockOnClose = vi.fn();
    const mockOnSearchChange = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = "";
        window.HTMLElement.prototype.scrollIntoView = vi.fn();
        window.Element.prototype.scrollIntoView = vi.fn();
    });

    afterEach(() => {
        cleanup();
    });

    const classTokens = (container: Element): string[] =>
        Array.from(container.querySelectorAll("[class]")).flatMap((element) =>
            (element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)
        );

    it("has accessible search combobox", () => {
        render(
            <SearchOverlay
                isOpen={true}
                onClose={mockOnClose}
                searchQuery="test"
                onSearchChange={mockOnSearchChange}
                results={mockResults}
            />
        );

        const combobox = screen.getAllByRole("combobox", { name: "Global search", hidden: true })[0];
        expect(combobox).toBeInTheDocument();
        expect(combobox).toHaveAttribute("aria-expanded", "true");
        expect(combobox).toHaveAttribute("aria-controls", "search-results-list");
    });

    it("announces status changes via aria-live region", () => {
        const { rerender } = render(
            <SearchOverlay
                isOpen={true}
                onClose={mockOnClose}
                searchQuery=""
                onSearchChange={mockOnSearchChange}
                results={{ sprints: [], tasks: [], agents: [], containers: [] }}
            />
        );

        const statusRegions = screen.getAllByRole("status", { hidden: true });
        const statusRegion = statusRegions.length > 1 ? statusRegions[1] : statusRegions[0];
        // Hidden element requires relaxed check
        expect(statusRegion).toBeInTheDocument();
        expect(statusRegion).toHaveAttribute("aria-live", "polite");
        // When query is empty, status is empty
        expect(statusRegion.textContent).toBe("");

        // Rerender with loading
        rerender(
            <SearchOverlay
                isOpen={true}
                onClose={mockOnClose}
                searchQuery="t"
                isLoading={true}
                onSearchChange={mockOnSearchChange}
                results={{ sprints: [], tasks: [], agents: [], containers: [] }}
            />
        );
        expect(statusRegion.textContent).toBe("Searching workspace");

        // Rerender with results
        rerender(
            <SearchOverlay
                isOpen={true}
                onClose={mockOnClose}
                searchQuery="t"
                isLoading={false}
                onSearchChange={mockOnSearchChange}
                results={mockResults}
            />
        );
        expect(statusRegion.textContent).toBe("2 results available");

        // Rerender with no results
        rerender(
            <SearchOverlay
                isOpen={true}
                onClose={mockOnClose}
                searchQuery="test none"
                isLoading={false}
                onSearchChange={mockOnSearchChange}
                results={{ sprints: [], tasks: [], agents: [], containers: [] }}
            />
        );
        expect(statusRegion.textContent).toBe("No results found for 'test none'");
    });

    it("navigates listbox options with Arrow keys", async () => {
        const user = userEvent.setup();
        render(
            <SearchOverlay
                isOpen={true}
                onClose={mockOnClose}
                searchQuery="t"
                onSearchChange={mockOnSearchChange}
                results={mockResults}
            />
        );

        const combobox = screen.getAllByRole("combobox", { name: "Global search", hidden: true })[0];
        combobox.focus();

        // Initial state
        expect(combobox).not.toHaveAttribute("aria-activedescendant");

        // Press down
        await user.keyboard("{ArrowDown}");
        expect(combobox).toHaveAttribute("aria-activedescendant", "search-result-spr-1");

        // Press down again
        await user.keyboard("{ArrowDown}");
        expect(combobox).toHaveAttribute("aria-activedescendant", "search-result-tsk-1");

        // Press up
        await user.keyboard("{ArrowUp}");
        expect(combobox).toHaveAttribute("aria-activedescendant", "search-result-spr-1");
    });

    it("does not expose an active descendant when no results are available", async () => {
        const user = userEvent.setup();
        render(
            <SearchOverlay
                isOpen={true}
                onClose={mockOnClose}
                searchQuery="missing"
                onSearchChange={mockOnSearchChange}
                results={{ sprints: [], tasks: [], agents: [], containers: [] }}
            />
        );

        const combobox = screen.getAllByRole("combobox", { name: "Global search", hidden: true })[0];
        combobox.focus();

        await user.keyboard("{ArrowDown}{End}{Home}{ArrowUp}");

        expect(combobox).not.toHaveAttribute("aria-activedescendant");
    });

    it("marks stale result lists busy while keeping options available", () => {
        render(
            <SearchOverlay
                isOpen={true}
                onClose={mockOnClose}
                searchQuery="t"
                isLoading={true}
                onSearchChange={mockOnSearchChange}
                results={mockResults}
            />
        );

        expect(screen.getByRole("listbox", { hidden: true })).toHaveAttribute("aria-busy", "true");
        expect(screen.getAllByRole("option", { hidden: true })).toHaveLength(2);
        expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("Updating results for 't'. 2 current results remain available.");
        expect(screen.getByText("Updating visible results")).toBeInTheDocument();
    });

    it("uses the committed query for true empty states after refresh completes", () => {
        render(
            <SearchOverlay
                isOpen={true}
                onClose={mockOnClose}
                searchQuery="no-match"
                committedSearchQuery="no-match"
                onSearchChange={mockOnSearchChange}
                results={{ sprints: [], tasks: [], agents: [], containers: [] }}
                isLoading={false}
            />
        );

        expect(screen.getAllByRole("status", { hidden: true })[0]).toHaveTextContent("No results found for 'no-match'");
        expect(screen.getAllByText("No results found for 'no-match'").some((el) => !el.closest(".sr-only"))).toBe(true);
    });

    it("keeps active agent and container indicators static under reduced motion", () => {
        const { container } = render(
            <SearchOverlay
                isOpen={true}
                onClose={mockOnClose}
                searchQuery="runtime"
                onSearchChange={mockOnSearchChange}
                results={{
                    sprints: [],
                    tasks: [],
                    agents: [{ id: "agent-1", name: "Runtime Agent", routeAgentId: "agent-1", status: "running" }],
                    containers: [{ id: "container-1", name: "Runtime Preview", routeContainerId: "container-1", status: "running" }],
                }}
            />
        );

        expect(screen.getByRole("option", { name: /runtime agent, running/i, hidden: true })).toBeInTheDocument();
        expect(screen.getByRole("option", { name: /runtime preview, running/i, hidden: true })).toBeInTheDocument();
        expect(screen.getByText("running")).toBeInTheDocument();
        expect(screen.getByText("Running")).toBeInTheDocument();

        const tokens = classTokens(container);
        expect(tokens).toContain("bg-status-green");
        expect(tokens).toContain("motion-safe:animate-ping");
        expect(tokens).toContain("motion-safe:animate-pulse");
        expect(tokens).toContain("motion-reduce:animate-none");
        expect(tokens).not.toContain("animate-ping");
        expect(tokens).not.toContain("animate-pulse");
    });

    it("supports Home and End keyboard navigation", async () => {
        const user = userEvent.setup();
        render(
            <SearchOverlay
                isOpen={true}
                onClose={mockOnClose}
                searchQuery="t"
                onSearchChange={mockOnSearchChange}
                results={mockResults}
            />
        );

        const combobox = screen.getAllByRole("combobox", { name: "Global search", hidden: true })[0];
        combobox.focus();

        // ArrowDown sets focus to first element
        await user.keyboard("{ArrowDown}");
        expect(combobox).toHaveAttribute("aria-activedescendant", "search-result-spr-1");

        // End sets focus to last element
        await user.keyboard("{End}");
        expect(combobox).toHaveAttribute("aria-activedescendant", "search-result-tsk-1");

        // Home sets focus back to first element
        await user.keyboard("{Home}");
        expect(combobox).toHaveAttribute("aria-activedescendant", "search-result-spr-1");
    });

    it("closes on Escape and restores focus to the opener", async () => {
        const user = userEvent.setup();
        const opener = document.createElement("button");
        opener.textContent = "Open search";
        document.body.append(opener);
        opener.focus();

        const ControlledSearch = () => {
            const [isOpen, setIsOpen] = useState(true);
            return (
                <SearchOverlay
                    isOpen={isOpen}
                    onClose={() => {
                        mockOnClose();
                        setIsOpen(false);
                    }}
                    searchQuery="t"
                    onSearchChange={mockOnSearchChange}
                    results={mockResults}
                />
            );
        };

        render(<ControlledSearch />);

        const combobox = screen.getAllByRole("combobox", { name: "Global search", hidden: true })[0];
        combobox.focus();
        await user.keyboard("{Escape}");
        expect(mockOnClose).toHaveBeenCalled();
        await waitFor(() => expect(opener).toHaveFocus());
    });

    it("selects focused option on Enter", async () => {
        const user = userEvent.setup();
        render(
            <SearchOverlay
                isOpen={true}
                onClose={mockOnClose}
                searchQuery="t"
                onSearchChange={mockOnSearchChange}
                results={mockResults}
            />
        );

        const combobox = screen.getAllByRole("combobox", { name: "Global search", hidden: true })[0];
        combobox.focus();

        // Navigate to first option
        await user.keyboard("{ArrowDown}");
        // Press Enter
        await user.keyboard("{Enter}");

        // mockOnClose is called on select in handleSelect logic? Yes, but handleSelect does navigate + onClose
        expect(mockOnClose).toHaveBeenCalled();
    });

    it("keeps unavailable results visible but skips keyboard and mouse activation", async () => {
        const user = userEvent.setup();
        const resultsWithUnavailable = {
            sprints: [
                { id: "spr-offline", title: "Offline Sprint", displayKey: "SPR-OFF", sprintKey: "SPR-OFF", routeSprintId: "spr-offline", status: "unavailable" },
                { id: "spr-ready", title: "Ready Sprint", displayKey: "SPR-RDY", sprintKey: "SPR-RDY", routeSprintId: "spr-ready", status: "active" },
            ],
            tasks: [],
            agents: [],
            containers: [
                { id: "preview-disabled", name: "Disabled Preview", routeContainerId: "preview-disabled", status: "disabled" },
            ],
        };

        render(
            <SearchOverlay
                isOpen={true}
                onClose={mockOnClose}
                searchQuery="sprint"
                onSearchChange={mockOnSearchChange}
                results={resultsWithUnavailable}
            />
        );

        const combobox = screen.getAllByRole("combobox", { name: "Global search", hidden: true })[0];
        combobox.focus();

        const unavailable = screen.getByRole("option", { name: /offline sprint/i, hidden: true });
        const disabled = screen.getByRole("option", { name: /disabled preview/i, hidden: true });
        expect(unavailable).toHaveAttribute("aria-disabled", "true");
        expect(unavailable).toHaveAttribute("aria-describedby", "search-result-spr-offline-disabled-reason");
        expect(screen.getByText("Unavailable")).toBeInTheDocument();
        expect(disabled).toHaveAttribute("aria-disabled", "true");
        expect(screen.getByText("Disabled")).toBeInTheDocument();

        await user.keyboard("{ArrowDown}");
        expect(combobox).toHaveAttribute("aria-activedescendant", "search-result-spr-ready");
        await user.keyboard("{Enter}");
        expect(mockOnClose).toHaveBeenCalledTimes(1);

        mockOnClose.mockClear();
        fireEvent.pointerDown(unavailable);
        fireEvent.click(unavailable);
        fireEvent.click(disabled);
        expect(mockOnClose).not.toHaveBeenCalled();
    });

    it("does not activate keyboard selection when every result is unavailable", async () => {
        const user = userEvent.setup();
        render(
            <SearchOverlay
                isOpen={true}
                onClose={mockOnClose}
                searchQuery="offline"
                onSearchChange={mockOnSearchChange}
                results={{
                    sprints: [{ id: "spr-offline", title: "Offline Sprint", displayKey: "SPR-OFF", sprintKey: "SPR-OFF", routeSprintId: "spr-offline", status: "unavailable" }],
                    tasks: [],
                    agents: [],
                    containers: [],
                }}
            />
        );

        const combobox = screen.getAllByRole("combobox", { name: "Global search", hidden: true })[0];
        combobox.focus();
        await user.keyboard("{ArrowDown}{Enter}");

        expect(combobox).toHaveAttribute("aria-activedescendant", "search-result-spr-offline");
        expect(mockOnClose).not.toHaveBeenCalled();
    });

    it("keeps active row scrolling inside the results container", async () => {
        const user = userEvent.setup();
        render(
            <SearchOverlay
                isOpen={true}
                onClose={mockOnClose}
                searchQuery="t"
                onSearchChange={mockOnSearchChange}
                results={mockResults}
            />
        );

        const combobox = screen.getAllByRole("combobox", { name: "Global search", hidden: true })[0];
        const resultsRegion = screen.getByRole("listbox", { hidden: true }).parentElement as HTMLElement;
        const secondOption = screen.getByRole("option", { name: /task 1/i, hidden: true });
        resultsRegion.scrollTop = 0;
        resultsRegion.getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) });
        secondOption.getBoundingClientRect = () => ({ top: 120, bottom: 160, left: 0, right: 100, width: 100, height: 40, x: 0, y: 120, toJSON: () => ({}) });

        combobox.focus();
        await user.keyboard("{End}");

        expect(resultsRegion.scrollTop).toBe(68);
        expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    });

    it("uses reduced-motion interaction token values for overlay and result transitions", () => {
        render(
            <SearchOverlay
                isOpen={true}
                onClose={mockOnClose}
                searchQuery="t"
                onSearchChange={mockOnSearchChange}
                results={mockResults}
            />
        );

        const listbox = screen.getByRole("listbox", { hidden: true });
        const firstOption = screen.getAllByRole("option", { hidden: true })[0];
        const closeButton = screen.getByRole("button", { name: "Close search", hidden: true });

        expect(listbox).toHaveStyle({ transitionDuration: "0ms" });
        expect(firstOption).toHaveStyle({ transitionDuration: "0ms" });
        expect(firstOption).toHaveClass("border-black/[0.06]");
        expect(closeButton).toHaveStyle({ transitionDuration: "0ms" });
        expect(gsapFromTo).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ duration: 0, ease: expect.any(String) }));
    });

    it("renders in unanchored/fallback mobile mode gracefully", () => {
        render(
            <SearchOverlay
                isOpen={true}
                onClose={mockOnClose}
                searchQuery="t"
                onSearchChange={mockOnSearchChange}
                results={mockResults}
            />
        );

        const dialog = screen.getByRole("dialog", { hidden: true });
        expect(dialog).toHaveClass("max-w-[calc(100vw-1.5rem)]");
        expect(dialog).toHaveClass("max-h-[calc(100dvh-1.5rem)]");
    });
});
