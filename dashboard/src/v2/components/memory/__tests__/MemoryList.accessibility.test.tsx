/** @vitest-environment jsdom */
import { h } from "preact";
import { render } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect, test, describe, vi, afterEach } from "vitest";
import { MemoryList } from "../MemoryList.js";
import { searchQuerySignal } from "../memoryState.js";

expect.extend(matchers);

vi.mock("../../../hooks/use-reduced-motion.js", () => ({
    useReducedMotion: () => false,
    useResolvedMotionDuration: (duration: number) => duration,
}));

describe("MemoryList", () => {
    afterEach(() => {
        searchQuerySignal.value = "";
        document.body.innerHTML = "";
    });

    test("renders empty state polite announcement", () => {
        searchQuerySignal.value = "nonexistent query";
        const { getAllByText } = render(
            <MemoryList nodes={[]} onSelectNode={vi.fn()} />
        );
        const announcement = getAllByText("No memories in this view")[0];
        expect(announcement).toBeInTheDocument();
        expect(announcement).toHaveClass("sr-only");
    });

    test("renders a distinct search miss state", () => {
        searchQuerySignal.value = "missing";
        const { getAllByText, getByText } = render(
            <MemoryList
                nodes={[{
                    id: "mem-1",
                    content: "Known architectural constraint",
                    category: "architecture",
                    scope: "project",
                    strength: 0.8,
                    x: 0,
                    y: 0,
                    targetX: 0,
                    targetY: 0,
                    radius: 8,
                    scale: 1,
                    opacity: 1,
                    glow: 0,
                    alive: true,
                } as any]}
                onSelectNode={vi.fn()}
            />
        );

        expect(getAllByText("No memories match your search or filters")).toHaveLength(2);
        expect(getByText("Try a broader search term or switch memory scope filters.")).toBeInTheDocument();
    });
});
