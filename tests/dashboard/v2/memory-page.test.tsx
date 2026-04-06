/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
// @ts-ignore
globalThis.React = { createElement: h };
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/preact";
import { MemoryPage } from "../../../dashboard/src/v2/MemoryPage.js";
import { ProjectDataContext } from "../../../dashboard/src/v2/context/project-data.js";
import * as api from "../../../dashboard/src/v2/lib/memory-api.js";
import userEvent from "@testing-library/user-event";
import { useEmbeddingModelStatus } from "../../../dashboard/src/v2/hooks/use-embedding-model-status.js";
import { useMemoryPageData } from "../../../dashboard/src/v2/hooks/use-memory-page-data.js";
// we cannot use renderHook because of dependency conflict. So we create a wrapper.

// Mock API
vi.mock("../../../dashboard/src/v2/lib/memory-api.js");
vi.mock("../../../dashboard/src/v2/lib/project-api.js", () => ({
    fetchSprints: vi.fn().mockResolvedValue({ sprints: [] }),
    fetchAgentPresets: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../dashboard/src/v2/lib/api/fetch-json.js", () => ({
    fetchJson: vi.fn()
}));

const renderMemoryPage = () => {
    return render(
        <ProjectDataContext.Provider value={{
            projects: [{ id: "proj-1", name: "Project 1", isActive: true }],
            selectedProject: { id: "proj-1", name: "Project 1", isActive: true },
            setSelectedProject: vi.fn(),
            loadProjects: vi.fn(),
        }}>
            <MemoryPage />
        </ProjectDataContext.Provider>
    );
};

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
