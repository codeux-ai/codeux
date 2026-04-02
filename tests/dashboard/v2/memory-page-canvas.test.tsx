/**
 * @vitest-environment jsdom
 */
import { renderHook, act } from "@testing-library/preact";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { useMemoryGraphCanvas } from "../../../dashboard/src/v2/hooks/use-memory-graph-canvas";
import * as memoryGraph from "../../../dashboard/src/v2/lib/memory-graph";

// Mock dependencies
vi.mock("gsap", () => ({
    default: {
        to: vi.fn(),
        killTweensOf: vi.fn(),
        timeline: vi.fn().mockReturnValue({
            to: vi.fn().mockReturnThis(),
            clear: vi.fn()
        })
    }
}));

vi.mock("../../../dashboard/src/v2/lib/memory-graph", () => {
    return {
        prepareMemoryGraph: vi.fn(),
        hitTest: vi.fn(),
        quadAt: vi.fn().mockReturnValue({ x: 0, y: 0 }),
        bezierCtrl: vi.fn().mockReturnValue({ x: 0, y: 0 }),
        CAT: { context: 0, codebase: 1, action: 2, resolution: 3 }
    };
});

describe("useMemoryGraphCanvas", () => {
    let mockCanvasRef: any;
    let mockWrapRef: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockCanvasRef = { current: document.createElement("canvas") };
        mockWrapRef = { current: document.createElement("div") };

        // Setup default mock returns
        (memoryGraph.prepareMemoryGraph as any).mockReturnValue({
            nodes: [
                { id: "m1", x: 10, y: 10, targetX: 10, targetY: 10, category: "context" },
                { id: "m2", x: 20, y: 20, targetX: 20, targetY: 20, category: "codebase" }
            ],
            edges: [
                { source: 0, target: 1, strength: 0.8 }
            ],
            meta: {
                minTime: 0,
                maxTime: 1000
            }
        });

        (memoryGraph.hitTest as any).mockReturnValue(-1);
    });

    it("should initialize and return correct shape", () => {
        vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
        vi.spyOn(window, "setTimeout").mockImplementation(() => 1 as any);

        const { result } = renderHook(() => useMemoryGraphCanvas(
            mockCanvasRef,
            mockWrapRef,
            [],
            null,
            vi.fn()
        ));

        expect(result.current.state).toBeDefined();
        expect(result.current.actions).toBeDefined();
        expect(result.current.state.searchQuery).toBe("");
        expect(result.current.state.lobotomize).toBe(false);
        expect(result.current.state.selectedNode).toBeNull();
    });

    it("should clear search match when query is empty", () => {
        vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
        vi.spyOn(window, "setTimeout").mockImplementation(() => 1 as any);

        const { result } = renderHook(() => useMemoryGraphCanvas(
            mockCanvasRef,
            mockWrapRef,
            [],
            null,
            vi.fn()
        ));

        act(() => {
            result.current.actions.handleSearch(" ");
        });

        expect(result.current.state.graphState.current.searchMatch).toBeNull();
    });

    it("should handle lobotomize toggle", () => {
        vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
        vi.spyOn(window, "setTimeout").mockImplementation(() => 1 as any);

        const { result } = renderHook(() => useMemoryGraphCanvas(
            mockCanvasRef,
            mockWrapRef,
            [],
            null,
            vi.fn()
        ));

        expect(result.current.state.lobotomize).toBe(false);

        act(() => {
            result.current.actions.handleLobotomizeToggle();
        });

        expect(result.current.state.lobotomize).toBe(true);
    });

    it("should handle delete record", async () => {
        vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
        vi.spyOn(window, "setTimeout").mockImplementation(() => 1 as any);

        const mockRecords = [
            { id: "m1", content: "test", category: "context" }
        ] as any;

        const onDeleteMock = vi.fn().mockResolvedValue(undefined);

        const { result } = renderHook(() => useMemoryGraphCanvas(
            mockCanvasRef,
            mockWrapRef,
            mockRecords,
            null,
            onDeleteMock
        ));

        await act(async () => {
            await result.current.actions.handleDelete("m1");
        });

        expect(onDeleteMock).toHaveBeenCalledWith("m1");
    });

    it("should handle camera controls", () => {
        vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
        vi.spyOn(window, "setTimeout").mockImplementation(() => 1 as any);

        const { result } = renderHook(() => useMemoryGraphCanvas(
            mockCanvasRef,
            mockWrapRef,
            [],
            null,
            vi.fn()
        ));

        act(() => {
            result.current.actions.zoomIn();
            result.current.actions.zoomOut();
            result.current.actions.zoomReset();
            result.current.actions.setSelectedNode(null);
        });

        expect(result.current.state.selectedNode).toBeNull();
    });
});

    it("should handle wheel events and zoom out correctly", () => {
        vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
        vi.spyOn(window, "setTimeout").mockImplementation(() => 1 as any);

        const mockCanvasRef = { current: document.createElement("canvas") } as any;
        const mockWrapRef = { current: document.createElement("div") } as any;

        const { result } = renderHook(() => useMemoryGraphCanvas(
            mockCanvasRef,
            mockWrapRef,
            [],
            null,
            vi.fn()
        ));

        act(() => {
            const wheelEvent = new WheelEvent("wheel", { deltaY: -100 });
            mockCanvasRef.current.dispatchEvent(wheelEvent);
        });

        act(() => {
            const wheelEvent = new WheelEvent("wheel", { deltaY: 100 });
            mockCanvasRef.current.dispatchEvent(wheelEvent);
        });

        act(() => {
            mockCanvasRef.current.dispatchEvent(new MouseEvent("mouseleave"));
        });

        expect(result.current.state.graphState.current.hoveredIdx).toBe(-1);
    });
