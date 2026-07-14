/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
// @ts-ignore
globalThis.React = { createElement: h };
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, act, waitFor, fireEvent } from "@testing-library/preact";
import { renderWithDashboardI18n as render } from "../helpers/dashboard-i18n-test-utils.js";
import * as matchers from "@testing-library/jest-dom/matchers";
import { MemoryPage, getNodeScreenRadius, getWheelZoomTarget, inverseZoomScreenSize } from "../../../dashboard/src/v2/MemoryPage.js";
import { ProjectDataContext } from "../../../dashboard/src/v2/context/project-data.js";
import * as api from "../../../dashboard/src/v2/lib/memory-api.js";
import userEvent from "@testing-library/user-event";
import { useEmbeddingModelStatus } from "../../../dashboard/src/v2/hooks/use-embedding-model-status.js";
import { useMemoryPageData } from "../../../dashboard/src/v2/hooks/use-memory-page-data.js";
import { MEMORY_CAMERA } from "../../../dashboard/src/v2/lib/memory-camera.js";
import { activeMemoryIdSignal, activeTierSignal, lobotomizeModeSignal, memorySidebarExpandedSignal, searchQuerySignal } from "../../../dashboard/src/v2/components/memory/memoryState.js";
import type { MemoryRecord } from "../../../dashboard/src/v2/memory-types.js";
// we cannot use renderHook because of dependency conflict. So we create a wrapper.

expect.extend(matchers);

// Mock API
vi.mock("../../../dashboard/src/v2/lib/memory-api.js");
vi.mock("../../../dashboard/src/v2/lib/project-api.js", () => ({
    fetchSprints: vi.fn().mockResolvedValue({ sprints: [] }),
}));
vi.mock("../../../dashboard/src/v2/lib/agent-preset-api.js", () => ({
    fetchAgentPresets: vi.fn().mockResolvedValue([]),
    fetchSkillCatalog: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../dashboard/src/v2/lib/api/fetch-json.js", () => ({
    fetchJson: vi.fn()
}));
vi.mock("gsap", () => {
    const createTimeline = (config?: { onComplete?: () => void }) => {
        const timeline = {
            to: vi.fn(() => timeline),
            kill: vi.fn(),
        };
        if (config?.onComplete) {
            queueMicrotask(config.onComplete);
        }
        return timeline;
    };
    const gsapMock = {
        to: vi.fn(),
        fromTo: vi.fn(),
        set: vi.fn(),
        timeline: vi.fn(createTimeline),
        context: vi.fn((callback: () => void) => {
            callback();
            return { revert: vi.fn() };
        }),
        killTweensOf: vi.fn(),
    };
    return { default: gsapMock, gsap: gsapMock };
});

describe("memory map canvas helpers", () => {
    it("keeps label sizing in screen space as camera zoom changes", () => {
        expect(inverseZoomScreenSize(12, 1)).toBe(12);
        expect(inverseZoomScreenSize(12, 3)).toBe(4);
        expect(inverseZoomScreenSize(12, 0)).toBe(12 / MEMORY_CAMERA.minZoom);
        expect(inverseZoomScreenSize(8, 2, 10, 14)).toBe(5);
        expect(inverseZoomScreenSize(18, 2, 10, 14)).toBe(7);
    });

    it("keeps node base radius independent of camera zoom while preserving animation scale", () => {
        const node = { radius: 11, scale: 1 };
        const screenRadius = getNodeScreenRadius(node);

        expect(screenRadius).toBe(9.5);
        expect(inverseZoomScreenSize(screenRadius, 1)).toBe(9.5);
        expect(inverseZoomScreenSize(screenRadius, 5) * 5).toBe(9.5);
        expect(getNodeScreenRadius({ radius: 11, scale: 1.35 })).toBeCloseTo(11.4);
        expect(getNodeScreenRadius({ radius: 11, scale: 0 })).toBe(0);
    });

    it("derives smooth proportional wheel zoom targets", () => {
        const zoomedIn = getWheelZoomTarget(2, -100);
        const zoomedOut = getWheelZoomTarget(2, 100);
        const smallDeltaZoom = getWheelZoomTarget(2, -20);
        const tinyDeltaZoom = getWheelZoomTarget(2, -1);

        expect(zoomedIn).toBeGreaterThan(2);
        expect(zoomedOut).toBeLessThan(2);
        expect(smallDeltaZoom).toBeGreaterThan(2);
        expect(smallDeltaZoom).toBeLessThan(zoomedIn);
        expect(tinyDeltaZoom).toBeGreaterThan(2);
        expect(tinyDeltaZoom).toBeLessThan(smallDeltaZoom);
    });
});

