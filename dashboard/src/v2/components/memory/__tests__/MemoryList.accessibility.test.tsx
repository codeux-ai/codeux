/** @vitest-environment jsdom */
import { h } from "preact";
import { render } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect, test, describe, vi, afterEach } from "vitest";
import { MemoryList } from "../MemoryList.js";
import { searchQuerySignal } from "../memoryState.js";
import type { MemNode } from "../../../lib/memory-graph.js";

expect.extend(matchers);

vi.mock("../../../hooks/use-reduced-motion.js", () => ({
    useReducedMotion: () => false
}));

const buildNode = (overrides: Partial<MemNode> = {}): MemNode => ({
    id: "memory-1",
    content: "Alpha project memory",
    category: "architecture",
    strength: 0.9,
    scope: "project",
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    radius: 10,
    opacity: 1,
    scale: 1,
    glow: 0,
    alive: true,
    ...overrides
});

describe("MemoryList", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        searchQuerySignal.value = "";
    });

    test("renders empty state polite announcement", () => {
        searchQuerySignal.value = "nonexistent query";
        const { getByText } = render(
            <MemoryList nodes={[]} onSelectNode={vi.fn()} />
        );
        const announcement = getByText("No memories exist");
        expect(announcement).toBeInTheDocument();
        expect(announcement).toHaveClass("sr-only");
    });

    test("shows visible search result counts for filtered memories", () => {
        searchQuerySignal.value = "alpha";
        const { getByText } = render(
            <MemoryList
                nodes={[buildNode(), buildNode({ id: "memory-2", content: "Beta note" })]}
                onSelectNode={vi.fn()}
            />
        );

        expect(getByText("Showing 1 of 2 memories")).toBeInTheDocument();
    });
});
