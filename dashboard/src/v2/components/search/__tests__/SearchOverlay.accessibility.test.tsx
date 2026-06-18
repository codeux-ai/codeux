// @vitest-environment jsdom
import { h } from "preact";
import { render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect, describe, it, vi, beforeEach } from "vitest";

expect.extend(matchers);

// Mock GSAP to prevent animation issues in test environment
vi.mock("gsap", () => ({
    default: {
        killTweensOf: vi.fn(),
        set: vi.fn(),
        timeline: () => ({
            fromTo: vi.fn(),
            to: vi.fn(),
        }),
    },
}));

// Mock use-reduced-motion to return true so tests don't wait for animations
vi.mock("../../hooks/use-reduced-motion.js", () => ({
    useReducedMotion: () => true,
}));

// Mock use-focus-trap to prevent focus interference during jsdom testing
vi.mock("../../hooks/use-focus-trap.js", () => ({
    useFocusTrap: () => ({ current: document.createElement("div") }),
}));

// Provide mocked components
vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => vi.fn(),
    Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

import { SearchOverlay } from "../SearchOverlay";

describe("SearchOverlay Accessibility", () => {
    const mockResults = {
        sprints: [{ id: "spr-1", title: "SPR-1: Sprint 1", status: "active" }],
        tasks: [{ id: "tsk-1", title: "Task 1", sprintId: "spr-1" }],
        agents: [],
        containers: [],
    };

    const mockOnClose = vi.fn();
    const mockOnSearchChange = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        window.HTMLElement.prototype.scrollIntoView = vi.fn();
    });

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
        expect(statusRegion.textContent).toBe("Searching...");

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

    it("closes on Escape", async () => {
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
        await user.keyboard("{Escape}");
        expect(mockOnClose).toHaveBeenCalled();
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
});