const renderMemoryPage = (locale: "en" | "de" = "en") => {
    return render(
        <ProjectDataContext.Provider value={{
            projects: [{ id: "proj-1", name: "Project 1", isActive: true }],
            selectedProject: { id: "proj-1", name: "Project 1", isActive: true },
            setSelectedProject: vi.fn(),
            loadProjects: vi.fn(),
        }}>
            <MemoryPage />
        </ProjectDataContext.Provider>
    , locale);
};

const memoryRecord = (overrides: Partial<MemoryRecord> = {}): MemoryRecord => ({
    id: "memory-1",
    projectId: "proj-1",
    scope: "project",
    content: "Immediate deletion memory",
    category: "context",
    strength: 0.8,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sprintId: null,
    agentPresetId: null,
    source: { type: "manual" },
    embeddingModel: null,
    embeddingDimension: 0,
    embeddingBlob: null,
    promotedFromId: null,
    promotionReason: null,
    ...overrides,
});

describe("MemoryPage destructive mode", () => {
    let originalMatchMedia: typeof window.matchMedia;
    let canvasRectSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        activeTierSignal.value = "long_term";
        activeMemoryIdSignal.value = null;
        lobotomizeModeSignal.value = false;
        memorySidebarExpandedSignal.value = false;
        searchQuerySignal.value = "";
        vi.mocked(api.listMemories).mockResolvedValue([memoryRecord()]);
        vi.mocked(api.listEmbeddingModels).mockResolvedValue([]);
        vi.mocked(api.getMemoryStats).mockResolvedValue({ sprint: 0, agent: 0, project: 1, activeModel: null, staleEmbeddings: 0 });
        vi.mocked(api.getEmbeddingMap).mockResolvedValue({
            hasEmbeddings: true,
            nodes: [{ id: "memory-1", x: 0, y: 0 }],
            edges: [],
        });
        vi.mocked(api.deleteMemory).mockResolvedValue(undefined);
        originalMatchMedia = window.matchMedia;
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
            matches: query === "(prefers-reduced-motion: reduce)",
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
        canvasRectSpy = vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
            x: 0,
            y: 0,
            left: 0,
            top: 0,
            right: 800,
            bottom: 600,
            width: 800,
            height: 600,
            toJSON: () => ({}),
        } as DOMRect));
    });

    afterEach(() => {
        window.matchMedia = originalMatchMedia;
        canvasRectSpy.mockRestore();
        activeTierSignal.value = "short_term";
        activeMemoryIdSignal.value = null;
        lobotomizeModeSignal.value = false;
        memorySidebarExpandedSignal.value = false;
        searchQuerySignal.value = "";
        document.body.innerHTML = "";
    });

    it("renders the loaded graph nodes in the sidebar list after graph data resolves", async () => {
        memorySidebarExpandedSignal.value = true;
        vi.mocked(api.listMemories).mockResolvedValue([
            memoryRecord({
                id: "memory-reactive",
                content: "Reactive graph node memory",
                category: "codebase",
                strength: 0.7,
            }),
            memoryRecord({
                id: "memory-second",
                content: "Second loaded graph memory",
                category: "learning",
                strength: 0.9,
            }),
        ]);
        vi.mocked(api.getMemoryStats).mockResolvedValue({ sprint: 0, agent: 0, project: 2, activeModel: null, staleEmbeddings: 0 });
        vi.mocked(api.getEmbeddingMap).mockResolvedValue({
            hasEmbeddings: true,
            nodes: [
                { id: "memory-reactive", x: 20, y: 30 },
                { id: "memory-second", x: -20, y: -30 },
            ],
            edges: [],
        });

        const { unmount } = renderMemoryPage();

        await waitFor(() => {
            expect(screen.getByText("Reactive graph node memory")).toBeInTheDocument();
            expect(screen.getByText("Second loaded graph memory")).toBeInTheDocument();
        });
        expect(screen.getByText("2 memories shown")).toBeInTheDocument();
        expect(screen.getByText("2 nodes")).toBeInTheDocument();

        unmount();
    });

    it("renders German map controls while preserving loaded memory content", async () => {
        memorySidebarExpandedSignal.value = true;
        vi.mocked(api.listMemories).mockResolvedValue([
            memoryRecord({ content: "Persisted API contract remains English", category: "architecture" }),
        ]);

        const { unmount } = renderMemoryPage("de");

        await waitFor(() => {
            expect(screen.getByText("Persisted API contract remains English")).toBeInTheDocument();
        });
        expect(screen.getByRole("heading", { name: "Erinnerungskarte" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Vergrößern" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Verkleinern" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Ansicht zurücksetzen" })).toBeInTheDocument();
        expect(screen.getByText("1 Knoten")).toBeInTheDocument();
        unmount();
    });

    it("stops scheduling canvas frames when the document becomes hidden", async () => {
        const originalGlobalRaf = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
        const originalGlobalCancel = Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame");
        const originalWindowRaf = Object.getOwnPropertyDescriptor(window, "requestAnimationFrame");
        const originalWindowCancel = Object.getOwnPropertyDescriptor(window, "cancelAnimationFrame");
        const originalHidden = Object.getOwnPropertyDescriptor(Document.prototype, "hidden")
            ?? Object.getOwnPropertyDescriptor(document, "hidden");
        const frameCallbacks: FrameRequestCallback[] = [];
        const rafSpy = vi.fn((callback: FrameRequestCallback) => {
            frameCallbacks.push(callback);
            return frameCallbacks.length;
        });
        const cancelSpy = vi.fn();
        let hidden = false;
        const restoreProperty = (target: object, key: PropertyKey, descriptor: PropertyDescriptor | undefined) => {
            if (descriptor) {
                Object.defineProperty(target, key, descriptor);
                return;
            }
            Reflect.deleteProperty(target, key);
        };
        const setHidden = (nextHidden: boolean) => {
            hidden = nextHidden;
        };

        Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: rafSpy });
        Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: cancelSpy });
        Object.defineProperty(window, "requestAnimationFrame", { configurable: true, value: rafSpy });
        Object.defineProperty(window, "cancelAnimationFrame", { configurable: true, value: cancelSpy });
        Object.defineProperty(document, "hidden", {
            configurable: true,
            get: () => hidden,
        });

        try {
            setHidden(false);
            const { unmount } = renderMemoryPage();

            expect(rafSpy).toHaveBeenCalledTimes(1);

            setHidden(true);
            document.dispatchEvent(new Event("visibilitychange"));

            expect(cancelSpy).toHaveBeenCalledWith(1);

            act(() => {
                frameCallbacks[0]?.(16);
            });

            expect(rafSpy).toHaveBeenCalledTimes(1);

            setHidden(false);
            document.dispatchEvent(new Event("visibilitychange"));

            expect(rafSpy).toHaveBeenCalledTimes(2);

            unmount();
        } finally {
            restoreProperty(globalThis, "requestAnimationFrame", originalGlobalRaf);
            restoreProperty(globalThis, "cancelAnimationFrame", originalGlobalCancel);
            restoreProperty(window, "requestAnimationFrame", originalWindowRaf);
            restoreProperty(window, "cancelAnimationFrame", originalWindowCancel);
            restoreProperty(document, "hidden", originalHidden);
        }
    });

    it("syncs lobotomize mode and deletes a graph node with one click", async () => {
        const { container, unmount } = renderMemoryPage();

        await waitFor(() => {
            expect(screen.getByText("1 node")).toBeInTheDocument();
        });
        await waitFor(() => {
            expect(screen.getByText("Long Term: showing 1 memory of 1 memory · Project-wide · All Agents")).toBeInTheDocument();
        });
        expect(screen.getByRole("group", { name: "Memory scope filters" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /embedding model catalog/i })).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: "Enable danger delete mode" }));

        await waitFor(() => {
            expect(lobotomizeModeSignal.value).toBe(true);
            expect(screen.getByText(/Single-click a graph node to delete it immediately/i)).toBeInTheDocument();
        });

        const canvas = container.querySelector("canvas");
        expect(canvas).toBeTruthy();

        fireEvent.mouseDown(canvas!, { clientX: 400, clientY: 300 });
        fireEvent.mouseUp(canvas!, { clientX: 400, clientY: 300 });

        await waitFor(() => {
            expect(api.deleteMemory).toHaveBeenCalledWith("memory-1");
        });
        expect(activeMemoryIdSignal.value).toBeNull();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

        unmount();
    });
});

