/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/preact";
import { useMemoryPageData } from "../../../dashboard/src/v2/hooks/use-memory-page-data.js";
import * as memoryApi from "../../../dashboard/src/v2/lib/memory-api.js";
import * as projectApi from "../../../dashboard/src/v2/lib/project-api.js";
import * as agentPresetApi from "../../../dashboard/src/v2/lib/agent-preset-api.js";

vi.mock("../../../dashboard/src/v2/lib/memory-api.js");
vi.mock("../../../dashboard/src/v2/lib/project-api.js");
vi.mock("../../../dashboard/src/v2/lib/agent-preset-api.js");

describe("useMemoryPageData", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        vi.mocked(projectApi.fetchSprints).mockResolvedValue({ sprints: [] } as any);
        vi.mocked(agentPresetApi.fetchAgentPresets).mockResolvedValue([]);

        vi.mocked(memoryApi.listMemories).mockResolvedValue([]);
        vi.mocked(memoryApi.listEmbeddingModels).mockResolvedValue([]);
        vi.mocked(memoryApi.getMemoryStats).mockResolvedValue({ sprint: 0, agent: 0, project: 0, activeModel: null, staleEmbeddings: 0 });
        vi.mocked(memoryApi.getEmbeddingMap).mockResolvedValue({ hasEmbeddings: false, nodes: [], edges: [] });
    });

    it("should initialize with default states", () => {
        const { result } = renderHook(() => useMemoryPageData("proj-1"));

        expect(result.current.state.activeTier).toBe("short_term");
        expect(result.current.state.activeScope).toBe("sprint");
        expect(result.current.state.loading).toBe(true); // Initial fetch trigger
    });

    it("should update tier and scope", async () => {
        const { result } = renderHook(() => useMemoryPageData("proj-1"));

        act(() => {
            result.current.actions.setActiveTier("long_term");
        });

        expect(result.current.state.activeTier).toBe("long_term");
        expect(result.current.state.activeScope).toBe("project");
    });

    it("should load data on mount", async () => {
        const mockMemory = { id: "1", content: "test" } as any;
        vi.mocked(memoryApi.listMemories).mockResolvedValue([mockMemory]);

        const { result } = renderHook(() => useMemoryPageData("proj-1"));

        await waitFor(() => {
            expect(result.current.state.loading).toBe(false);
            expect(result.current.state.records).toEqual([mockMemory]);
        });

        expect(memoryApi.listMemories).toHaveBeenCalledWith({
            projectId: "proj-1",
            scope: "sprint",
            limit: 200,
        });
    });

    it("should fetch sprints and auto-select latest sprint for short_term tier", async () => {
        const mockSprints = [
            { id: "sprint-old", number: 1 },
            { id: "sprint-latest", number: 2 }
        ] as any;
        vi.mocked(projectApi.fetchSprints).mockResolvedValue({ sprints: mockSprints } as any);

        const { result } = renderHook(() => useMemoryPageData("proj-1"));

        await waitFor(() => {
            expect(result.current.state.sprints.length).toBe(2);
            expect(result.current.state.selectedSprintId).toBe("sprint-latest");
        });
    });

    it("should trigger re-embed properly", async () => {
        vi.mocked(memoryApi.startReembed).mockResolvedValue(undefined as any);
        vi.mocked(memoryApi.getReembedProgress).mockResolvedValue({ active: true, completed: 0, total: 10 });

        const { result } = renderHook(() => useMemoryPageData("proj-1"));

        await act(async () => {
            await result.current.actions.handleReembed();
        });

        expect(memoryApi.startReembed).toHaveBeenCalledWith("proj-1");
        expect(result.current.state.reembed?.active).toBe(true);
    });

    it("should filter memories when sprint or agent preset is selected", async () => {
        const { result } = renderHook(() => useMemoryPageData("proj-1"));

        await act(async () => {
            result.current.actions.setSelectedSprintId("sprint-123");
            result.current.actions.setSelectedAgentPresetId("agent-abc");
            // loadData is triggered via useEffect, so we can just wait or force it
            await result.current.actions.loadData();
        });

        expect(memoryApi.listMemories).toHaveBeenCalledWith({
            projectId: "proj-1",
            scope: "sprint",
            sprintId: "sprint-123",
            agentPresetId: "agent-abc",
            limit: 200,
        });
    });

    it("should handle error in handleDeleteRecord", async () => {
        vi.mocked(memoryApi.deleteMemory).mockRejectedValue(new Error("delete failed"));
        const { result } = renderHook(() => useMemoryPageData("proj-1"));

        await act(async () => {
            await result.current.actions.handleDeleteRecord("memory-1");
        });

        expect(memoryApi.deleteMemory).toHaveBeenCalledWith("memory-1");
    });
});

    it("should fetch agent presets cleanly on change", async () => {
        const mockAgentPreset = { id: "a1", name: "agent 1" } as any;
        vi.mocked(agentPresetApi.fetchAgentPresets).mockResolvedValue([mockAgentPreset]);

        const { result } = renderHook(() => useMemoryPageData("proj-2"));

        await waitFor(() => {
            expect(result.current.state.agentPresets.length).toBe(1);
        });
    });

    it("should handle error in agent preset and sprint fetch gracefully", async () => {
        vi.mocked(projectApi.fetchSprints).mockRejectedValue(new Error("fail"));
        vi.mocked(agentPresetApi.fetchAgentPresets).mockRejectedValue(new Error("fail"));

        const { result } = renderHook(() => useMemoryPageData("proj-err"));

        await waitFor(() => {
            expect(result.current.state.sprints).toEqual([]);
            expect(result.current.state.agentPresets).toEqual([]);
        });
    });

    it("should clear re-embed when completed", async () => {
        vi.mocked(memoryApi.getReembedProgress).mockResolvedValue({ active: false, completed: 10, total: 10 });

        const { result } = renderHook(() => useMemoryPageData("proj-done"));

        // Timer triggers interval for reembed progress
        await waitFor(() => {
            expect(memoryApi.getReembedProgress).toHaveBeenCalled();
        });
    });
