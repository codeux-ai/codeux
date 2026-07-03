/** @vitest-environment jsdom */
import { h } from "preact";
import { fireEvent, render } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, test, vi } from "vitest";
import MemorySidebar from "../MemorySidebar.js";
import { memorySidebarExpandedSignal, searchQuerySignal, selectedMemoryIdsSignal } from "../memoryState.js";
import type { MemNode } from "../../../lib/memory-graph.js";

expect.extend(matchers);

vi.mock("../../../hooks/use-reduced-motion.js", () => ({
    useReducedMotion: () => false,
    useResolvedMotionDuration: (duration: number) => duration,
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

describe("MemorySidebar", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        memorySidebarExpandedSignal.value = false;
        searchQuerySignal.value = "";
        selectedMemoryIdsSignal.value = [];
    });

    test("starts collapsed with an open action and a left-facing desktop arrow", () => {
        memorySidebarExpandedSignal.value = false;

        const { getByRole, queryByRole, container } = render(
            <MemorySidebar nodes={[buildNode()]} onSelectNode={vi.fn()} />
        );

        const toggle = getByRole("button", { name: "Open memory sidebar" });
        expect(toggle).toHaveAttribute("aria-expanded", "false");
        expect(queryByRole("textbox", { name: "Search memories" })).toBeNull();
        expect(container.querySelector("[data-sidebar-toggle-icon]")).toHaveClass("rotate-180");
    });

    test("expands with embedded search, collapses, and clears the search query when closing", () => {
        memorySidebarExpandedSignal.value = true;
        searchQuerySignal.value = "alpha";
        selectedMemoryIdsSignal.value = ["memory-1"];

        const { getByRole, queryByRole, container } = render(
            <MemorySidebar nodes={[buildNode()]} onSelectNode={vi.fn()} />
        );

        expect(getByRole("button", { name: "Close memory sidebar" })).toHaveAttribute("aria-expanded", "true");
        expect(getByRole("textbox", { name: "Search memories" })).toBeInTheDocument();
        expect(container.querySelector("[data-sidebar-toggle-icon]")).toHaveClass("rotate-0");

        fireEvent.click(getByRole("button", { name: "Close memory sidebar" }));

        expect(memorySidebarExpandedSignal.value).toBe(false);
        expect(searchQuerySignal.value).toBe("");
        expect(selectedMemoryIdsSignal.value).toEqual([]);
        expect(getByRole("button", { name: "Open memory sidebar" })).toHaveAttribute("aria-expanded", "false");
        expect(queryByRole("textbox", { name: "Search memories" })).toBeNull();
        expect(container.querySelector("[data-sidebar-toggle-icon]")).toHaveClass("rotate-180");
    });
});
