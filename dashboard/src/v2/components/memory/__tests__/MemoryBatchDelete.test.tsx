/** @vitest-environment jsdom */
import { h } from "preact";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MemoryList } from "../MemoryList.js";
import { memoryMutationsSignal, searchQuerySignal, selectedMemoryIdsSignal } from "../memoryState.js";
import { useMemoryPageData } from "../../../hooks/use-memory-page-data.js";
import type { MemNode } from "../../../lib/memory-graph.js";
import { listEmbeddingModels, listMemories, getEmbeddingMap, getMemoryStats, deleteMemories } from "../../../lib/memory-api.js";
import type { MemoryRecord } from "../../../memory-types.js";

expect.extend(matchers);

vi.mock("../../../hooks/use-reduced-motion.js", () => ({
    useReducedMotion: () => false,
    useResolvedMotionDuration: (duration: number) => duration,
}));

vi.mock("../../../components/ui/ConfirmDialog.js", () => ({
    ConfirmDialog: ({ isOpen, options, onConfirm, onCancel }: {
        isOpen: boolean;
        options: { title?: string; body?: string; confirmLabel?: string; cancelLabel?: string } | null;
        onConfirm: () => void;
        onCancel: () => void;
    }) => isOpen ? (
        <div role="dialog" aria-label={options?.title ?? "confirm"}>
            <p>{options?.body}</p>
            <button type="button" onClick={onConfirm}>{options?.confirmLabel ?? "Confirm"}</button>
            <button type="button" onClick={onCancel}>{options?.cancelLabel ?? "Cancel"}</button>
        </div>
    ) : null
}));

vi.mock("../../../lib/memory-api.js", () => ({
    listMemories: vi.fn(),
    listEmbeddingModels: vi.fn(),
    getEmbeddingMap: vi.fn(),
    getMemoryStats: vi.fn(),
    createMemory: vi.fn(),
    deleteMemory: vi.fn(),
    deleteMemories: vi.fn(),
}));

const mockedListMemories = vi.mocked(listMemories);
const mockedListEmbeddingModels = vi.mocked(listEmbeddingModels);
const mockedGetEmbeddingMap = vi.mocked(getEmbeddingMap);
const mockedGetMemoryStats = vi.mocked(getMemoryStats);
const mockedDeleteMemories = vi.mocked(deleteMemories);

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

const buildMemoryRecord = (id: string, content: string): MemoryRecord => ({
    id,
    projectId: "project-1",
    scope: "project",
    sprintId: null,
    agentPresetId: null,
    content,
    category: "architecture",
    strength: 0.9,
    source: { type: "manual" },
    embeddingModel: null,
    embeddingDimension: null,
    embeddingBlob: null,
    promotedFromId: null,
    promotionReason: null,
    createdAt: "2026-06-01T10:00:00.000Z",
    updatedAt: "2026-06-01T10:00:00.000Z",
});