describe("useMemoryPageData Hook", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(api.listMemories).mockResolvedValue([]);
        vi.mocked(api.listEmbeddingModels).mockResolvedValue([]);
        vi.mocked(api.getMemoryStats).mockResolvedValue({ sprint: 0, agent: 0, project: 0, activeModel: null, staleEmbeddings: 0 });
        vi.mocked(api.getEmbeddingMap).mockResolvedValue({ nodes: [], edges: [], hasEmbeddings: false });
    });

    it("fetches data on project change", async () => {
        const result: any = { current: {} };
        const Wrapper = () => {
            const data = useMemoryPageData("proj-1", "sprint", "short_term");
            Object.assign(result.current, data);
            return null;
        };
        render(<Wrapper />);

        expect(result.current.loading).toBe(true);

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(api.listMemories).toHaveBeenCalledWith({
            projectId: "proj-1",
            scope: "sprint",
            limit: 200,
        });
        expect(api.getMemoryStats).toHaveBeenCalledWith("proj-1");
        expect(result.current.graphDataContextKey).toBe(result.current.requestedContextKey);
        expect(result.current.requestedContextKey).toContain('"tier":"short_term"');
    });

    it("respects filters for sprints and agents", async () => {
        const result: any = { current: {} };
        const Wrapper = () => {
            const data = useMemoryPageData("proj-1", "sprint", "short_term", "sprint-123", "agent-456");
            Object.assign(result.current, data);
            return null;
        };
        render(<Wrapper />);

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(api.listMemories).toHaveBeenCalledWith({
            projectId: "proj-1",
            scope: "sprint",
            limit: 200,
            sprintId: "sprint-123",
            agentPresetId: "agent-456"
        });
        expect(result.current.graphDataContextKey).toBe(result.current.requestedContextKey);
        expect(result.current.requestedContextKey).toContain('"sprintId":"sprint-123"');
        expect(result.current.requestedContextKey).toContain('"agentPresetId":"agent-456"');
    });
});

