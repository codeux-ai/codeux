/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/preact";
import * as matchers from '@testing-library/jest-dom/matchers';
import { HeaderStats } from "../../../dashboard/src/v2/components/HeaderStats.js";

expect.extend(matchers);

// Mock the getTotalLength function for SVG paths in jsdom
beforeEach(() => {
    // jsdom doesn't implement getTotalLength, so we mock it globally
    // for any SVGPathElement
    Object.defineProperty(window.SVGElement.prototype, 'getTotalLength', {
        value: () => 100,
        configurable: true
    });
});

describe("HeaderStats", () => {
    beforeEach(() => {
        cleanup();
    });

    afterEach(() => {
        cleanup();
    });

    it("renders Total Tokens and other metric cards with correct data and styles", async () => {
        const mockPageData = {
            projects: [{ id: "p1", isRunning: false }] as any,
            selectedProject: { id: "p1", name: "Alpha Project" } as any,
            sprints: [{ id: "s1", status: "running", createdAt: "2024-03-08T10:00:00Z" }] as any,
            tasks: [
                { id: "t1", status: "in_progress", priority: "critical", createdAt: "2024-03-08T10:00:00Z" },
                { id: "t2", status: "completed", createdAt: "2024-03-08T10:00:00Z" }
            ] as any,
            stats: {
                usage: { totalTokens: 12500 },
                buckets: [
                    { usage: { totalTokens: 100 } }
                ]
            } as any,
            isLoading: false
        };

        const { container } = render(<HeaderStats pageData={mockPageData as any} />);

        // Assert Total Tokens rendering
        expect(container.textContent).toContain("Total Tokens");
        expect(container.textContent).toContain("12.5k");
        expect(container.textContent).toContain("Alpha Project");

        // Force react/preact layout effect to run if needed
        await new Promise((r) => setTimeout(r, 0));

        // The MetricCard might contain other SVGs like WaveFluid
        // Instead of picking specific indices, we search within each card
        const cards = container.querySelectorAll(".group");
        expect(cards.length).toBe(4);

        // Card 1: Total Tokens (Green #00E0A0)
        expect(cards[0].innerHTML).toContain('stroke="#00E0A0"');
        // Card 2: Sprints (Blue #00AAFF)
        expect(cards[1].innerHTML).toContain('stroke="#00AAFF"');
        // Card 3: Open Tasks (Yellow #FFB800)
        expect(cards[2].innerHTML).toContain('stroke="#FFB800"');
        // Card 4: Completed Tasks (Green #00E0A0)
        expect(cards[3].innerHTML).toContain('stroke="#00E0A0"');
    });
});