describe("Memory batch delete", () => {
    beforeEach(() => {
        searchQuerySignal.value = "";
        selectedMemoryIdsSignal.value = [];
        memoryMutationsSignal.value = {
            addMemory: vi.fn(),
            removeMemory: vi.fn(),
            removeMemories: vi.fn().mockResolvedValue([]),
            feedback: { status: "idle", message: null },
            clearFeedback: vi.fn(),
            clearError: vi.fn(),
        };
        mockedListMemories.mockReset();
        mockedListEmbeddingModels.mockReset();
        mockedGetEmbeddingMap.mockReset();
        mockedGetMemoryStats.mockReset();
        mockedDeleteMemories.mockReset();
    });

    afterEach(() => {
        document.body.innerHTML = "";
        searchQuerySignal.value = "";
        selectedMemoryIdsSignal.value = [];
    });

    test("shows a confirmation dialog before deleting more than one selected memory", async () => {
        const removeMemories = vi.fn().mockResolvedValue([]);
        memoryMutationsSignal.value.removeMemories = removeMemories;

        const { getByRole, getAllByRole } = render(
            <MemoryList
                nodes={[
                    buildNode({ id: "memory-1", content: "Alpha project memory" }),
                    buildNode({ id: "memory-2", content: "Beta project memory" }),
                ]}
                onSelectNode={vi.fn()}
            />
        );

        fireEvent.click(getByRole("button", { name: "Select all 2 visible" }));
        expect(selectedMemoryIdsSignal.value).toEqual(["memory-1", "memory-2"]);

        fireEvent.click(getByRole("button", { name: "Delete 2 selected" }));
        expect(screen.getByRole("dialog", { name: "Delete Selected Memories" })).toBeInTheDocument();
        expect(removeMemories).not.toHaveBeenCalled();

        fireEvent.click(getByRole("button", { name: "Delete Memories" }));
        await waitFor(() => {
            expect(removeMemories).toHaveBeenCalledWith(["memory-1", "memory-2"]);
        });

        expect(getAllByRole("option")).toHaveLength(2);
    });

    test("confirms single selected memory deletion before mutating", async () => {
        const removeMemories = vi.fn().mockResolvedValue([]);
        memoryMutationsSignal.value.removeMemories = removeMemories;

        const { getByRole } = render(
            <MemoryList
                nodes={[buildNode({ id: "memory-1", content: "Alpha project memory" })]}
                onSelectNode={vi.fn()}
            />
        );

        fireEvent.click(getByRole("button", { name: "Select all 1 visible" }));
        fireEvent.click(getByRole("button", { name: "Delete selected" }));

        expect(screen.getByRole("dialog", { name: "Delete Selected Memories" })).toBeInTheDocument();
        expect(screen.getByText("Delete 1 selected memory? This action cannot be undone.")).toBeInTheDocument();
        expect(removeMemories).not.toHaveBeenCalled();

        fireEvent.click(getByRole("button", { name: "Delete Memory" }));

        await waitFor(() => {
            expect(removeMemories).toHaveBeenCalledWith(["memory-1"]);
        });
    });

    test("shows pending mutation feedback while deleting selected memories", () => {
        memoryMutationsSignal.value = {
            ...memoryMutationsSignal.value,
            feedback: { status: "pending", message: "Deleting 2 memories..." },
        };
        selectedMemoryIdsSignal.value = ["memory-1", "memory-2"];

        render(
            <MemoryList
                nodes={[
                    buildNode({ id: "memory-1", content: "Alpha project memory" }),
                    buildNode({ id: "memory-2", content: "Beta project memory" }),
                ]}
                onSelectNode={vi.fn()}
            />
        );

        expect(screen.getByRole("status")).toHaveTextContent("Deleting 2 memories...");
        expect(screen.getByRole("button", { name: "Deleting 2..." })).toBeDisabled();
    });

    test("surfaces retry action when batch delete mutation fails", async () => {
        const retryAction = vi.fn();
        memoryMutationsSignal.value = {
            ...memoryMutationsSignal.value,
            feedback: {
                status: "error",
                message: "Deleted 1 memory, but 1 memory failed to delete.",
                retryAction,
                retryLabel: "Retry delete",
            },
        };
        selectedMemoryIdsSignal.value = ["memory-2"];

        render(
            <MemoryList
                nodes={[
                    buildNode({ id: "memory-1", content: "Alpha project memory" }),
                    buildNode({ id: "memory-2", content: "Beta project memory" }),
                ]}
                onSelectNode={vi.fn()}
            />
        );

        const retry = await screen.findByRole("button", { name: "Retry delete" });
        fireEvent.click(retry);

        expect(retryAction).toHaveBeenCalledTimes(1);
    });

    test("optimistically removes selected memories and restores partial failures", async () => {
        mockedListMemories.mockResolvedValue([
            buildMemoryRecord("memory-1", "Alpha project memory"),
            buildMemoryRecord("memory-2", "Beta project memory"),
        ]);
        mockedListEmbeddingModels.mockResolvedValue([]);
        mockedGetMemoryStats.mockResolvedValue({
            sprint: 0,
            agent: 0,
            project: 2,
            activeModel: null,
            staleEmbeddings: 0,
        });
        mockedGetEmbeddingMap.mockResolvedValue({
            nodes: [],
            edges: [],
            hasEmbeddings: false,
        });
        mockedDeleteMemories.mockResolvedValue([
            { memoryId: "memory-1", ok: true, error: null },
            { memoryId: "memory-2", ok: false, error: "network timeout" },
        ]);

        const { result } = renderHook(() => useMemoryPageData("project-1", "project", "long_term", undefined, undefined, true));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        await act(async () => {
            await memoryMutationsSignal.value.removeMemories(["memory-1", "memory-2"]);
        });

        await waitFor(() => {
            expect(result.current.records).toHaveLength(1);
        });

        expect(result.current.records[0]?.id).toBe("memory-2");
        expect(selectedMemoryIdsSignal.value).toEqual(["memory-2"]);
        expect(memoryMutationsSignal.value.feedback.status).toBe("error");
        expect(memoryMutationsSignal.value.feedback.message).toContain("1 memory failed");
        expect(memoryMutationsSignal.value.feedback.retryAction).toBeDefined();
        expect(mockedDeleteMemories).toHaveBeenCalledWith(["memory-1", "memory-2"]);
    });
});