describe("useEmbeddingModelStatus Hook", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("polls download progress", async () => {
        const initialModels = [
            { id: "model-1" as any, displayName: "M1", description: "", dimension: 128, sizeBytes: 100, language: "en", files: [], downloaded: false, downloading: true, downloadProgress: 0.5, localPath: null, error: null, active: false }
        ];

        const initialStats = { sprint: 0, agent: 0, project: 0, activeModel: null, staleEmbeddings: 0 };

        const updatedModels = [
            { ...initialModels[0], downloadProgress: 0.8 }
        ];

        vi.mocked(api.listEmbeddingModels).mockResolvedValue(updatedModels);

        const result: any = { current: {} };
        const Wrapper = () => {
            const data = useEmbeddingModelStatus("proj-1", initialModels, initialStats, vi.fn());
            Object.assign(result.current, data);
            return null;
        };
        render(<Wrapper />);

        expect(result.current.models[0].downloadProgress).toBe(0.5);

        // Advance timer for interval
        await act(async () => {
            vi.advanceTimersByTime(2100);
        });

        expect(api.listEmbeddingModels).toHaveBeenCalled();
        expect(result.current.models[0].downloadProgress).toBe(0.8);
    });

    it("polls re-embed progress and updates stats without full reload", async () => {
        const initialModels = [];
        const initialStats = { sprint: 0, agent: 0, project: 0, activeModel: null, staleEmbeddings: 5 };
        const onComplete = vi.fn();

        // Mock intermediate progress
        vi.mocked(api.getReembedProgress)
            .mockResolvedValueOnce({ active: true, completed: 2, total: 5, projectId: "proj-1" })
            .mockResolvedValueOnce({ active: false, completed: 5, total: 5, projectId: "proj-1" });

        vi.mocked(api.getMemoryStats).mockResolvedValue({ ...initialStats, staleEmbeddings: 3 });

        const result: any = { current: {} };
        const Wrapper = () => {
            const data = useEmbeddingModelStatus("proj-1", initialModels, initialStats, onComplete);
            Object.assign(result.current, data);
            return null;
        };
        render(<Wrapper />);

        // Trigger reembed start artificially to enter polling state
        act(() => {
            result.current.setReembed({ active: true, completed: 0, total: 5 });
        });

        // 1st tick
        await act(async () => {
            vi.advanceTimersByTime(1100);
            await Promise.resolve(); // flush promises
        });

        expect(api.getReembedProgress).toHaveBeenCalled();
        expect(api.getMemoryStats).toHaveBeenCalled();
        expect(result.current.stats.staleEmbeddings).toBe(3);
        expect(result.current.reembed?.completed).toBe(2);
        expect(onComplete).not.toHaveBeenCalled();

        // 2nd tick
        await act(async () => {
            vi.advanceTimersByTime(1100);
            await Promise.resolve();
        });

        expect(result.current.reembed?.active).toBe(false);
        expect(onComplete).toHaveBeenCalled();
    });
});
