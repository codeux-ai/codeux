/** @vitest-environment jsdom */
import { h } from "preact";
import { fireEvent, render, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect, test, describe, vi, afterEach } from "vitest";
import { MemoryList } from "../MemoryList.js";
import { memoryMutationsSignal, searchQuerySignal, selectedMemoryIdsSignal } from "../memoryState.js";
import type { MemNode } from "../../../lib/memory-graph.js";

expect.extend(matchers);

let mockReducedMotion = false;

vi.mock("../../../hooks/use-reduced-motion.js", () => ({
    useReducedMotion: () => mockReducedMotion,
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

describe("MemoryList", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        searchQuerySignal.value = "";
        selectedMemoryIdsSignal.value = [];
        mockReducedMotion = false;
    });

    memoryMutationsSignal.value = {
        addMemory: vi.fn(),
        removeMemory: vi.fn(),
        removeMemories: vi.fn().mockResolvedValue([]),
        feedback: { status: "idle", message: null },
        clearFeedback: vi.fn(),
        clearError: vi.fn(),
    };

    test("renders empty state polite announcement", () => {
        searchQuerySignal.value = "nonexistent query";
        const { getAllByText } = render(
            <MemoryList nodes={[]} onSelectNode={vi.fn()} />
        );
        const announcement = getAllByText("No memories exist")
            .map((element) => element.closest(".sr-only"))
            .find(Boolean);
        expect(announcement).toBeInTheDocument();
        expect(announcement).toHaveClass("sr-only");
    });

    test("renders all alive memories by default", () => {
        const { getByRole, getByText, queryByText } = render(
            <MemoryList
                nodes={[
                    buildNode({ id: "memory-1", content: "Alpha project memory" }),
                    buildNode({ id: "memory-2", content: "Beta note" }),
                    buildNode({ id: "memory-3", content: "Archived note", alive: false }),
                ]}
                onSelectNode={vi.fn()}
            />
        );

        expect(getByRole("listbox", { name: "Memory List" })).toBeInTheDocument();
        expect(getByText("Alpha project memory")).toBeInTheDocument();
        expect(getByText("Beta note")).toBeInTheDocument();
        expect(queryByText("Archived note")).toBeNull();
        expect(getByText("Showing 2 of 2 memories")).toBeInTheDocument();
        expect(getByText("2 memories shown")).toHaveClass("sr-only");
    });

    test("renders true empty state when no alive memories exist", () => {
        const { getAllByText } = render(
            <MemoryList nodes={[buildNode({ alive: false })]} onSelectNode={vi.fn()} />
        );

        const announcement = getAllByText("No memories exist")
            .map((element) => element.closest(".sr-only"))
            .find(Boolean);
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

        expect(getByText(/Showing 1 of 2 memories/)).toBeInTheDocument();
    });

    test("filters memories by category while preserving listbox options", () => {
        searchQuerySignal.value = "decision";
        const { getAllByRole, getByRole, getByText, queryByText } = render(
            <MemoryList
                nodes={[
                    buildNode({ id: "memory-1", content: "Alpha project memory", category: "architecture" }),
                    buildNode({ id: "memory-2", content: "Release tradeoff", category: "decision" }),
                ]}
                onSelectNode={vi.fn()}
            />
        );

        expect(getByRole("listbox", { name: "Memory List" })).toBeInTheDocument();
        expect(getAllByRole("option")).toHaveLength(1);
        expect(getByText("Release tradeoff")).toBeInTheDocument();
        expect(queryByText("Alpha project memory")).toBeNull();
        expect(getByText(/1 memory shown/)).toHaveClass("sr-only");
    });

    test("select all visible only targets currently filtered nodes", () => {
        searchQuerySignal.value = "alpha";
        const { getByRole } = render(
            <MemoryList
                nodes={[
                    buildNode({ id: "memory-1", content: "Alpha project memory" }),
                    buildNode({ id: "memory-2", content: "Beta note" }),
                ]}
                onSelectNode={vi.fn()}
            />
        );

        const selectAll = getByRole("button", { name: "Select all visible" });
        expect(selectAll).toBeInTheDocument();

        selectAll.click();

        expect(selectedMemoryIdsSignal.value).toEqual(["memory-1"]);
    });

    test("announces selected count and updates batch delete copy", async () => {
        const { getByRole, getByText } = render(
            <MemoryList
                nodes={[
                    buildNode({ id: "memory-1", content: "Alpha project memory" }),
                    buildNode({ id: "memory-2", content: "Beta note" }),
                ]}
                onSelectNode={vi.fn()}
            />
        );

        fireEvent.click(getByRole("button", { name: "Select all visible" }));

        await waitFor(() => {
            expect(getByText("2 memories selected")).toHaveClass("sr-only");
        });
        expect(getByText("2 selected")).toBeInTheDocument();
        expect(getByRole("button", { name: "Delete 2 selected" })).toBeInTheDocument();
    });

    test("reduced motion applies static list updates without hiding visible cues", () => {
        mockReducedMotion = true;
        const { getByText, queryByText, rerender } = render(
            <MemoryList
                nodes={[
                    buildNode({ id: "memory-1", content: "Alpha project memory" }),
                    buildNode({ id: "memory-2", content: "Beta note" }),
                ]}
                onSelectNode={vi.fn()}
            />
        );

        expect(getByText("Alpha project memory")).toBeInTheDocument();

        searchQuerySignal.value = "beta";
        rerender(
            <MemoryList
                nodes={[
                    buildNode({ id: "memory-1", content: "Alpha project memory" }),
                    buildNode({ id: "memory-2", content: "Beta note" }),
                ]}
                onSelectNode={vi.fn()}
            />
        );

        expect(queryByText("Alpha project memory")).toBeNull();
        expect(getByText(/Showing 1 of 2 memories/)).toBeInTheDocument();
        expect(getByText(/1 memory shown/)).toHaveClass("sr-only");
    });

    test("keeps the last useful result list visible during refresh", () => {
        const { getByText, queryByText, rerender } = render(
            <MemoryList
                nodes={[buildNode({ id: "memory-1", content: "Alpha project memory" })]}
                onSelectNode={vi.fn()}
            />
        );

        expect(getByText("Alpha project memory")).toBeInTheDocument();

        rerender(
            <MemoryList
                nodes={[]}
                onSelectNode={vi.fn()}
                refreshing={true}
            />
        );

        expect(getByText("Alpha project memory")).toBeInTheDocument();
        expect(getByText("Refreshing memories. Keeping the last useful result list visible.")).toBeInTheDocument();
        expect(queryByText("No memories exist")).toBeNull();
    });

    test("shows recovery copy and retry action when refresh fails", () => {
        const onRetry = vi.fn();
        const { getByRole, getByText } = render(
            <MemoryList
                nodes={[]}
                onSelectNode={vi.fn()}
                loadError="Network unavailable"
                onRetry={onRetry}
            />
        );

        expect(getByRole("listbox", { name: "Memory List" })).toHaveTextContent("Memory list could not refresh");
        expect(getByText("Network unavailable")).toBeInTheDocument();

        fireEvent.click(getByRole("button", { name: "Retry" }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    test("empty list gives an add-memory next action", () => {
        const onAddMemory = vi.fn();
        const { getByRole, getByText } = render(
            <MemoryList
                nodes={[]}
                onSelectNode={vi.fn()}
                onAddMemory={onAddMemory}
            />
        );

        expect(getByText("Add a memory manually or run a sprint that captures project context.")).toBeInTheDocument();

        fireEvent.click(getByRole("button", { name: "Add memory" }));

        expect(onAddMemory).toHaveBeenCalledTimes(1);
    });
});
